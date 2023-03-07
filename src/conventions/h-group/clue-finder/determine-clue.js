import { CLUE } from '../../../constants.js';
import { clue_safe } from './clue-safe.js';
import { determine_focus, find_bad_touch } from '../hanabi-logic.js';
import { cardTouched, isCluable } from '../../../variants.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 *
 * @typedef {{ excludeColour: boolean, excludeRank: boolean }} ClueOptions
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

	const possible_clues = direct_clues(state, target, target_card, options).filter(clue => clue_safe(state, clue));

	/** @type {ClueResult[]} */
	const results = [];

	for (const clue of possible_clues) {
		const touch = hand.clueTouched(state.suits, clue);
		const list = touch.map(c => c.order);

		const bad_touch_cards = find_bad_touch(state, touch.filter(c => !c.clued));		// Ignore cards that were already clued
		const { focused_card } = determine_focus(hand, list, { beforeClue: true });

		if (focused_card.order !== target_card.order) {
			logger.info(`${Utils.logClue(clue)} doesn't focus, ignoring`);
			continue;
		}

		// Simulate clue from receiver's POV to see if they have the right interpretation
		const action = { type: 'clue', giver: state.ourPlayerIndex, target, list, clue };

		// Prevent outputting logs until we know that the result is correct
		logger.collect();

		logger.info('------- ENTERING HYPO --------');

		let hypo_state = state.simulate_clue(action, { enableLogs: true });

		logger.info('------- EXITING HYPO --------');

		const card_after_cluing = hypo_state.hands[target].find(c => c.order === target_card.order);
		const { inferred: inferred_after_cluing } = card_after_cluing;
		let elim = 0;
		let new_touched = 0;

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

		const interpret = inferred_after_cluing;
		const correct = hypo_state.hands[target].every((card, index) => {
			// The focused card must not have been reset and must match inferences
			if (card.order === target_card.order) {
				return !card.reset && card.matches_inferences();
			}

			const old_card = state.hands[target][index];

			// For non-focused cards:
			return (!card.reset && card.matches_inferences()) || 		// Matches inferences
				((old_card.reset || !old_card.matches_inferences()) ||	// Didn't match inference even before clue
				bad_touch_cards.some(c => c.order === card.order) ||	// Bad touched
				card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)));	// Known trash
		});

		// Print out logs if the result is correct
		logger.flush(correct);

		if (!correct) {
			logger.info(`${Utils.logClue(clue)} has incorrect interpretation, ignoring`);
			/*logger.info(hypo_state.hands[target].map(card => {
				if (card.reset || !card.matches_inferences()) {
					logger.info(`card ${Utils.logCard(card)} has inferences [${card.inferred.map(c => Utils.logCard(c)).join(',')}] reset? ${card.reset}`);
					logger.info(Utils.logHand(hypo_state.hands[target]));
				}
				if (!card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order))) {
					logger.info(`${Utils.logCard(card.possible.find(c => !isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)))} possibility is not trash`);
				}
				return bad_touch_cards.some(c => c.order === card.order) ||							// Card is bad touched
					card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());										// Card matches interpretation
			}));*/
			continue;
		}

		let bad_touch = 0;
		let trash = 0;
		for (const card of hypo_state.hands[target]) {
			if (bad_touch_cards.some(c => c.order === card.order)) {
				// Known trash
				if (card.possible.every(p => isTrash(hypo_state, target, p.suitIndex, p.rank, card.order))) {
					trash++;
				}
				else {
					// Don't double count bad touch when cluing two of the same card
					if (bad_touch_cards.some(c => c.matches(card.suitIndex, card.rank) && c.order > card.order)) {
						continue;
					}
					bad_touch++;
				}
			}
		}

		// Re-simulate clue, but from our perspective so we can count the playable cards and finesses correctly
		hypo_state = state.simulate_clue(action);

		let finesses = 0;
		const playables = [];

		// Count the number of finesses and newly known playable cards
		logger.info(`hypo stacks before clue: ${state.hypo_stacks}`);
		logger.info(`hypo stacks after clue:  ${hypo_state.hypo_stacks}`);
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
			})
		};
		logger.info('result,', result_log);

		results.push({ clue, touch, interpret, elim, new_touched, bad_touch, trash, finesses, playables});
	}

	if (results.length === 0) {
		return;
	}

	const fields = [
		{ field: 'bad_touch', reverse: true },
		{ field: 'finesses' },
		{ field: 'playables', length: true },
		{ field: 'new_touched' },
		{ field: 'elim' },
		{ field: 'interpret', reverse: true, length: true }
	];

	const best_result = filterMax(results, fields);
	const { clue } = best_result;

	// Change type from CLUE to ACTION
	return { type: clue.type + 2, value: clue.value, target: clue.target, result: best_result };
}

/**
 * Given an array of objects, returns the element that has the highest value based on the given fields.
 * @template T
 * @param {T[]} array
 * @param {{field: string, reverse?: boolean, length?: boolean}[]} fields
 */
function filterMax(array, fields) {
	let field_index = 0;

	while (array.length > 1 && field_index < fields.length) {
		const { field, reverse, length } = fields[field_index];
		let max = [array[0]];

		for (let i = 1; i < array.length; i++) {
			const item = array[i];
			let arg1 = item[field], arg2 = max[0][field];

			if (length) {
				arg1 = arg1.length;
				arg2 = arg2.length;
			}

			if (reverse) {
				const arg3 = arg1;
				arg1 = arg2;
				arg2 = arg3;
			}

			if (arg1 > arg2) {
				max = [item];
			}
			else if (arg1 === arg2) {
				max.push(item);
			}
		}
		array = max;
		field_index++;
	}

	return array[0];
}
