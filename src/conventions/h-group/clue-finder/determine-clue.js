import { CLUE_INTERP } from '../h-constants.js';
import { bad_touch_result, cm_result, elim_result, playables_result } from '../../../basics/clue-result.js';
import { isTrash } from '../../../basics/hanabi-util.js';

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
	hypo_game.catchup = true;
	// This is emulating the needed side effects of handle_action for a clue action.
	// It might be simpler to call handle_action on the hypo_game.
	hypo_game.last_actions[action.giver] = {...action, clue: {...action.clue}};
	hypo_game.handle_action({ type: 'turn', num: hypo_game.state.turn_count, currentPlayerIndex: hypo_game.state.nextPlayerIndex(hypo_game.state.ourPlayerIndex) });
	hypo_game.catchup = false;

	logger.highlight('green', '------- EXITING HYPO --------');

	if (action.hypothetical && hypo_game.moveHistory.at(-1).move === CLUE_INTERP.NONE) {
		logger.flush(false);
		return undefined;
	}

	/** @type {string} */
	let reason;

	const get_finessed_cards = (game) => {
		return game.state.hands[action.giver].filter(c => !game.common.thoughts[c.order].clued && game.common.thoughts[c.order].finessed);
	};

	const finessed_before_clue = get_finessed_cards(game);
	const finessed_after_clue = get_finessed_cards(hypo_game);
	const lost_finesse = finessed_before_clue.filter(c => finessed_after_clue.find(other => other.order == c.order) === undefined);
	if (lost_finesse.length > 0) {
		reason = `cards ${lost_finesse.map(c => logCard(state.deck[c.order])).join(', ')} lost finesse`;
	} else {
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
				old_card.reset || !state.hasConsistentInferences(old_card) || old_card.inferred.length === 0 ||	// Didn't match inference even before clue
				(clued && isTrash(state, game.me, visible_card, order, { infer: true })) ||				// Previously-clued duplicate or recently became basic trash
				bad_touch_cards.some(b => b.order === order) ||											// Bad touched
				card.possible.every(id => isTrash(hypo_game.state, hypo_game.common, id, order, { infer: true }));		// Known trash

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

	const { new_touched, fill } = elim_result(hypo_state, common, hypo_common, hand, list);
	const { bad_touch, trash, avoidable_dupe } = bad_touch_result(game, hypo_game, hypo_common, giver, target);
	const { finesses, playables } = playables_result(hypo_state, common, hypo_common);
	const chop_moved = cm_result(common, hypo_common, hand);

	return { elim: fill, new_touched, bad_touch, trash, avoidable_dupe, finesses, playables, chop_moved, remainder: 0 };
}
