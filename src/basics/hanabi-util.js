import { HAND_SIZE } from '../constants.js';
import { Card } from './Card.js';
import { cardCount } from '../variants.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('../types.js').BasicCard} BasicCard
 * 
 * @typedef {{symmetric?: number[], infer?: number[], ignore?: number[]}} FindOptions
 * The 'ignore' option can store an array of player indexes whose hands should be ignored during search.
 * 
 * The 'symmetric' and 'infer' options are for card identification (see Card.identity() for more details).
 */

/**
 * Returns an array of cards in everyone's hands that match the given suitIndex and rank.
 * @param {State} state
 * @param {number} inferringPlayerIndex     The inferring player (i.e. can only infer on their own cards).
 * @param {number} suitIndex
 * @param {number} rank
 * @param {FindOptions} options
 */
export function visibleFind(state, inferringPlayerIndex, suitIndex, rank, options = {}) {
	/** @type {Card[]} */
	let found = [];

	for (let i = 0; i < state.numPlayers; i++) {
		if (options.ignore?.includes(i)) {
			continue;
		}

		const hand = state.hands[i];
		const find_options = {
			infer: (options.infer ?? [inferringPlayerIndex, state.ourPlayerIndex]).includes(i),
			symmetric: (options.symmetric ?? [inferringPlayerIndex]).includes(i)
		};
		found = found.concat(hand.findCards(suitIndex, rank, find_options));
	}
	return found;
}

/**
 * Returns the number of cards matching an identity on either the play stacks or the discard stacks.
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 */
export function baseCount(state, suitIndex, rank) {
    return (state.play_stacks[suitIndex] >= rank ? 1 : 0) + state.discard_stacks[suitIndex][rank - 1];
}

/**
 * Returns the number of cards still unknown that could be this identity according to a player.
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 */
export function unknownIdentities(state, playerIndex, suitIndex, rank) {
    const visibleCount = visibleFind(state, playerIndex, suitIndex, rank, { ignore: [playerIndex] }).length;
    return cardCount(state.suits[suitIndex], rank) - baseCount(state, suitIndex, rank) - visibleCount;
}

/**
 * Returns whether the given suitIndex and rank is currently critical.
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 */
export function isCritical(state, suitIndex, rank) {
	return state.discard_stacks[suitIndex][rank - 1] === (cardCount(state.suits[suitIndex], rank) - 1);
}

/**
 * Returns whether the given suitIndex and rank is basic trash (has been played already or can never be played).
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 */
export function isBasicTrash(state, suitIndex, rank) {
	return rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex];
}

/**
 * Returns whether the given suitIndex and rank has already been 'saved' in someone's hand (i.e. won't discard).
 * @param {State} state
 * @param {number} inferringPlayerIndex     The inferring player (i.e. can only infer on their own cards).
 * @param {number} suitIndex
 * @param {number} rank
 * @param {FindOptions & {ignoreCM?: boolean}} [options]
 */
export function isSaved(state, inferringPlayerIndex, suitIndex, rank, order = -1, options = {}) {
	return visibleFind(state, inferringPlayerIndex, suitIndex, rank, options).some(c => {
		return c.order !== order &&
			(c.finessed || c.clued || (options.ignoreCM ? false : c.chop_moved)) &&
			(c.identity() === undefined || c.matches(suitIndex, rank));         // If we know the card's identity, it must match
	});
}

/**
 * Returns whether the given suitIndex and rank is trash (either basic trash or already saved),
 * according to the inferring player.
 * @param {State} state
 * @param {number} inferringPlayerIndex
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number} [order]                The order of the card to ignore (usually itself)
 * @param {FindOptions} [options]
 */
export function isTrash(state, inferringPlayerIndex, suitIndex, rank, order, options) {
	return isBasicTrash(state, suitIndex, rank) || isSaved(state, inferringPlayerIndex, suitIndex, rank, order, options);
}

/**
 * Returns how far the given suitIndex and rank are from playable. 0 means it is currently playable.
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 */
export function playableAway(state, suitIndex, rank) {
	return rank - (state.play_stacks[suitIndex] + 1);
}

/**
 * Returns the current pace (current score + cards left + # of players - max score).
 * @param {State} state
 */
export function getPace(state) {
	const currScore = state.play_stacks.reduce((acc, curr) => acc + curr);
	const maxScore = state.max_ranks.reduce((acc, curr) => acc + curr);
	return currScore + state.cardsLeft + state.numPlayers - maxScore;
}

/**
 * @param {State} state
 * @param {Card} card
 */
export function inStartingHand(state, card) {
	return card.order < state.numPlayers * HAND_SIZE[state.numPlayers];
}

/**
 * Returns whether a card is a unique 2 on the board, according to us.
 * @param  {State} state
 * @param  {BasicCard} card
 */
export function unique2(state, card) {
    const { suitIndex, rank } = card;

    return rank === 2 &&
        state.play_stacks[suitIndex] === 0 &&                                                       // play stack at 0
        visibleFind(state, state.ourPlayerIndex, suitIndex, 2).length === 1 &&                      // other copy isn't visible
        !state.hands[state.ourPlayerIndex].some(c => c.matches(suitIndex, rank, { infer: true }));  // not in our hand
}

/**
 * Returns the relative "value" of a card. 0 is worthless, 5 is critical.
 * TODO: Improve general algorithm. (e.g. having clued cards of a suit makes it better, a dead suit is worse)
 * @param  {State} state
 * @param  {BasicCard} card
 * @returns {number}
 */
export function cardValue(state, card) {
    const { suitIndex, rank } = card;

    // Unknown card in our hand, return average of possibilities
    if (suitIndex === -1 && card instanceof Card) {
        return card.possible.reduce((sum, curr) => sum += cardValue(state, curr), 0) / card.possible.length;
    }

    // Basic trash, saved already, duplicate visible
    if (isTrash(state, state.ourPlayerIndex, suitIndex, rank) || visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length > 1) {
        return 0;
    }

    if (isCritical(state, suitIndex, rank)) {
        return 5;
    }

    if (unique2(state, card)) {
        return 4;
    }

    // Next playable rank is value 4, rank 4 with nothing on the stack is value 1
    return 5 - (rank - state.hypo_stacks[state.ourPlayerIndex][suitIndex]);
}
