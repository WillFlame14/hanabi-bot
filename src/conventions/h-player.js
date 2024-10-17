import { Player } from '../basics/Player.js';
import { cardValue } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';
import { cardTouched, colourableSuits, variantRegexes } from '../variants.js';

/**
 * @typedef {import('../basics/Card.js').Card} Card
 * @typedef {import('./h-group.js').default} Game
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../variants.js').Variant} Variant
 */

export class HGroup_Player extends Player {
	/**
	 * Returns the index (0-indexed) of the chop card, or -1 if the hand doesn't have a chop.
	 * 
	 * The 'afterClue' option can be set to true to find chop after a clue.
	 * Otherwise, the default behaviour finds chop which could be a newly clued card.
	 * @param {number[]} hand
	 * @param {{afterClue?: boolean}} options
	 */
	chopIndex(hand, options = {}) {
		for (let i = hand.length - 1; i >= 0; i--) {
			const { clued, newly_clued, chop_moved, finessed } = this.thoughts[hand[i]];

			if (chop_moved || (clued && (options.afterClue ? true : !newly_clued)) || finessed)
				continue;

			return i;
		}
		return -1;
	}

	/**
	 * Returns the chop card, or undefined if the hand doesn't have a chop.
	 * @param {number[]} hand
	 * @param {{afterClue?: boolean}} options
	 */
	chop(hand, options = {}) {
		return hand[this.chopIndex(hand, options)];
	}

	/**
	 * Returns the value of the chop card, 4 if the hand is locked, and 0 if no chop but loaded.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {{afterClue?: boolean}} options
	 */
	chopValue(state, playerIndex, options = {}) {
		const hand = state.hands[playerIndex];
		const chop = this.chop(hand, options);

		return chop ? cardValue(state, this, state.deck[chop], chop) : (this.thinksLoaded(state, playerIndex) ? 0 : 4);
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {Identity} identity
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_prompt(state, playerIndex, identity, connected = [], ignoreOrders = []) {
		const order = state.hands[playerIndex].find(o => {
			const { clued, newly_clued, order, clues } = state.deck[o];
			const { inferred, possible } = this.thoughts[o];

			return !connected.includes(order) &&			// not already connected
				clued && !newly_clued && 					// previously clued
				possible.has(identity) &&					// must be a possibility
				(inferred.length !== 1 || inferred.array[0]?.matches(identity)) && 		// must not be information-locked on a different identity
				clues.some(clue => cardTouched(identity, state.variant, clue)) &&				// at least one clue matches
				(!state.variant.suits[identity.suitIndex].match(variantRegexes.pinkish) ||	// pink rank match
					clues.some(clue => clue.type === CLUE.RANK && clue.value === identity.rank) ||
					clues.some(clue => clue.type === CLUE.COLOUR && colourableSuits(state.variant)[clue.value]?.match(variantRegexes.pinkish)));
		});

		return (order !== undefined && !ignoreOrders.includes(order)) ? order : undefined;
	}

	/**
	 * Finds a finesse for the given suitIndex and rank, or undefined if there is none.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_finesse(state, playerIndex, connected = [], ignoreOrders = []) {
		const order = state.hands[playerIndex].find(o => !state.deck[o].clued && !this.thoughts[o].finessed && !connected.includes(o));

		return (order !== undefined && !ignoreOrders.includes(order)) ? order : undefined;
	}
}
