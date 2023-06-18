import { cardCount } from '../variants.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Card.js').Card} Card
 * 
 * @typedef {import('./Card.js').MatchOptions & {ignore?: number[]}} FindOptions
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
			infer: options.infer ?? (i === inferringPlayerIndex || i === state.ourPlayerIndex),
			symmetric: i === inferringPlayerIndex
		};
		found = found.concat(hand.findCards(suitIndex, rank, find_options));
	}
	return found;
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
 * @param {import("./State.js").State} state
 * @param {import("./Card.js").Card} card
 */
export function inStartingHand(state, card) {
	return card.order < state.numPlayers * state.hands[0].length;
}
