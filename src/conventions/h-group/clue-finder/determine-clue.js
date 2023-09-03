import { clue_safe } from './clue-safe.js';
import { determine_focus, find_bad_touch } from '../hanabi-logic.js';
import { cardValue, direct_clues, isTrash } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';
import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';
import { bad_touch_result, elim_result, playables_result } from '../../../basics/clue-result.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 *
 * @typedef {{ excludeColour: boolean, excludeRank: boolean, save: boolean }} ClueOptions
 */

/**
 * Evaluates the result of a clue. Returns the hypothetical state after the clue if correct, otherwise undefined.
 * @param  {State} state
 * @param  {ClueAction} action
 * @param  {Clue} clue
 * @param  {number} target
 * @param  {Card} target_card
 * @param  {Card[]} bad_touch_cards
 */
export function evaluate_clue(state, action, clue, target, target_card, bad_touch_cards) {
	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	logger.highlight('green', `------- ENTERING HYPO ${logClue(clue)} --------`);

	const hypo_state = state.simulate_clue(action, { enableLogs: true });

	logger.highlight('green', '------- EXITING HYPO --------');

	const incorrect_card = hypo_state.hands[target].find((card, index) => {
		// The focused card must not have been reset and must match inferences
		if (card.order === target_card.order) {
			return !(!card.reset && card.matches_inferences());
		}

		const old_card = state.hands[target][index];

		// For non-focused cards:
		return !((!card.reset && card.matches_inferences()) || 											// Matches inferences
			old_card.reset || !old_card.matches_inferences() || old_card.inferred.length === 0 ||		// Didn't match inference even before clue
			card.chop_moved ||																			// Chop moved (might have become trash)
			(old_card.clued && isTrash(state, state.ourPlayerIndex, card.suitIndex, card.rank)) ||		// Previously-clued duplicate or recently became basic trash
			bad_touch_cards.some(c => c.order === card.order) ||										// Bad touched
			card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)));	// Known trash
	});

	// Print out logs if the result is correct
	logger.flush(incorrect_card === undefined);

	if (incorrect_card) {
		let reason = '';
		if (incorrect_card.reset) {
			reason = `card ${logCard(incorrect_card)} lost all inferences and was reset`;
		}
		else if (!incorrect_card.matches_inferences()) {
			reason = `card ${logCard(incorrect_card)} has inferences [${incorrect_card.inferred.map(c => logCard(c)).join(',')}], doesn't match`;
		}
		else {
			const not_trash_possibility = incorrect_card.possible.find(c => !isTrash(hypo_state, target, c.suitIndex, c.rank, incorrect_card.order));
			if (not_trash_possibility !== undefined) {
				reason = `card ${logCard(incorrect_card)} has ${not_trash_possibility} possibility not trash`;
			}
		}
		logger.info(`${logClue(clue)} has incorrect interpretation, (${reason})`);
		return undefined;
	}

	return hypo_state;
}

/**
 * Returns some statistics about the clue.
 * @param  {State} state
 * @param  {State} hypo_state
 * @param  {Clue} clue
 * @param  {number} giver
 * @param  {{touch?: Card[], list?: number[]}} provisions 	Provided 'touch' and 'list' variables if clued in our hand.
 */
export function get_result(state, hypo_state, clue, giver, provisions = {}) {
	const { target } = clue;
	const hand = state.hands[target];

	const touch = provisions.touch ?? hand.clueTouched(clue);
	const list = provisions.list ?? touch.map(c => c.order);

	const { focused_card } = determine_focus(hand, list, { beforeClue: true });
	const bad_touch_cards = find_bad_touch(hypo_state, touch.filter(c => !c.clued), focused_card.order);

	const { new_touched, elim } = elim_result(state, hypo_state, target, list);
	const { bad_touch, trash } = bad_touch_result(hypo_state, target, bad_touch_cards, [focused_card.order]);
	const { finesses, playables } = playables_result(state, hypo_state, giver);

	const new_chop = hypo_state.hands[target].chop({ afterClue: true });
	const remainder = (new_chop !== undefined) ? cardValue(hypo_state, new_chop) :
						hypo_state.hands[target].find_known_trash().length > 0 ? 0 : 4;

	return { elim, new_touched, bad_touch, trash, finesses, playables, remainder };
}

/**
 * Returns the best clue to focus the target card.
 * @param {State} state
 * @param {number} target 					The player index with the card.
 * @param {Card} target_card 				The card to be focused.
 * @param {Partial<ClueOptions>} [options] 	Any additional options when determining clues.
 * @returns {Clue | undefined}				The best clue (if valid).
 */
export function determine_clue(state, target, target_card, options) {
	logger.info('determining clue to target card', logCard(target_card));
	const hand = state.hands[target];

	const possible_clues = direct_clues(state, target, target_card, options);

	/** @type {{ clue: Clue, result: ClueResult}[]} */
	const results = [];

	for (const clue of possible_clues) {
		const touch = hand.clueTouched(clue);
		const list = touch.map(c => c.order);

		const { focused_card, chop } = determine_focus(hand, list, { beforeClue: true });
		if (focused_card.order !== target_card.order) {
			logger.info(`${logClue(clue)} focuses ${logCard(focused_card)} instead of ${logCard(target_card)}, ignoring`);
			continue;
		}

		// All play clues should be safe, but save clues may not be (e.g. crit 4, 5 of different colour needs to identify that 5 is a valid clue)
		if (!options.save && !clue_safe(state, clue)) {
			continue;
		}

		const bad_touch_cards = find_bad_touch(state, touch.filter(c => !c.clued), focused_card.order);		// Ignore cards that were already clued

		// Simulate clue from receiver's POV to see if they have the right interpretation
		const action =  /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });
		const hypo_state = evaluate_clue(state, action, clue, target, target_card, bad_touch_cards);

		// Clue had incorrect interpretation
		if (hypo_state === undefined) {
			continue;
		}

		const interpret = hypo_state.hands[target].find(c => c.order === target_card.order).inferred;
		const result = get_result(state, hypo_state, clue, state.ourPlayerIndex);

		const { elim, new_touched, bad_touch, trash, finesses, playables } = result;
		const remainder = (chop && (!clue_safe(state, clue) || state.clue_tokens <= 2)) ? result.remainder: 0;

		const result_log = {
			clue: logClue(clue),
			bad_touch,
			trash,
			interpret: interpret?.map(c => logCard(c)),
			elim,
			new_touched,
			finesses,
			playables: playables.map(({ playerIndex, card }) => {
				return { player: state.playerNames[playerIndex], card: logCard(card) };
			}),
			remainder	// We only need to check remainder if this clue focuses chop, because we are changing chop to something else
		};
		logger.info('result,', JSON.stringify(result_log), find_clue_value(result));

		results.push({ clue, result: { elim, new_touched, bad_touch, trash, finesses, playables, remainder } });
	}

	if (results.length === 0) {
		return;
	}

	const { clue, result: best_result } = Utils.maxOn(results, ({ result }) => find_clue_value(result));
	logger.info('preferring', logClue(clue));

	// Change type from CLUE to ACTION
	return { type: clue.type, value: clue.value, target: clue.target, result: best_result };
}
