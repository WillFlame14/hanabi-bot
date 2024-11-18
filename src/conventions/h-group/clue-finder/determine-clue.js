import { CLUE_INTERP } from '../h-constants.js';
import { bad_touch_result, cm_result, elim_result, playables_result } from '../../../basics/clue-result.js';
import { isTrash } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import { determine_focus } from '../hanabi-logic.js';
import { variantRegexes } from '../../../variants.js';
import { CLUE } from '../../../constants.js';
import { clue_safe } from './clue-safe.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 *
 * @typedef {{ excludeColour: boolean, excludeRank: boolean, save: boolean }} ClueOptions
 */

/**
 * Determines whether a clue is acceptable.
 * @param  {Game} game
 * @param  {Game} hypo_game
 * @param  {ClueAction} action
 * @param  {ClueResult} result
 */
function acceptable_clue(game, hypo_game, action, result) {
	const { common, state } = game;
	const { clue, giver, list, target } = action;
	const { focus, bad_touch } = result;

	/** @param {Game} game */
	const get_finessed_orders = (game) =>
		game.state.hands.flatMap(hand => hand.filter(o => ((c = game.common.thoughts[o]) => !c.clued && (c.finessed || c.bluffed))()));

	const finessed_before_clue = get_finessed_orders(game);
	const finessed_after_clue = get_finessed_orders(hypo_game);
	const lost_finesse = finessed_before_clue.filter(o => !finessed_after_clue.includes(o));

	if (lost_finesse.length > 0)
		return `cards ${lost_finesse.map(o => logCard(state.deck[o])).join(', ')} lost finesse`;

	for (const order of state.hands[target]) {
		const card = hypo_game.common.thoughts[order];
		const visible_card = state.deck[order];

		// The focused card must not have been reset and must match inferences
		if (order === focus) {
			if (card.reset && !common.thoughts[order].reset)
				return `card ${logCard(state.deck[order])} ${order} lost all inferences and was reset`;

			if (!card.inferred.has(visible_card))
				return `card ${logCard(visible_card)} ${order} has inferences [${card.inferred.map(logCard).join(',')}]`;

			continue;
		}

		const old_card = common.thoughts[order];

		const allowable_trash = card.chop_moved ||													// Chop moved (might have become trash)
			old_card.reset || !state.hasConsistentInferences(old_card) || old_card.inferred.length === 0 ||	// Didn't match inference even before clue
			(visible_card.clued && isTrash(state, game.me, visible_card, order, { infer: true })) ||		// Previously-clued duplicate or recently became basic trash
			bad_touch.includes(order) ||																// Bad touched
			(state.includesVariant(variantRegexes.pinkish) && clue.type === CLUE.RANK && clue.value === 1) ||		// 1 clue in pink
			card.possible.every(id => isTrash(hypo_game.state, hypo_game.common, id, order, { infer: true }));		// Known trash

		if (allowable_trash || card.possible.length === 1)
			continue;

		const id = card.identity({ infer: true });

		// For non-focused cards:
		if (card.reset)
			return `card ${logCard(state.deck[order])} ${order} lost all inferences and was reset`;

		if (id !== undefined && !visible_card.matches(id))
			return `card ${logCard(visible_card)} incorrectly inferred to be ${logCard(id)}`;

		const looks_playable = hypo_game.common.unknown_plays.has(order) ||
			hypo_game.common.hypo_stacks[visible_card.suitIndex] >= visible_card.rank ||
			card.inferred.every(i => i.rank <= hypo_game.common.hypo_stacks[i.suitIndex] + 1);

		if (looks_playable && !card.inferred.has(visible_card))
			return `card ${logCard(visible_card)} ${order} looks incorrectly playable with inferences [${card.inferred.map(logCard).join(',')}]`;
	}

	const stomped_finesse = common.waiting_connections.some(w_conn => {
		const { focus: wc_focus, connections, conn_index, inference } = w_conn;
		const matches = game.players[giver].thoughts[wc_focus].matches(inference, { assume: true });

		return matches && list.some(o => {
			const card = hypo_game.common.thoughts[o];
			return connections.some((conn, i) => i >= conn_index && conn.order === o && card.inferred.every(i => hypo_game.state.isPlayable(i)));
		});
	});

	if (stomped_finesse)
		return 'indirectly stomps on finesse';

	const fake_symmetric_lock = hypo_game.common.thinksLocked(hypo_game.state, target, true) && !hypo_game.common.thinksLocked(hypo_game.state, target);

	if (fake_symmetric_lock)
		return `target ${state.playerNames[target]} is symmetrically locked on a fake finesse`;

	const finessed_symmetric_card = finessed_after_clue.find(o => !finessed_before_clue.includes(o) && game.common.waiting_connections.some(wc => wc.symmetric &&
		wc.connections.some((conn, i) => i >= wc.conn_index && conn.type === 'finesse' && conn.order === o )));

	if (finessed_symmetric_card)
		return `finesses ${finessed_symmetric_card}, preventing a symmetric finesse from being disproven`;
}

