import { IdentitySet } from '../../basics/IdentitySet.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import { undo_hypo_stacks } from '../../basics/helper.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
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
export function find_sarcastics(hand, player, identity) {
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
 * @param {Game} game
 * @param {ActualCard[]} sarcastic
 * @param {Identity} identity
 */
function apply_unknown_sarcastic(game, sarcastic, identity) {
	const { common, state } = game;

	// Need to add the inference back if it was previously eliminated due to good touch
	for (const { order } of sarcastic) {
		const card = common.thoughts[order];
		card.inferred = card.inferred.union(identity);
	}

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(({ order }) => common.thoughts[order].inferred.some(c => state.playableAway(c) > 0)))
		undo_hypo_stacks(game, identity);
}

/**
 * Locks the other player after a late sacrifice discard.
 * @param  {Game} game
 * @param  {number} playerIndex 	The player that performed a sacrifice discard.
 */
function apply_locked_discard(game, playerIndex) {
	const { state } = game;
	const other = (playerIndex + 1) % state.numPlayers;

	logger.highlight('cyan', `sacrifice discard, locking ${state.playerNames[other]}`);

	// Chop move all cards
	for (const { order } of state.hands[other]) {
		const card = game.common.thoughts[order];
		if (!card.clued && !card.finessed && !card.chop_moved)
			card.chop_moved = true;
	}
}

/**
 * @param {Game} game
 * @param {DiscardAction} discardAction
 * @returns {ActualCard[]} 					The targets for the sarcastic discard
 */
export function interpret_sarcastic(game, discardAction) {
	const { common, me, state } = game;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	const duplicates = visibleFind(state, me, identity);
	const locked_discard = state.numPlayers === 2 && common.thinksLocked(state, playerIndex) && !game.last_actions[(playerIndex + 1) % state.numPlayers].lock;

	// Unknown sarcastic discard to us
	if (duplicates.length === 0) {
		const sarcastics = find_sarcastics(state.hands[state.ourPlayerIndex], me, identity);

		if (sarcastics.length === 1) {
			logger.info('writing sarcastic on slot', state.hands[state.ourPlayerIndex].findIndex(c => c.order === sarcastics[0].order) + 1);
			const common_sarcastic = common.thoughts[sarcastics[0].order];
			common_sarcastic.inferred = common_sarcastic.inferred.intersect(identity);
		}
		else {
			apply_unknown_sarcastic(game, sarcastics, identity);
			if (locked_discard)
				apply_locked_discard(game, playerIndex);
		}
		return sarcastics;
	}

	// Sarcastic discard to other (or known sarcastic discard to us)
	for (let i = 0; i < state.numPlayers; i++) {
		const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
		const sarcastics = find_sarcastics(state.hands[receiver], me, identity);

		if (sarcastics.some(c => me.thoughts[c.order].matches(identity, { infer: receiver === state.ourPlayerIndex }) && c.clued)) {
			// The matching card must be the only possible option in the hand to be known sarcastic
			if (sarcastics.length === 1) {
				common.thoughts[sarcastics[0].order].inferred = IdentitySet.create(state.variant.suits.length, identity);
				logger.info(`writing ${logCard(identity)} from sarcastic discard`);
			}
			else {
				apply_unknown_sarcastic(game, sarcastics, identity);
				if (locked_discard)
					apply_locked_discard(game, playerIndex);
			}
			return sarcastics;
		}
	}

	logger.warn(`couldn't find a valid target for sarcastic discard`);
	return [];
}
