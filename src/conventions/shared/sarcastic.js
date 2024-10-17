import { IdentitySet } from '../../basics/IdentitySet.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import { undo_hypo_stacks } from '../../basics/helper.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 */

/**
 * Returns the cards in hand that could be targets for a sarcastic discard.
 * @param {State} state
 * @param {number} playerIndex
 * @param {Player} player
 * @param {Identity} identity
 */
export function find_sarcastics(state, playerIndex, player, identity) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = state.hands[playerIndex].filter(o => player.thoughts[o].matches(identity, { infer: true }));
	if (known_sarcastic.length > 0)
		return known_sarcastic;

	// Otherwise, find all cards that could match that identity
	return state.hands[playerIndex].filter(o => {
		const card = player.thoughts[o];

		return state.deck[o].clued && card.possible.has(identity) &&
			!(card.inferred.length === 1 && card.inferred.array[0].rank < identity.rank);		// Do not sarcastic on connecting cards
	});
}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {Game} game
 * @param {number[]} sarcastic
 * @param {Identity} identity
 */
function apply_unknown_sarcastic(game, sarcastic, identity) {
	const { common, state } = game;

	// Need to add the inference back if it was previously eliminated due to good touch
	for (const order of sarcastic) {
		common.updateThoughts(order, (draft) => {
			draft.inferred = common.thoughts[order].inferred.union(identity);
			draft.trash = false;
		});
	}

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(order => common.thoughts[order].inferred.some(c => state.playableAway(c) > 0)))
		undo_hypo_stacks(game, identity);
}

/**
 * Locks the other player after a late sacrifice discard.
 * @param  {Game} game
 * @param  {number} playerIndex 	The player that performed a sacrifice discard.
 */
function apply_locked_discard(game, playerIndex) {
	const { common, state } = game;
	const other = (playerIndex + 1) % state.numPlayers;

	logger.highlight('cyan', `sacrifice discard, locking ${state.playerNames[other]}`);

	// Chop move all cards
	for (const order of state.hands[other]) {
		const card = common.thoughts[order];
		if (!card.clued && !card.finessed && !card.chop_moved)
			common.updateThoughts(order, (draft) => { draft.chop_moved = true; });
	}
}

/**
 * @param {Game} game
 * @param {DiscardAction} discardAction
 * @returns {number[]} 					The targets for the sarcastic discard
 */
export function interpret_sarcastic(game, discardAction) {
	const { common, me, state } = game;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	const duplicates = visibleFind(state, me, identity);
	const locked_discard = state.numPlayers === 2 && common.thinksLocked(state, playerIndex) && !game.last_actions[(playerIndex + 1) % state.numPlayers].lock;

	// Unknown sarcastic discard to us
	if (duplicates.length === 0) {
		if (playerIndex === state.ourPlayerIndex)
			return [];

		const sarcastics = find_sarcastics(state, state.ourPlayerIndex, me, identity);

		if (sarcastics.length === 1) {
			logger.info('writing sarcastic on slot', state.ourHand.findIndex(o => o === sarcastics[0]) + 1);
			common.updateThoughts(sarcastics[0], (common_sarcastic) => {
				common_sarcastic.inferred = common_sarcastic.inferred.intersect(identity);
				common_sarcastic.trash = false;
			});
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
		const sarcastics = find_sarcastics(state, receiver, common, identity);

		if (sarcastics.some(o => me.thoughts[o].matches(identity, { infer: receiver === state.ourPlayerIndex }) && state.deck[o].clued)) {
			// The matching card must be the only possible option in the hand to be known sarcastic
			if (sarcastics.length === 1) {
				common.updateThoughts(sarcastics[0], (draft) => { draft.inferred = IdentitySet.create(state.variant.suits.length, identity); });
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
