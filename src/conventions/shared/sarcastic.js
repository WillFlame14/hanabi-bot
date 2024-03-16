import { IdentitySet } from '../../basics/IdentitySet.js';
import { playableAway, visibleFind } from '../../basics/hanabi-util.js';
import { undo_hypo_stacks } from '../../basics/helper.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
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

		return c.clued && card.possible.has(identity) &&
			!(card.inferred.length === 1 && card.inferred.array[0].rank < identity.rank);		// Do not sarcastic on connecting cards
	}));
}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {State} state
 * @param {ActualCard[]} sarcastic
 * @param {Identity} identity
 */
function apply_unknown_sarcastic(state, sarcastic, identity) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const { order } of sarcastic) {
		const card = state.common.thoughts[order];
		card.inferred = card.inferred.union(identity);
	}

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
 * @param {State} state
 * @param {DiscardAction} discardAction
 */
export function interpret_sarcastic(state, discardAction) {
	const { common } = state;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	const duplicates = visibleFind(state, state.me, identity);
	const locked_discard = state.numPlayers === 2 && common.thinksLocked(state, playerIndex) && !state.last_actions[(playerIndex + 1) % state.numPlayers].lock;

	// Unknown sarcastic discard to us
	if (duplicates.length === 0) {
		const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], state.me, identity);

		if (sarcastic.length === 1) {
			logger.info('writing sarcastic on slot', state.hands[state.ourPlayerIndex].findIndex(c => c.order === sarcastic[0].order) + 1);
			const common_sarcastic = common.thoughts[sarcastic[0].order];
			common_sarcastic.inferred = common_sarcastic.inferred.intersect(identity);
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
					common.thoughts[sarcastic[0].order].inferred = IdentitySet.create(state.variant.suits.length, identity);
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
