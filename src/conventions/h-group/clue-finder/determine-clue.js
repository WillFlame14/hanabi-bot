import { determine_focus } from '../hanabi-logic.js';
import { bad_touch_result, cm_result, elim_result, playables_result } from '../../../basics/clue-result.js';
import { cardValue, isTrash } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';

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
 * Evaluates the result of a clue. Returns the hypothetical state after the clue if correct, otherwise undefined.
 * @param  {Game} game
 * @param  {ClueAction} action
 * @param  {Clue} clue
 * @param  {number} target
 * @param  {ActualCard} target_card
 * @param  {ActualCard[]} bad_touch_cards
 */
export function evaluate_clue(game, action, clue, target, target_card, bad_touch_cards) {
	const { state } = game;

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	logger.highlight('green', `------- ENTERING HYPO ${logClue(clue)} --------`);

	const hypo_game = game.simulate_clue(action, { enableLogs: true });

	logger.highlight('green', '------- EXITING HYPO --------');

	/** @type {string} */
	let reason;

	for (const { order, clued } of state.hands[target]) {
		const card = hypo_game.common.thoughts[order];
		const visible_card = state.deck[order];

		// The focused card must not have been reset and must match inferences
		if (order === target_card.order) {
			if (card.reset) {
				reason = `card ${logCard(state.deck[card.order])} ${card.order} lost all inferences and was reset`;
				break;
			}

			if (!card.inferred.has(visible_card)) {
				reason = `card ${logCard(visible_card)} has inferences [${card.inferred.map(logCard).join(',')}]`;
				break;
			}
			continue;
		}

		const old_card = game.common.thoughts[order];

		const allowable_trash = card.chop_moved ||													// Chop moved (might have become trash)
			old_card.reset || !old_card.matches_inferences() || old_card.inferred.length === 0 ||	// Didn't match inference even before clue
			(clued && isTrash(state, game.me, visible_card, order)) ||								// Previously-clued duplicate or recently became basic trash
			bad_touch_cards.some(b => b.order === order) ||											// Bad touched
			card.possible.every(id => isTrash(hypo_game.state, hypo_game.common, id, order));		// Known trash

		if (allowable_trash || card.possible.length === 1)
			continue;

		const id = card.identity({ infer: true });

		// For non-focused cards:
		if (card.reset) {
			reason = `card ${logCard(state.deck[card.order])} ${card.order} lost all inferences and was reset`;
			break;
		}

		if (id !== undefined && !visible_card.matches(id)) {
			reason = `card ${logCard(visible_card)} incorrectly inferred to be ${logCard(id)}`;
			break;
		}

		const looks_playable = hypo_game.common.unknown_plays.has(order) ||
			hypo_game.common.hypo_stacks[visible_card.suitIndex] >= visible_card.rank ||
			card.inferred.every(i => i.rank <= hypo_game.common.hypo_stacks[i.suitIndex] + 1);

		if (looks_playable && !card.inferred.has(visible_card)) {
			reason = `card ${logCard(visible_card)} looks incorrectly playable with inferences [${card.inferred.map(logCard).join(',')}]`;
			break;
		}
	}

	// Print out logs if the result is correct
	logger.flush(reason === undefined);

	if (reason) {
		logger.info(`${logClue(clue)} has incorrect interpretation, (${reason})`);
		return undefined;
	}

	return hypo_game;
}

/**
 * Returns some statistics about the clue.
 * @param  {Game} game
 * @param  {Game} hypo_game
 * @param  {Clue} clue
 * @param  {number} giver
 * @param  {{touch?: ActualCard[], list?: number[]}} provisions 	Provided 'touch' and 'list' variables if clued in our hand.
 * @returns {ClueResult}
 */
export function get_result(game, hypo_game, clue, giver, provisions = {}) {
	const { common, state } = game;
	const { common: hypo_common, state: hypo_state } = hypo_game;

	const { target } = clue;
	const hand = state.hands[target];

	const touch = provisions.touch ?? hand.clueTouched(clue, state.variant);
	const list = provisions.list ?? touch.map(c => c.order);

	const { focused_card } = determine_focus(hand, common, list, { beforeClue: true });

	const { new_touched, fill } = elim_result(common, hypo_common, hand, list);
	const { bad_touch, trash } = bad_touch_result(hypo_game, hypo_common, target, focused_card.order);
	const { finesses, playables } = playables_result(hypo_state, common, hypo_common);
	const chop_moved = cm_result(common, hypo_common, hand);

	const new_chop = hypo_game.common.chop(hand, { afterClue: true });
	const remainder = (new_chop !== undefined) ? cardValue(hypo_state, hypo_game.me, game.me.thoughts[new_chop.order], new_chop.order) :
						hypo_common.thinksLoaded(hypo_state, target) ? 0 : 4;

	return { elim: fill, new_touched, bad_touch, trash, finesses, playables, chop_moved, remainder };
}
