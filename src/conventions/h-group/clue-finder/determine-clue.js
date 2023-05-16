import { CLUE } from '../../../constants.js';
import { card_value, clue_safe } from './clue-safe.js';
import { determine_focus, find_chop, find_bad_touch } from '../hanabi-logic.js';
import { cardTouched, isCluable } from '../../../variants.js';
import { isBasicTrash, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

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
 * Generates a list of clues that would touch the card.
 * @param {State} state
 * @param {number} target
 * @param {Card} card
 * @param {Partial<ClueOptions>} [options] 	Any additional options when determining clues.
 */
export function direct_clues(state, target, card, options) {
	const direct_clues = [];

	if (!options?.excludeColour) {
		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			const clue = { type: CLUE.COLOUR, value: suitIndex, target };

			if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue)) {
				direct_clues.push(clue);
			}
		}
	}

	if (!options?.excludeRank) {
		for (let rank = 1; rank <= 5; rank++) {
			const clue = { type: CLUE.RANK, value: rank, target };

			if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue)) {
				direct_clues.push(clue);
			}
		}
	}

	return direct_clues;
}

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

	logger.highlight('green', `------- ENTERING HYPO ${Utils.logClue(clue)} --------`);

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
			reason = `card ${Utils.logCard(incorrect_card)} lost all inferences and was reset`;
		}
		else if (!incorrect_card.matches_inferences()) {
			reason = `card ${Utils.logCard(incorrect_card)} has inferences [${incorrect_card.inferred.map(c => Utils.logCard(c)).join(',')}], doesn't match`;
		}
		else {
			const not_trash_possibility = incorrect_card.possible.find(c => !isTrash(hypo_state, target, c.suitIndex, c.rank, incorrect_card.order));
			if (not_trash_possibility !== undefined) {
				reason = `card ${Utils.logCard(incorrect_card)} has ${not_trash_possibility} possibility not trash`;
			}
		}
		logger.info(`${Utils.logClue(clue)} has incorrect interpretation, (${reason})`);
		return undefined;
	}

	return hypo_state;
}

/**
 * Returns some statistics about the clue.
 * @param  {State} state
 * @param  {State} hypo_state
 * @param  {Clue} clue
 */
export function get_result(state, hypo_state, clue) {
	const { target } = clue;
	const hand = state.hands[target];

	const touch = hand.clueTouched(state.suits, clue);
	const list = touch.map(c => c.order);

	const { focused_card } = determine_focus(hand, list, { beforeClue: true });
	const bad_touch_cards = find_bad_touch(state, touch.filter(c => !c.clued), focused_card.order);

	let elim = 0, new_touched = 0, bad_touch = 0, trash = 0;

	// Count the number of cards that have increased elimination (i.e. cards that were "filled in")
	for (let i = 0; i < state.hands[target].length; i++) {
		const old_card = state.hands[target][i];
		const hypo_card = hypo_state.hands[target][i];

		if (hypo_card.clued && hypo_card.inferred.length < old_card.inferred.length && hypo_card.matches_inferences()) {
			if (hypo_card.newly_clued) {
				new_touched++;
			}
			elim++;
		}
	}

	for (const card of hypo_state.hands[target]) {
		if (bad_touch_cards.some(c => c.order === card.order)) {
			// Known trash
			if (card.possible.every(p => isTrash(hypo_state, target, p.suitIndex, p.rank, card.order))) {
				trash++;
			}
			else {
				// Don't double count bad touch when cluing two of the same card
				// Focused card should not be bad touched?
				if (bad_touch_cards.some(c => c.matches(card.suitIndex, card.rank) && c.order > card.order) || focused_card.order === card.order) {
					continue;
				}
				bad_touch++;
			}
		}
	}

	let finesses = 0;
	const playables = [];

	// Count the number of finesses and newly known playable cards
	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		for (let rank = state.hypo_stacks[suitIndex] + 1; rank <= hypo_state.hypo_stacks[suitIndex]; rank++) {
			// Find the card
			let found = false;
			for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
				const hand = state.hands[playerIndex];

				for (let j = 0; j < hand.length; j++) {
					const old_card = hand[j];
					const hypo_card = hypo_state.hands[playerIndex][j];

					// TODO: This might not find the right card if it was duplicated...
					if ((hypo_card.clued || hypo_card.finessed || hypo_card.chop_moved) &&
						hypo_card.matches(suitIndex, rank, { infer: true })
					) {
						if (hypo_card.finessed && !old_card.finessed) {
							finesses++;
						}
						playables.push({ playerIndex, card: old_card });
						found = true;
						break;
					}
				}

				if (found) {
					break;
				}
			}
		}
	}

	const new_chop = hypo_state.hands[target][find_chop(hypo_state.hands[target], { afterClue: true })];
	const remainder = (new_chop !== undefined) ? card_value(state, new_chop) : 0;

	return { elim, new_touched, bad_touch, trash, finesses, playables, remainder };
}

/**
 * Returns the best clue to focus the target card.
 * @param {State} state
 * @param {number} target 					The player index with the card.
 * @param {Card} target_card 				The card to be focused.
 * @param {Partial<ClueOptions>} [options] 	Any additional options when determining clues.
 * @returns {Clue}							The best clue (if valid), otherwise undefined.
 */
export function determine_clue(state, target, target_card, options) {
	logger.info('determining clue to target card', Utils.logCard(target_card));
	const hand = state.hands[target];

	// All play clues should be safe, but save clues may not be (e.g. crit 4, 5 of different colour needs to identify that 5 is a valid clue)
	const possible_clues = direct_clues(state, target, target_card, options).filter(clue => options.save ? true : clue_safe(state, clue));

	/** @type {ClueResult[]} */
	const results = [];

	for (const clue of possible_clues) {
		const touch = hand.clueTouched(state.suits, clue);
		const list = touch.map(c => c.order);

		const { focused_card, chop } = determine_focus(hand, list, { beforeClue: true });
		if (focused_card.order !== target_card.order) {
			logger.info(`${Utils.logClue(clue)} focuses ${Utils.logCard(focused_card)} instead of ${Utils.logCard(target_card)}, ignoring`);
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
		const { elim, new_touched, bad_touch, trash, finesses, playables, remainder } = get_result(state, hypo_state, clue);

		const result_log = {
			clue: Utils.logClue(clue),
			bad_touch,
			trash,
			interpret: interpret?.map(c => Utils.logCard(c)),
			elim,
			new_touched,
			finesses,
			playables: playables.map(({ playerIndex, card }) => {
				return { player: state.playerNames[playerIndex], card: Utils.logCard(card) };
			}),
			remainder: chop ? remainder : 0 	// We only need to check remainder if this clue focuses chop, because we are changing chop to something else
		};
		logger.info('result,', JSON.stringify(result_log));

		results.push({ clue, touch, interpret, elim, new_touched, bad_touch, trash, finesses, playables, remainder: chop ? remainder: 0 });
	}

	if (results.length === 0) {
		return;
	}

	const best_result = Utils.maxOn(results, find_clue_value);
	const { clue } = best_result;

	// Change type from CLUE to ACTION
	return { type: clue.type, value: clue.value, target: clue.target, result: best_result };
}
