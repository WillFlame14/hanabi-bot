import { direct_clues } from './determine-clue.js';
import { isBasicTrash, isSaved, isTrash, playableAway } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').FixClue} FixClue
 */

/**
 * Finds fix clues for all players. All valid play clues and save clues are also needed
 * as they might be able to elim fix at the same time.
 * @param {State} state
 * @param {Clue[][]} play_clues
 * @param {Clue[]} save_clues
 * @param {{ignorePlayerIndex?: number}} options
 */
export function find_fix_clues(state, play_clues, save_clues, options = {}) {
	/** @type {FixClue[][]} */
	const fix_clues = [];

	for (let target = 0; target < state.numPlayers; target++) {
		fix_clues[target] = [];
		// Ignore our own hand
		if (target === state.ourPlayerIndex || target === options.ignorePlayerIndex) {
			continue;
		}

		const hand = state.hands[target];

		for (const card of hand) {
			// Card known (or known trash), doesn't need fix
			if (card.possible.length === 1 || card.possible.every(c => isBasicTrash(state, c.suitIndex, c.rank))) {
				continue;
			}

			if (card.inferred.length === 0) {
				// TODO
				logger.error(`card ${Utils.logCard(card)} order ${card.order} need fix??`);
			}
			else {
				const seems_playable = card.inferred.every(p => {
					const away = playableAway(state, p.suitIndex, p.rank);
					const our_hand = state.hands[state.ourPlayerIndex];

					// Possibility is immediately playable or 1-away and we have the connecting card
					return away === 0 || (away === 1 && our_hand.some(c => c.matches(p.suitIndex, p.rank - 1, { infer: true })));
				});

				const wrong_inference = !card.matches_inferences() && playableAway(state, card.suitIndex, card.rank) !== 0;

				// We don't need to fix duplicated cards where we hold one copy, since we can just sarcastic discard
				const unknown_duplicated = card.clued && card.inferred.length > 1 &&
					isSaved(state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order, { ignore: [state.ourPlayerIndex] });

				let fix_criteria;
				if (wrong_inference) {
					fix_criteria = inference_corrected;
				}
				else if (unknown_duplicated) {
					fix_criteria = duplication_known;
				}

				// Card doesn't match any inferences and seems playable but isn't (need to fix)
				if (wrong_inference || unknown_duplicated) {
					let found_clue = false;

					const other_clues = Utils.objClone(play_clues[target]);

					// Try the save clue as well if it exists
					if (save_clues[target] !== undefined) {
						other_clues.push(save_clues[target]);
					}

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						// Convert clue type from ACTION to CLUE
						const clue_copy = Utils.objClone(clue);
						clue_copy.type -= 2;

						// The clue cannot touch the fixed card or it will look like just a fix
						if (hand.clueTouched(state.suits, clue_copy).some(c => c.order === card.order)) {
							continue;
						}

						const { fixed, trash } = check_fixed(state, target, card, clue_copy, fix_criteria);

						if (fixed) {
							// TODO: Find the highest value play clue
							// logger.info(`found fix ${Utils.logClue(clue)} for card ${Utils.logCard(card)} to inferences [${card_after_cluing.inferred.map(c => Utils.logCard(c)).join(',')}]`);
							fix_clues[target].push(Object.assign(clue, { trash, urgent: seems_playable }));
							found_clue = true;
							break;
						}
					}

					if (found_clue) {
						continue;
					}

					const possible_clues = direct_clues(state, target, card);
					const fix_clue = possible_clues.find(clue => check_fixed(state, target, card, clue, fix_criteria).fixed);

					if (fix_clue !== undefined) {
						// Change type from CLUE to ACTION
						fix_clue.type += 2;
						fix_clues[target].push(Object.assign(fix_clue, { trash: fix_clue.trash, urgent: seems_playable }));
					}
				}
			}
		}
	}
	return fix_clues;
}

/**
 * A fix criterion. Considered fixed when the card matches at least one of its inferences.
 * @param {State} _state
 * @param {Card} card
 * @param {number} _target
 */
function inference_corrected(_state, card, _target) {
	return card.matches_inferences(); //card.possible.every(p => playableAway(state, p.suitIndex, p.rank) !== 0);
}

/**
 * A fix criterion. Considered fixed when the card becomes known duplicated as an already saved card.
 * @param {State} state
 * @param {Card} card
 * @param {number} target
 */
function duplication_known(state, card, target) {
	return card.possible.length === 1 && isSaved(state, target, card.suitIndex, card.rank, card.order);
}

/**
 * Checks whether the given card is fixed by the clue, according to the fix criteria.
 * @param {State} state
 * @param {number} target
 * @param {Card} card
 * @param {Clue} clue
 * @param {(state: State, card: Card, target: number) => boolean} fix_criteria
 */
function check_fixed(state, target, card, clue, fix_criteria) {
	const hand = state.hands[target];
	const touch = hand.clueTouched(state.suits, clue);

	const action = { type: 'clue', giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue };

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	const hypo_state = state.simulate_clue(action, { enableLogs: true, simulatePlayerIndex: target });
	const card_after_cluing = hypo_state.hands[target].find(c => c.order === card.order);

	const result = {
		fixed: fix_criteria(hypo_state, card_after_cluing, target),
		trash: card.possible.every(p => isTrash(hypo_state, target, p.suitIndex, p.rank, card_after_cluing.order))
	};

	logger.flush(result.fixed);

	return result;
}
