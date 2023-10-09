import { Card } from '../../basics/Card.js';
import { isTrash, playableAway, visibleFind } from '../../basics/hanabi-util.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 */

/**
 * Returns the cards in hand that could be targets for a sarcastic discard.
 * @param {Hand} hand
 * @param {number} suitIndex
 * @param {number} rank
 */
export function find_sarcastic(hand, suitIndex, rank) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = hand.findCards(suitIndex, rank, { symmetric: true, infer: true });
	if (known_sarcastic.length > 0) {
		return known_sarcastic;
	}
	// Otherwise, find all cards that could match that identity
	return hand.filter(c =>
		c.clued && c.possible.some(p => p.matches(suitIndex, rank)) &&
		!(c.inferred.length === 1 && c.inferred[0].rank < rank));		// Do not sarcastic on connecting cards
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 */
function undo_hypo_stacks(state, suitIndex, rank) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	for (const hypo_stacks of state.hypo_stacks) {
		if (hypo_stacks[suitIndex] >= rank) {
			hypo_stacks[suitIndex] = rank - 1;
		}
	}
}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {State} state
 * @param {Card[]} sarcastic
 * @param {number} suitIndex
 * @param {number} rank
 */
function apply_unknown_sarcastic(state, sarcastic, suitIndex, rank) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const s of sarcastic) {
		s.union('inferred', [new Card(suitIndex, rank)]);
	}

	/** @param {Card} card */
	const playable = (card) => {
		return card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0);
	};

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(s => !playable(s))) {
		undo_hypo_stacks(state, suitIndex, rank);
	}
}

/**
 * Locks the other player after a late sacrifice discard.
 * @param  {State} state
 * @param  {number} playerIndex 	The player that performed a sacrifice discard.
 */
function apply_locked_discard(state, playerIndex) {
	const other = (playerIndex + 1) % state.numPlayers;

	logger.highlight('cyan', `sacrifice discard, locking ${state.playerNames[other]}`);

	// Chop move all cards
	for (const card of state.hands[other]) {
		if (!card.clued && !card.finessed && !card.chop_moved) {
			card.chop_moved = true;
		}
	}
}

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {State} state
 * @param {import('../../types.js').DiscardAction} action
 * @param {Card} card
 */
export function interpret_discard(state, action, card) {
	const { order, playerIndex, rank, suitIndex, failed } = action;
	const other = (playerIndex + 1) % state.numPlayers;

	const locked_discard = state.hands[playerIndex].isLocked() && !state.last_actions[other].lock;

	Basics.onDiscard(this, action);

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!card.rewinded && (failed || (!card.matches_inferences() && !isTrash(state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order)))) {
		logger.info('all inferences', card.inferred.map(c => logCard(c)));

		const action_index = card.drawn_index;
		state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, card.finessed);
		return;
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (card.clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		const duplicates = visibleFind(state, playerIndex, suitIndex, rank);

		// Card was bombed
		if (failed) {
			undo_hypo_stacks(state, suitIndex, rank);
		}
		else {
			// Unknown sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], suitIndex, rank);

				if (sarcastic.length === 1) {
					sarcastic[0].intersect('inferred', [{ suitIndex, rank }]);
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, suitIndex, rank);
					if (locked_discard) {
						apply_locked_discard(state, playerIndex);
					}
				}
			}
			// Sarcastic discard to other (or known sarcastic discard to us)
			else {
				for (let i = 0; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], suitIndex, rank);

					if (sarcastic.some(c => c.matches(suitIndex, rank, { infer: receiver === state.ourPlayerIndex }) && c.clued)) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							sarcastic[0].inferred = [new Card(suitIndex, rank)];
							logger.info(`writing ${logCard({suitIndex, rank})} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, suitIndex, rank);
							if (locked_discard) {
								apply_locked_discard(state, playerIndex);
							}
						}
						return;
					}
				}
				logger.warn(`couldn't find a valid target for sarcastic discard`);
			}
		}
	}
}