/**
 * Evaluates the result of a clue. Returns the hypothetical state after the clue if correct, otherwise undefined.
 * @param  {Game} game
 * @param  {ClueAction & { clue: Clue }} action
 */
export function evaluate_clue(game, action) {
	const { state } = game;
	const { clue, giver } = action;

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	logger.highlight('green', `------- ENTERING HYPO ${logClue(clue)} --------`);

	const hypo_game = game.simulate_clue(action, { enableLogs: true });

	if (giver === state.ourPlayerIndex) {
		hypo_game.catchup = true;
		// This is emulating the needed side effects of handle_action for a clue action.
		// It might be simpler to call handle_action on the hypo_game.
		hypo_game.last_actions[giver] = {...action, clue: {...action.clue}};
		hypo_game.handle_action({ type: 'turn', num: hypo_game.state.turn_count, currentPlayerIndex: hypo_game.state.nextPlayerIndex(hypo_game.state.ourPlayerIndex) });
		hypo_game.catchup = false;
	}

	logger.highlight('green', `------- EXITING HYPO ${logClue(clue)} --------`);

	if (action.hypothetical && hypo_game.lastMove === CLUE_INTERP.NONE) {
		logger.flush(false);
		return { hypo_game: undefined, result: undefined };
	}

	const result = get_result(game, hypo_game, action);
	const failure_reason = acceptable_clue(game, hypo_game, action, result);

	// Print out logs if the result is correct
	logger.flush(failure_reason === undefined);

	if (failure_reason) {
		logger.info(`${logClue(clue)} has incorrect interpretation, (${failure_reason})`);
		return { hypo_game: undefined, result: undefined };
	}

	return { hypo_game, result };
}

/**
 * Returns some statistics about the clue.
 * @param  {Game} game
 * @param  {Game} hypo_game
 * @param  {ClueAction & {clue: Clue}} action
 * @param  {{list?: number[]}} provisions 	Provided 'list' variable if clued in our hand.
 * @returns {ClueResult}
 */
export function get_result(game, hypo_game, action, provisions = {}) {
	const { common, state } = game;
	const { common: hypo_common, state: hypo_state } = hypo_game;
	const { clue, giver, hypothetical } = action;

	const { target } = clue;
	const hand = state.hands[target];

	const list = provisions.list ?? state.clueTouched(hand, clue);

	const { focus } = determine_focus(hypo_game, hand, hypo_common, list, clue);

	const { new_touched, fill } = elim_result(hypo_state, common, hypo_common, hand, list);
	const { bad_touch, cm_dupe, trash, avoidable_dupe } = bad_touch_result(game, hypo_game, hypo_common, giver, target);
	const { finesses, playables } = playables_result(hypo_state, common, hypo_common);
	const chop_moved = cm_result(common, hypo_common, hand);

	const { safe, discard } = hypothetical ? { safe: true, discard: undefined } : clue_safe(game,game.players[giver], clue);

	return {
		focus,
		elim: fill,
		new_touched,
		bad_touch,
		cm_dupe,
		trash,
		avoidable_dupe,
		finesses,
		playables,
		chop_moved,
		safe,
		discard,
		remainder: 0,
		interp: /** @type {CLUE_INTERP[keyof CLUE_INTERP]} */ (hypo_game.lastMove)
	};
}
