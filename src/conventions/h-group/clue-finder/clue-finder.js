import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { cardTouched } from '../../../variants.js';
import { clue_safe } from './clue-safe.js';
import { find_fix_clues } from './fix-clues.js';
import { evaluate_clue, get_result } from './determine-clue.js';
import { determine_focus, valuable_tempo_clue } from '../hanabi-logic.js';
import { cardValue, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import { produce } from '../../../StateProxy.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').FixClue} FixClue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 */

/**
 * Returns the value of a save clue, or -10 if it is not worth giving at all.
 * @param {Game} game
 * @param {Game} hypo_game
 * @param {SaveClue} save_clue
 * @param {Clue[]} all_clues
 */
function save_clue_value(game, hypo_game, save_clue, all_clues) {
	const { common, me, state } = game;
	const { target, result, safe } = save_clue;
	const { chop_moved } = result;

	if (!safe)
		return -1;

	const old_chop = common.chop(state.hands[target]);
	const old_chop_card = state.deck[old_chop];

	if (chop_moved.length === 0) {
		// Chop can be clued later
		if (state.hands.some(hand => hand.some(o => o !== old_chop && state.deck[o].matches(old_chop_card))))
			return -10;

		return Math.max(find_clue_value(result), state.isCritical(old_chop_card) ? 0.1 : -Infinity);
	}

	const saved_trash = chop_moved.filter(order => {
		const card = state.deck[order];
		return state.isBasicTrash(card) ||
			state.hands.some(hand => hand.some(o => state.deck[o].matches(card) && o !== order)) ||		// Saving a duplicated card
			chop_moved.some(o => card.matches(state.deck[o]) && order > o);		// Saving 2 of the same card
	});

	// Direct clue is possible
	if (hypo_game.lastMove === CLUE_INTERP.CM_TRASH &&
		all_clues.some(clue => chop_moved.every(cm => saved_trash.includes(cm) || cardTouched(state.deck[cm], state.variant, clue))))
		return -10;

	// Chop is trash, can give clue later
	if (isTrash(state, me, old_chop_card, old_chop, { infer: true }) || chop_moved.some(o => state.deck[o].duplicateOf(old_chop_card)))
		return -10;

	// More trash cards saved than useful cards
	if (saved_trash.length > Math.min(1, chop_moved.length - saved_trash.length))
		return -10;

	const new_chop_card = state.deck[hypo_game.common.chop(hypo_game.state.hands[target], { afterClue: true })];

	// Target doesn't have trash and their new chop is more valuable than their old one (having a playable is not good enough)
	if (hypo_game.players[target].thinksTrash(hypo_game.state, target).length === 0 && (new_chop_card ? cardValue(state, me, new_chop_card) : 4) > cardValue(state, me, old_chop_card))
		return -10;

	return find_clue_value(result) - 0.1*saved_trash.length;
}

/**
 * Finds all clues for the given state that can be given by a particular player (defaults to us).
 * Play and fix clues are 2D arrays as each player can potentially receive multiple play/fix clues.
 * Each player has only one save clue.
 * 
 * @param {Game} game
 * @param {ClueFindingOptions} options
 * 
 * @typedef ClueFindingOptions
 * @property {number} [giver]
 * @property {boolean} [hypothetical]
 * @property {boolean} [no_fix]
 * @property {boolean} [noRecurse]
 * @property {(game: Game, clue: Clue, interp: typeof CLUE_INTERP[keyof typeof CLUE_INTERP]) => boolean} [early_exits]
 */
