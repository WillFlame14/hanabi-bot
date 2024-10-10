import { Hand } from '../basics/Hand.js';
import { Player } from '../basics/Player.js';
import { cardValue } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';

import * as Utils from '../tools/util.js';
import { cardTouched, colourableSuits, variantRegexes } from '../variants.js';

/**
 * @typedef {import('../basics/Card.js').Card} Card
 * @typedef {import('./h-group.js').default} Game
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../variants.js').Variant} Variant
 */

export class HGroup_Player extends Player {

	clone() {
		return new HGroup_Player(this.playerIndex,
			this.all_possible,
			this.all_inferred,
			this.hypo_stacks.slice(),
			this.thoughts.map(infs => infs.clone()),
			this.links.map(link => Utils.objClone(link)),
			this.play_links.map(link => Utils.objClone(link)),
			this.unknown_plays,
			Utils.objClone(this.waiting_connections));
	}

	shallowCopy() {
		return new HGroup_Player(this.playerIndex,
			this.all_possible,
			this.all_inferred,
			this.hypo_stacks,
			this.thoughts,
			this.links,
			this.play_links,
			this.unknown_plays,
			this.waiting_connections);
	}

	/**
	 * Returns the index (0-indexed) of the chop card, or -1 if the hand doesn't have a chop.
	 * 
	 * The 'afterClue' option can be set to true to find chop after a clue.
	 * Otherwise, the default behaviour finds chop which could be a newly clued card.
	 * @param {Hand} hand
	 * @param {{afterClue?: boolean}} options
	 */
	chopIndex(hand, options = {}) {
		for (let i = hand.length - 1; i >= 0; i--) {
			const { clued, newly_clued, chop_moved, finessed } = this.thoughts[hand[i].order];

			if (chop_moved || (clued && (options.afterClue ? true : !newly_clued)) || finessed)
				continue;

			return i;
		}
		return -1;
	}

	/**
	 * Returns the chop card, or undefined if the hand doesn't have a chop.
	 * @param {Hand} hand
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

		return chop ? cardValue(state, this, chop, chop.order) : (this.thinksLoaded(state, playerIndex) ? 0 : 4);
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {Hand} hand
	 * @param {Identity} identity
	 * @param {Variant} variant 		The current variant of the game
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_prompt(hand, identity, variant, connected = [], ignoreOrders = []) {
		const card = hand.find(card => {
			const { clued, newly_clued, order, clues } = card;
			const { inferred, possible } = this.thoughts[card.order];

			return !connected.includes(order) &&			// not already connected
				clued && !newly_clued && 					// previously clued
				possible.has(identity) &&					// must be a possibility
				(inferred.length !== 1 || inferred.array[0]?.matches(identity)) && 		// must not be information-locked on a different identity
				clues.some(clue => cardTouched(identity, variant, clue)) &&				// at least one clue matches
				(!variant.suits[identity.suitIndex].match(variantRegexes.pinkish) ||	// pink rank match
					clues.some(clue => clue.type === CLUE.RANK && clue.value === identity.rank) ||
					clues.some(clue => clue.type === CLUE.COLOUR && colourableSuits(variant)[clue.value]?.match(variantRegexes.pinkish)));
		});

		return (card && !ignoreOrders.includes(card.order)) ? card : undefined;
	}

	/**
	 * Finds a finesse for the given suitIndex and rank, or undefined if there is none.
	 * @param {Hand} hand
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_finesse(hand, connected = [], ignoreOrders = []) {
		const card = hand.find(card => !card.clued && !this.thoughts[card.order].finessed && !connected.includes(card.order));

		return (card && !ignoreOrders.includes(card.order)) ? card : undefined;
	}

	/**
	 * Finds all possible finesses, or an empty array if there are none.
	 * @param {Hand} hand
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_ambiguous_finesses(hand, connected = [], ignoreOrders = []) {
		let finessable = hand.filter(card => !card.clued && (!this.thoughts[card.order].finessed || this.thoughts[card.order].uncertain) && !connected.includes(card.order));

		const certain = finessable.findIndex(card => !this.thoughts[card.order].uncertain);
		if (certain != -1)
			finessable = finessable.slice(0, certain + 1).reverse();

		return finessable.filter(card => !ignoreOrders.includes(card.order));
	}
}
