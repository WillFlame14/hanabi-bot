import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL, STALL_INDICES } from '../h-constants.js';
import { cardTouched } from '../../../variants.js';
import { find_fix_clues } from './fix-clues.js';
import { evaluate_clue } from './determine-clue.js';
import { determine_focus, valuable_tempo_clue } from '../hanabi-logic.js';
import { cardValue, isSaved, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue, logConnection } from '../../../tools/log.js';
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

	const old_chop = common.chop(state.hands[target]);
	const old_chop_card = state.deck[old_chop];

	if (chop_moved.length === 0) {
		if (isSaved(state, me, old_chop_card, old_chop, { infer: true }))
			return -10;

		// Chop can be clued later
		if (state.hands.some((hand, i) => i === target && hand.some(o => o !== old_chop && state.deck[o].matches(old_chop_card))))
			return -10;

		return safe ? Math.max(find_clue_value(result), state.isCritical(old_chop_card) ? 0.1 : -Infinity) : 0.01;
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

	return !safe ? 0.01 :
		find_clue_value(result)
		+ 0.1*chop_moved.reduce((acc, o) => acc + cardValue(state, hypo_game.common, state.deck[o], o), 0)
		- 0.5*saved_trash.length;
}

/**
 * @param {Game} game
 * @param {Clue} clue
 * @param {number} giver
 * @param {ClueFindingOptions} options
 */
