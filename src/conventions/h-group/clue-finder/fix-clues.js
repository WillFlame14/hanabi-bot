import { LEVEL } from '../h-constants.js';
import { direct_clues } from './determine-clue.js';
import { isBasicTrash, isSaved, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').FixClue} FixClue
 */

/**
 * Finds fix clues for all players. All valid play clues and save clues are also needed
 * as they might be able to elim fix at the same time.
 * @param {State} state
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 * @param {{ignorePlayerIndex?: number}} options
 */
export function find_fix_clues(state, play_clues, save_clues, options = {}) {
	/** @type {FixClue[][]} */
	const fix_clues = [];
	const duplicated_cards = [];

	// Skip ourselves
	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;
		fix_clues[target] = [];

		if (state.level <= LEVEL.FIX || target === options.ignorePlayerIndex) {
			continue;
		}

		const hand = state.hands[target];

		for (const card of hand) {
			// Card known (or known trash), doesn't need fix
			if (card.possible.length === 1 || card.possible.every(c => isBasicTrash(state, c.suitIndex, c.rank))) {
				continue;
			}

			// Card chop moved but not clued, don't fix
			if (card.chop_moved && !card.clued) {
				continue;
			}

			if (card.inferred.length === 0) {
				// TODO
				logger.error(`card ${logCard(card)} order ${card.order} need fix??`);
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
				const duplicate = visibleFind(state, state.ourPlayerIndex, card.suitIndex, card.rank, { ignore: [state.ourPlayerIndex] }).find(c => {
					return c.order !== card.order && (c.finessed || c.clued);
				});

				const unknown_duplicated = card.clued && card.inferred.length > 1 && duplicate !== undefined;

				let fix_criteria;
				if (wrong_inference) {
					fix_criteria = inference_corrected;
					logger.info(`card ${logCard(card)} needs fix, wrong inferences ${card.inferred.map(c => logCard(c))}`);
				}
				// We only want to give a fix clue to the player whose turn comes sooner
				else if (unknown_duplicated && !duplicated_cards.some(c => c.matches(card.suitIndex, card.rank))) {
					const matching_connection = state.waiting_connections.find(({ connections }) => connections.some(conn => conn.card.order === duplicate.order));
					let needs_fix = true;

					if (matching_connection !== undefined) {
						const { connections, conn_index } = matching_connection;
						const connection_index = connections.findIndex(conn => conn.card.order === duplicate.order);
						logger.info(connections, conn_index, connection_index);
						// The card is part of a finesse connection that hasn't been played yet
						if (conn_index <= connection_index) {
							logger.warn(`duplicate ${logCard(card)} part of a finesse, not giving fix yet`);
							needs_fix = false;
						}
					}

					if (needs_fix) {
						fix_criteria = duplication_known;
						duplicated_cards.push(card);
						logger.info(`card ${logCard(card)} needs fix, duplicated`);
					}
				}

				// Card doesn't match any inferences and seems playable but isn't (need to fix)
				if (fix_criteria !== undefined) {
					let found_clue = false;

					// Try all play clues and save clue if it exists
					const other_clues = play_clues[target].concat(save_clues[target] !== undefined ? [save_clues[target]] : []);

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						// The clue cannot touch the fixed card or it will look like just a fix
						if (hand.clueTouched(clue).some(c => c.order === card.order)) {
							continue;
						}

						const { fixed, trash } = check_fixed(state, target, card, clue, fix_criteria);

						if (fixed) {
							// TODO: Find the highest value play clue
							// logger.info(`found fix ${logClue(clue)} for card ${logCard(card)} to inferences [${card_after_cluing.inferred.map(c => logCard(c)).join(',')}]`);
							fix_clues[target].push(Object.assign({}, clue, { trash, urgent: seems_playable }));
							found_clue = true;
							break;
						}
					}

					if (found_clue) {
						continue;
					}

					const possible_clues = direct_clues(state, target, card);
					for (const clue of possible_clues) {
						const { fixed, trash } = check_fixed(state, target, card, clue, fix_criteria);

						if (fixed) {
							fix_clues[target].push(Object.assign(clue, { trash, urgent: seems_playable }));
							break;
						}
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
	const touch = hand.clueTouched(clue);

	const action =  /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue });

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	const hypo_state = state.simulate_clue(action, { enableLogs: true, simulatePlayerIndex: target });
	const card_after_cluing = hypo_state.hands[target].find(c => c.order === card.order);

	const result = {
		fixed: fix_criteria(hypo_state, card_after_cluing, target),
		trash: card_after_cluing.possible.every(p => isTrash(hypo_state, target, p.suitIndex, p.rank, card_after_cluing.order))
	};

	logger.flush(result.fixed);

	return result;
}
