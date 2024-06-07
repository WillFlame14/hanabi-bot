import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { cardTouched } from '../../../variants.js';
import { clue_safe } from './clue-safe.js';
import { find_fix_clues } from './fix-clues.js';
import { evaluate_clue, get_result } from './determine-clue.js';
import { determine_focus, stall_severity, valuable_tempo_clue } from '../hanabi-logic.js';
import { cardValue, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').Clue} Clue
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

	if (chop_moved.length === 0)
		return Math.max(find_clue_value(result), state.isCritical(old_chop) ? 0.1 : -Infinity);

	// TODO: Should visible (but not saved, possibly on chop?) cards be included as trash?
	const saved_trash = chop_moved.filter(card =>
		isTrash(state, me, card, card.order, { infer: true }) ||			// Saving a trash card
		chop_moved.some(c => card.matches(c) && card.order > c.order)		// Saving 2 of the same card
	);

	// Direct clue is possible
	if (hypo_game.moveHistory.at(-1).move === CLUE_INTERP.CM_TRASH && all_clues.some(clue => chop_moved.every(cm => saved_trash.some(c => c.order === cm.order) || cardTouched(cm, state.variant, clue))))
		return -10;

	// Chop is trash, can give clue later
	if (isTrash(state, me, old_chop, old_chop.order, { infer: true }) || chop_moved.some(c => c.duplicateOf(old_chop)))
		return -10;

	// More trash cards saved than useful cards
	if (saved_trash.length > Math.min(1, chop_moved.length - saved_trash.length))
		return -10;

	const new_chop = hypo_game.common.chop(hypo_game.state.hands[target], { afterClue: true });

	// Target doesn't have trash and their new chop is more valuable than their old one (having a playable is not good enough)
	if (hypo_game.players[target].thinksTrash(hypo_game.state, target).length === 0 && (new_chop ? cardValue(state, me, new_chop) : 4) > cardValue(state, me, old_chop))
		return -10;

	return find_clue_value(result) - 0.1*saved_trash.length;
}

/**
 * Finds all clues for the given state that can be given by a particular player (defaults to us).
 * Play and fix clues are 2D arrays as each player can potentially receive multiple play/fix clues.
 * Each player has only one save clue.
 * 
 * @param {Game} game
 * @param {number} [giver]
 */