export function get_clue_interp(game, clue, giver, options) {
	const { common, me, state } = game;
	const { target } = clue;
	const { hypothetical = giver !== state.ourPlayerIndex, noRecurse = false } = options;

	const hand = state.hands[target];
	const giver_player = game.players[giver];

	const list = state.clueTouched(hand, clue);
	const { focus, chop } = determine_focus(game, hand, common, list, clue);
	const focused_card = state.deck[focus];

	const in_finesse = common.waiting_connections.find(w_conn => {
		const { focus: wc_focus, inference } = w_conn;
		const matches = giver_player.thoughts[wc_focus].matches(inference, { assume: true });

		return matches && focused_card.playedBefore(inference, { equal: true });
	});

	// Do not focus cards that are part of a finesse
	if (giver_player.thoughts[focus].finessed || in_finesse !== undefined) {
		logger.debug('skipping clue', logClue(clue), 'in finesse', in_finesse?.connections.map(logConnection).join(' -> '));
		return;
	}

	// Do not expect others to clue cards that could be clued in our hand
	if (hypothetical && state.ourHand.some(o => ((card = game.me.thoughts[o]) => card.touched && card.inferred.has(focused_card))()))
		return;

	// Simulate clue from receiver's POV to see if they have the right interpretation
	const action =  /** @type {const} */ ({ type: 'clue', giver, target, list, clue, hypothetical, noRecurse });
	const { hypo_game, result } = evaluate_clue(game, action);

	// Clue had incorrect interpretation
	if (hypo_game === undefined)
		return;

	const interpret = hypo_game.common.thoughts[focus].inferred;
	const { elim, new_touched, bad_touch, cm_dupe, trash, avoidable_dupe, finesses, playables, chop_moved, discard, safe, interp } = result;

	// Do not break pink promise
	if (clue.type === CLUE.RANK && state.deck[focus].rank !== clue.value && interp !== CLUE_INTERP.POSITIONAL)
		return;

	const result_log = {
		clue: logClue(clue),
		bad_touch,
		cm_dupe,
		trash,
		avoidable_dupe,
		interpret: interpret?.map(logCard),
		elim,
		new_touched: new_touched.length,
		finesses: finesses.length,
		playables: playables.map(({ playerIndex, card }) => `${logCard(state.deck[card.order])} (${state.playerNames[playerIndex]})`),
		chop_moved: chop_moved.map(o => `${logCard(state.deck[o])} ${o}`),
		discard: discard ? logCard(state.deck[discard]) : undefined,
		interp,
		safe
	};
	logger.info('result,', JSON.stringify(result_log), find_clue_value(result));

	let save_clue, new_interp;

	switch (interp) {
		case CLUE_INTERP.SAVE:
		case CLUE_INTERP.CM_5:
		case CLUE_INTERP.CM_TRASH:
			if (chop && focused_card.rank === 2) {
				const copies = visibleFind(state, giver_player, focused_card);
				const chops = state.hands.map(hand => common.chop(hand));

				if (copies.some(o => !chops.includes(o) && !state.deck[o].newly_clued)) {
					logger.warn('illegal 2 save');
					return;
				}
			}

			// if (game.level < LEVEL.CONTEXT || avoidable_dupe == 0) {
			save_clue = Object.assign(clue, { game: hypo_game, result, playable: playables.length > 0, cm: chop_moved, safe });
			break;

		case CLUE_INTERP.CM_TEMPO: {
			const { tempo } = valuable_tempo_clue(game, clue, playables, focus);

			if (!safe) {
				logger.highlight('yellow', 'unsafe!');
				return;
			}

			if (!tempo) {
				logger.info('not tempo clue (fill-in?)');
				new_interp = CLUE_INTERP.STALL_FILLIN;
			}
			break;
		}
		case CLUE_INTERP.PLAY:
			if (bad_touch.length === new_touched.length && bad_touch.length > 0) {
				logger.warn('all newly clued cards are bad touched!', new_touched.map(c => c.order));
				return;
			}

			if (!safe) {
				logger.highlight('yellow', 'unsafe!');
				return;
			}

			if (list.some(o => finesses.some(({ card }) => state.deck[card.order].matches(state.deck[o])))) {
				logger.warn('looks like out-of-order play clue, not giving');
				return;
			}

			if (playables.length === 0) {
				logger.warn('play clue with no playables!');
				new_interp = CLUE_INTERP.STALL_BURN;
			}

			// if (game.level < LEVEL.CONTEXT || avoidable_dupe == 0)
			break;
		case CLUE_INTERP.POSITIONAL: {
			if (!safe) {
				logger.highlight('yellow', 'unsafe!');
				return;
			}

			if (playables.length === 0) {
				const { suitIndex, rank } = state.deck[result.focus];

				if (rank > hypo_game.me.hypo_stacks[suitIndex]) {
					logger.warn('invalid positional clue (focus is not playable!)');
					return;
				}

				logger.warn('positional with no playables!');
				new_interp = CLUE_INTERP.STALL_BURN;
			}
			break;
		}
		case CLUE_INTERP.STALL_5: {
			if (game.level >= LEVEL.STALLING && giver === state.ourPlayerIndex) {
				const chopIndex = common.chopIndex(hand);
				const oldest_5 = hand.findLast((o, i) => ((card = state.deck[o]) =>
					i < chopIndex && card.rank === 5 && !card.clued)());

				const distance_from_chop = common.chopDistance(hand, oldest_5);

				for (let i = 0; i < state.numPlayers; i++) {
					if (i === state.ourPlayerIndex)
						continue;

					const hand2 = state.hands[i];

					const closer5 = hand2.find(o => ((card = me.thoughts[o]) =>
						card.rank === 5 && !card.saved && common.chopDistance(hand2, o) < distance_from_chop)());

					// There is a 5 closer to chop that we could stall on.
					if (closer5 !== undefined) {
						logger.warn('closer 5 to chop', closer5, state.playerNames[i]);
						new_interp = CLUE_INTERP.NONE;
						break;
					}
				}
			}
			break;
		}
	}

	const new_result = { ...result, interp: new_interp };

	return { hypo_game, chop, safe, result, interp: new_interp ?? interp, new_clue: { ...clue, result: new_result }, save_clue };
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

	const { state } = game;
	const { giver = state.ourPlayerIndex, no_fix = false, early_exits = () => false } = options;

	logger.highlight('whiteb', `------- FINDING CLUES ${giver !== state.ourPlayerIndex ? `(${state.playerNames[giver]}) ` : ''}-------`);

	let play_clues = /** @type Clue[][] */ 		([]);
	let save_clues = /** @type SaveClue[] */ 	([]);
	let stall_clues = /** @type Clue[][] */ 	([[], [], [], [], [], [], []]);

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, game.players[giver].hypo_stacks, state.max_ranks);

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

		for (const clue of state.allValidClues(target)) {
			const res = get_clue_interp(game, clue, giver, options);

			if (res === undefined)
				continue;

			const { hypo_game, interp, new_clue, save_clue } = res;
			hypo_games[logClue(clue)] = hypo_game;

			logger.info(interp, logClue(clue));

			switch (interp) {
				case CLUE_INTERP.SAVE:
				case CLUE_INTERP.CM_5:
				case CLUE_INTERP.CM_TRASH:
					saves.push(save_clue);
					break;

				case CLUE_INTERP.STALL_5:
				case CLUE_INTERP.CM_TEMPO:
				case CLUE_INTERP.STALL_TEMPO:
				case CLUE_INTERP.STALL_FILLIN:
				case CLUE_INTERP.STALL_LOCKED:
				case CLUE_INTERP.STALL_8CLUES:
				case CLUE_INTERP.STALL_BURN:
					stall_clues[STALL_INDICES[interp]].push(new_clue);
					break;

				case CLUE_INTERP.PLAY:
				case CLUE_INTERP.DISTRIBUTION:
				case CLUE_INTERP.POSITIONAL:
					play_clues[target].push(new_clue);
					break;
			}

			if (early_exits(game, new_clue, interp)) {
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
		}, -9);
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