export function find_clues(game, options = {}) {
	const hash = game.hash + ',' + JSON.stringify(options) + ',' + options.early_exits?.toString();

	if (Utils.globals.cache.has(hash))
		return Utils.globals.cache.get(hash);

	const { common, state } = game;
	const { giver = state.ourPlayerIndex, hypothetical = giver !== state.ourPlayerIndex, no_fix = false, noRecurse = false, early_exits = () => false } = options;
	const player = game.players[giver];

	logger.highlight('whiteb', `------- FINDING CLUES ${giver !== state.ourPlayerIndex ? `(${state.playerNames[giver]}) ` : ''}-------`);

	let play_clues = /** @type Clue[][] */ 		([]);
	let save_clues = /** @type SaveClue[] */ 	([]);
	let stall_clues = /** @type Clue[][] */ 	([[], [], [], [], [], [], []]);

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, player.hypo_stacks, state.max_ranks);

	let early_exit = false;
	const hypo_games = /** @type {Record<string, Game>} */ ({});

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];

		/** @type {(SaveClue & {game: Game})[]} */
		const saves = [];

		// Ignore the giver's hand
		if (target === giver)
			continue;

		const hand = state.hands[target];

		for (const clue of state.allValidClues(target)) {
			const list = state.clueTouched(state.hands[target], clue);
			const { focus, chop } = determine_focus(game, hand, common, list, clue);
			const focused_card = state.deck[focus];

			const in_finesse = common.waiting_connections.some(w_conn => {
				const { focus: wc_focus, inference } = w_conn;
				const matches = player.thoughts[wc_focus].matches(inference, { assume: true });

				return matches && focused_card.playedBefore(inference, { equal: true });
			});

			// Do not focus cards that are part of a finesse
			if (player.thoughts[focus].finessed || in_finesse)
				continue;

			// Do not expect others to clue cards that could be clued in our hand
			if (hypothetical && state.ourHand.some(o => ((card = game.me.thoughts[o]) => card.touched && card.inferred.has(focused_card))()))
				continue;

			// Simulate clue from receiver's POV to see if they have the right interpretation
			const action =  /** @type {const} */ ({ type: 'clue', giver, target, list, clue, hypothetical, noRecurse });
			const hypo_game = evaluate_clue(game, action, clue, target, focused_card);

			// Clue had incorrect interpretation
			if (hypo_game === undefined)
				continue;

			const stomped_finesse = common.waiting_connections.some(w_conn => {
				const { focus: wc_focus, connections, conn_index, inference } = w_conn;
				const matches = player.thoughts[wc_focus].matches(inference, { assume: true });

				return matches && list.some(o => {
					const card = hypo_game.common.thoughts[o];
					return connections.some((conn, i) => i >= conn_index && conn.order === o && card.inferred.every(i => hypo_game.state.isPlayable(i)));
				});
			});

			if (stomped_finesse) {
				logger.warn('indirectly stomps on finesse, not giving');
				continue;
			}

			const interpret = hypo_game.common.thoughts[focus].inferred;
			let result = get_result(game, hypo_game, clue, giver);
			Object.assign(clue, { result });

			const { safe, discard } = hypothetical ? { safe: true, discard: undefined } : clue_safe(game, player, clue);
			result = produce(result, (draft) => { draft.discard = discard; });

			const { elim, new_touched, bad_touch, trash, avoidable_dupe, finesses, playables, chop_moved } = result;
			const interp = /** @type {typeof CLUE_INTERP[keyof typeof CLUE_INTERP]} */ (hypo_game.lastMove);

			const result_log = {
				clue: logClue(clue),
				bad_touch,
				trash,
				avoidable_dupe,
				interpret: interpret?.map(logCard),
				elim,
				new_touched: new_touched.length,
				finesses: finesses.length,
				playables: playables.map(({ playerIndex, card }) => `${logCard(state.deck[card.order])} (${state.playerNames[playerIndex]})`),
				chop_moved: chop_moved.map(o => `${logCard(state.deck[o])} ${o}`),
				discard: discard ? logCard(state.deck[discard]) : undefined,
				interp
			};
			logger.info('result,', JSON.stringify(result_log), find_clue_value(result));

			hypo_games[logClue(clue)] = hypo_game;

			if ((/** @type {any} */ ([CLUE_INTERP.SAVE, CLUE_INTERP.CM_5, CLUE_INTERP.CM_TRASH]).includes(hypo_game.lastMove))) {
				if (chop && focused_card.rank === 2) {
					const copies = visibleFind(state, player, focused_card);
					const chops = state.hands.map(hand => common.chop(hand));

					if (copies.some(o => !chops.includes(o) && !state.deck[o].newly_clued)) {
						logger.warn('illegal 2 save');
						continue;
					}
				}

				if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
					saves.push(Object.assign(clue, { game: hypo_game, playable: playables.length > 0, cm: chop_moved, safe }));
				else
					logger.highlight('yellow', `${logClue(clue)} save results in avoidable potential duplication`);
			}

			switch (interp) {
				case CLUE_INTERP.DISTRIBUTION:
					logger.info('distribution clue!');
					play_clues[target].push(clue);
					break;

				case CLUE_INTERP.CM_TEMPO: {
					const { tempo, valuable } = valuable_tempo_clue(game, clue, clue.result.playables, focus);

					if (!safe) {
						logger.highlight('yellow', 'unsafe!');
						continue;
					}

					if (tempo && !valuable) {
						logger.info('tempo clue chop move', logClue(clue));
						stall_clues[1].push(clue);
					}
					else {
						logger.info('clue', logClue(clue), tempo, valuable);
					}
					break;
				}
				case CLUE_INTERP.PLAY:
					if (clue.result.playables.length === 0) {
						logger.warn('play clue with no playables!');
						stall_clues[5].push(clue);
						continue;
					}

					if (clue.result.bad_touch === clue.result.new_touched.length && clue.result.bad_touch > 0) {
						logger.warn('all newly clued cards are bad touched!', clue.result.new_touched.map(c => c.order));
						continue;
					}

					if (!safe) {
						logger.highlight('yellow', 'unsafe!');
						continue;
					}

					if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
						play_clues[target].push(clue);
					else
						logger.highlight('yellow', `${logClue(clue)} results in avoidable potential duplication`);
					break;

				case CLUE_INTERP.STALL_5:
					logger.info('5 stall', logClue(clue));
					stall_clues[0].push(clue);
					break;

				case CLUE_INTERP.STALL_TEMPO:
					logger.info('tempo clue stall', logClue(clue));
					stall_clues[1].push(clue);
					break;

				case CLUE_INTERP.STALL_FILLIN:
					logger.info('fill-in stall', logClue(clue));
					stall_clues[2].push(clue);
					break;

				case CLUE_INTERP.STALL_LOCKED:
					logger.info('locked hand save', logClue(clue));
					stall_clues[3].push(clue);
					break;

				case CLUE_INTERP.STALL_8CLUES:
					logger.info('8 clue save', logClue(clue));
					stall_clues[4].push(clue);
					break;

				case CLUE_INTERP.STALL_BURN:
					logger.info('hard burn', logClue(clue));
					stall_clues[5].push(clue);
					break;
			}

			if (early_exits(game, clue, interp)) {
				if (interp === CLUE_INTERP.SAVE)
					save_clues[target] = saves.at(-1);

				early_exit = true;
				break;
			}
		}

		if (early_exit)
			break;

		save_clues[target] = Utils.maxOn(saves, (save_clue) => {
			const value = save_clue_value(game, save_clue.game, save_clue, [...saves, ...play_clues[target]]);

			logger.debug('save clue', logClue(save_clue), 'has value', value);
			return value;
		}, 0);
	}

	const all_clues = [...save_clues.filter(c => c !== undefined), ...play_clues.flat(), ...stall_clues.flat()];

	if (all_clues.length > 0) {
		const remainders = new Map();
		let best_remainder = Infinity;

		for (const clue of all_clues) {
			const discard = clue?.result?.discard;
			const value = discard ? cardValue(state, hypo_games[logClue(clue)].me, state.deck[discard], discard) : 0;
			remainders.set(logClue(clue), value);

			if (value < best_remainder)
				best_remainder = value;
		}

		play_clues = produce(play_clues, (draft) => {
			for (const clue of draft.flat())
				clue.result.remainder = remainders.get(logClue(clue)) - best_remainder;
		});

		save_clues = produce(save_clues, (draft) => {
			for (const clue of draft) {
				if (clue !== undefined)
					clue.result.remainder = remainders.get(logClue(clue)) - best_remainder;
			}
		});

		stall_clues = produce(stall_clues, (draft) => {
			for (const clue of draft.flat())
				clue.result.remainder = remainders.get(logClue(clue)) - best_remainder;
		});
	}

	/** @type {FixClue[][]} */
	const fix_clues = (early_exit || no_fix) ? Utils.range(0, state.numPlayers).map(_ => []) : find_fix_clues(game, play_clues, save_clues);

	if (play_clues.some(clues => clues.length > 0))
		logger.info('found play clues', play_clues.flatMap(clues => clues.map(logClue)));

	if (save_clues.some(clue => clue !== undefined))
		logger.info('found save clues', save_clues.filter(clue => clue !== undefined).map(logClue));

	if (fix_clues.some(clues => clues.length > 0))
		logger.info('found fix clues', fix_clues.flatMap(clues => clues.map(clue => logClue(clue) + (clue.trash ? ' (trash)' : ''))));

	if (stall_clues.some(clues => clues.length > 0))
		logger.info('found stall clues', stall_clues.map(clues => clues.map(logClue)));

	Utils.globals.cache.set(hash, { play_clues, save_clues, fix_clues, stall_clues });
	return { play_clues, save_clues, fix_clues, stall_clues };
}