export function find_clues(game, giver = game.state.ourPlayerIndex) {
	const { common, state } = game;
	const player = game.players[giver];
	const hypothetical = giver !== state.ourPlayerIndex;

	logger.highlight('whiteb', '------- FINDING CLUES -------');

	const play_clues = /** @type Clue[][] */ 	([]);
	const save_clues = /** @type SaveClue[] */ 	([]);
	const stall_clues = /** @type Clue[][] */ 	([[], [], [], [], [], []]);

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, player.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];

		/** @type {(SaveClue & {game: Game})[]} */
		const saves = [];

		// Ignore our hand and the giver's hand
		if (target === state.ourPlayerIndex || target === giver)
			continue;

		const hand = state.hands[target];

		for (const clue of state.allValidClues(target)) {
			const touch = state.hands[target].clueTouched(clue, state.variant);

			const list = touch.map(c => c.order);
			const { focused_card, chop } = determine_focus(hand, common, list);

			const in_finesse = common.waiting_connections.some(w_conn => {
				const { focused_card: wc_focus, inference } = w_conn;
				const matches = player.thoughts[wc_focus.order].matches(inference, { assume: true });

				return matches && focused_card.playedBefore(inference, { equal: true });
			});

			// Do not focus cards that are part of a finesse
			if (player.thoughts[focused_card.order].finessed || in_finesse)
				continue;

			// Do not expect others to clue cards that could be clued in our hand
			if (hypothetical && state.hands[state.ourPlayerIndex].some(c => {
				const card = game.me.thoughts[c.order];
				return card.touched && card.inferred.some(i => i.matches(focused_card));
			}))
				continue;

			const bad_touch_cards = touch.filter(c => !c.clued && isTrash(state, player, player.thoughts[c.order].identity({ infer: true }), c.order));		// Ignore cards that were already clued

			// Simulate clue from receiver's POV to see if they have the right interpretation
			const action =  /** @type {const} */ ({ type: 'clue', giver, target, list, clue, hypothetical });
			const hypo_game = evaluate_clue(game, action, clue, target, focused_card, bad_touch_cards);

			// Clue had incorrect interpretation
			if (hypo_game === undefined)
				continue;

			const interpret = hypo_game.common.thoughts[focused_card.order].inferred;
			const result = get_result(game, hypo_game, clue, giver);
			Object.assign(clue, { result });

			const safe = hypothetical || clue_safe(game, player, clue);

			const { elim, new_touched, bad_touch, trash, avoidable_dupe, finesses, playables, chop_moved } = result;
			const remainder = (chop && (!safe || state.clue_tokens <= 2)) ? result.remainder: 0;

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
				chop_moved: chop_moved.map(c => `${logCard(state.deck[c.order])} ${c.order}`),
				remainder	// We only need to check remainder if this clue focuses chop, because we are changing chop to something else
			};
			logger.info('result,', JSON.stringify(result_log), find_clue_value(Object.assign(result, { remainder })));

			if ((chop && !state.isBasicTrash(focused_card) && visibleFind(state, player, focused_card).length === 1) || chop_moved.length > 0) {
				if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
					saves.push(Object.assign(clue, { game: hypo_game, playable: playables.length > 0, cm: chop_moved, safe }));
				else
					logger.highlight('yellow', `${logClue(clue)} save results in avoidable potential duplication`);
			}

			const focus_known_bluff = hypo_game.common.waiting_connections.some(c => {
				return c.connections[0].bluff && c.focused_card.order == focused_card.order;
			});
			// Clues where the focus isn't playable but may be assumed playable or that cause chop moves aren't plays/stalls
			if ((playables.length > 0 && !playables.some(({ card }) => card.order === focused_card.order) && !focus_known_bluff) ||
				(playables.length === 0 && chop_moved.length > 0) ||
				isTrash(state, player, focused_card, focused_card.order)) {
				logger.highlight('yellow', 'invalid play clue');
				continue;
			}

			if (playables.length > 0) {
				if (safe) {
					const { tempo, valuable } = valuable_tempo_clue(game, clue, playables, focused_card);
					if (tempo && !valuable)
						stall_clues[1].push(clue);
					else if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
						play_clues[target].push(clue);
					else
						logger.highlight('yellow', `${logClue(clue)} results in avoidable potential duplication`);
				}
				else {
					logger.highlight('yellow', `${logClue(clue)} is an unsafe play clue`);
				}
			}
			// Stall clues
			else if (stall_severity(state, common, giver) > 0) {
				if (clue.type === CLUE.RANK && clue.value === 5 && !focused_card.clued) {
					logger.info('5 stall', logClue(clue));
					stall_clues[0].push(clue);
				}
				else if (player.thinksLocked(state, giver) && chop) {
					logger.info('locked hand save', logClue(clue));
					stall_clues[3].push(clue);
				}
				else if (new_touched.length === 0) {
					if (elim > 0) {
						logger.info('fill in', logClue(clue));
						stall_clues[2].push(clue);
					}
					else {
						logger.info('hard burn', logClue(clue));
						stall_clues[5].push(clue);
					}
				}
			}
			else if (chop && focused_card.rank === 2) {
				const copies = visibleFind(state, player, focused_card);
				const chops = state.hands.map(hand => common.chop(hand)?.order);

				if (copies.some(c => !chops.includes(c.order) && !c.newly_clued)) {
					logger.warn('illegal 2 save');
					continue;
				}

				// Special 2 Save where both copies are on chop
				saves.push(Object.assign(clue, { game: hypo_game, playable: playables.length > 0, cm: [], safe }));
			}
		}

		const all_clues = [...saves, ...play_clues[target]];
		save_clues[target] = Utils.maxOn(saves, (save_clue) => save_clue_value(game, save_clue.game, save_clue, all_clues), 0);
	}

	const fix_clues = find_fix_clues(game, play_clues, save_clues);

	if (play_clues.some(clues => clues.length > 0))
		logger.info('found play clues', play_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	if (save_clues.some(clue => clue !== undefined))
		logger.info('found save clues', save_clues.filter(clue => clue !== undefined).map(clue => logClue(clue)));

	if (fix_clues.some(clues => clues.length > 0))
		logger.info('found fix clues', fix_clues.flatMap(clues => clues.map(clue => logClue(clue) + (clue.trash ? ' (trash)' : ''))));

	if (stall_clues.some(clues => clues.length > 0))
		logger.info('found stall clues', stall_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	return { play_clues, save_clues, fix_clues, stall_clues };
}
