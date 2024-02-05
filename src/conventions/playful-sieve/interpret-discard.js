import { Hand } from '../../basics/Hand.js';
import { isTrash, playableAway, visibleFind } from '../../basics/hanabi-util.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 */

/**
 * Returns the cards in hand that could be targets for a sarcastic discard.
 * @param {Hand} hand
 * @param {Player} player
 * @param {Identity} identity
 */
export function find_sarcastic(hand, player, identity) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = hand.filter(c => player.thoughts[c.order].matches(identity, { infer: true }));
	if (known_sarcastic.length > 0)
		return known_sarcastic;

	// Otherwise, find all cards that could match that identity
	return Array.from(hand.filter(c => {
		const card = player.thoughts[c.order];

		return c.clued && card.possible.some(p => p.matches(identity)) &&
			!(card.inferred.length === 1 && card.inferred[0].rank < identity.rank);		// Do not sarcastic on connecting cards
	}));
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {State} state
 * @param {Identity} identity
 */
function undo_hypo_stacks(state, { suitIndex, rank }) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	state.common.hypo_stacks[suitIndex] = Math.min(state.common.hypo_stacks[suitIndex], rank - 1);}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {State} state
 * @param {ActualCard[]} sarcastic
 * @param {Identity} identity
 */
function apply_unknown_sarcastic(state, sarcastic, identity) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const { order } of sarcastic)
		state.common.thoughts[order].union('inferred', [identity]);

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(({ order }) => state.common.thoughts[order].inferred.some(c => playableAway(state, c) > 0)))
		undo_hypo_stacks(state, identity);
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
	for (const { order } of state.hands[other]) {
		const card = state.common.thoughts[order];
		if (!card.clued && !card.finessed && !card.chop_moved)
			card.chop_moved = true;
	}
}

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {State} state
 * @param {import('../../types.js').DiscardAction} action
 * @param {ActualCard} card
 */
export function interpret_discard(state, action, card) {
	const { common } = state;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };
	const thoughts = common.thoughts[order];
	const other = (playerIndex + 1) % state.numPlayers;

	const locked_discard = common.thinksLocked(state, playerIndex) && !state.last_actions[other].lock;

	Basics.onDiscard(this, action);

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && (failed || (!thoughts.matches_inferences() && !isTrash(state, state.me, card, card.order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = card.drawn_index;
		state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, thoughts.finessed);
		return;
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (card.clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		const duplicates = visibleFind(state, state.me, identity);
		common.restore_elim(card);

		// Card was bombed
		if (failed) {
			undo_hypo_stacks(state, identity);
		}
		else {
			// Unknown sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], state.me, identity);

				if (sarcastic.length === 1) {
					logger.info('writing sarcastic on slot', state.hands[state.ourPlayerIndex].findIndex(c => c.order === sarcastic[0].order) + 1);
					common.thoughts[sarcastic[0].order].intersect('inferred', [identity]);
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, identity);
					if (locked_discard)
						apply_locked_discard(state, playerIndex);
				}
			}
			// Sarcastic discard to other (or known sarcastic discard to us)
			else {
				for (let i = 0; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], state.me, identity);

					if (sarcastic.some(c => state.me.thoughts[c.order].matches(identity, { infer: receiver === state.ourPlayerIndex }) && c.clued)) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							common.thoughts[sarcastic[0].order].assign('inferred', [identity]);
							logger.info(`writing ${logCard(identity)} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, identity);
							if (locked_discard)
								apply_locked_discard(state, playerIndex);
						}
						return;
					}
				}
				logger.warn(`couldn't find a valid target for sarcastic discard`);
			}
		}
	}

	// Discarding while partner is locked and having a playable card
	if (common.thinksLocked(state, other)) {
		const playables = common.thinksPlayables(state, playerIndex);

		for (const card of playables)
			state.locked_shifts[card.order] = (state.locked_shifts[card.order] ?? 0) + 1;
	}

	// No safe action, chop is playable
	if (!common.thinksLocked(state, other) && !common.thinksLoaded(state, other) && !state.hands[other].some(c => common.thoughts[c.order].called_to_discard)) {
		const playable_possibilities = state.play_stacks.map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});

		if (common.thoughts[card.order].inferred.length === 1)
			playable_possibilities[suitIndex] = { suitIndex, rank: rank + 1 };

		const chop = common.thoughts[state.hands[other][0].order];
		chop.old_inferred = chop.inferred.slice();
		chop.finessed = true;
		chop.intersect('inferred', playable_possibilities);
	}
}
