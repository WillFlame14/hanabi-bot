import { Card } from '../basics/Card.js';
import { IdentitySet } from '../basics/IdentitySet.js';
import { Player } from '../basics/Player.js';
import { cardValue } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';
import { cardTouched, colourableSuits, variantRegexes } from '../variants.js';

import * as Utils from '../tools/util.js';

/**
 * @typedef {import('./h-group.js').default} Game
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../variants.js').Variant} Variant
 */

export class HGroup_Player extends Player {
	/** @param {HGroup_Player} json */
	static fromJSON(json) {
		return new HGroup_Player(json.playerIndex,
			IdentitySet.fromJSON(json.all_possible),
			IdentitySet.fromJSON(json.all_inferred),
			json.hypo_stacks.slice(),
			json.thoughts.map(Card.fromJSON),
			json.links.map(Utils.objClone),
			json.play_links.map(Utils.objClone),
			new Set(json.unknown_plays),
			Utils.objClone(json.waiting_connections),
			Utils.objClone(json.elims));
	}
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
			const { clued, newly_clued, chop_moved, finessed, known } = this.thoughts[hand[i]];

			if (chop_moved || (clued && (options.afterClue ? true : !newly_clued)) || finessed || known)
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

		return chop !== undefined ? cardValue(state, this, state.deck[chop], chop) : (this.thinksLoaded(state, playerIndex) ? 0 : 4);
	}

	/**
	 * Returns the distance that a card is left of chop, ignoring previously-clued cards.
	 * @param {number[]} hand
	 * @param {number} order
	 */
	chopDistance(hand, order) {
		const chop = this.chop(hand);

		let dist = 0, counting = false;

		for (const o of hand) {
			const card = this.thoughts[o];

			if (o === order)
				counting = true;

			if (!counting)
				continue;

			if (o === chop)
				return dist;

			// Skip previously clued cards
			if (card.clued && !card.newly_clued)
				continue;

			dist++;
		}

		throw new Error(`distance from ${order} to chop ${chop} in hand ${hand} was negative!`);
	}


	/**
	 * Returns all clued card in the hand for the given suitIndex and rank (used for bluffs through clued cards.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {Identity} identity
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_clued(state, playerIndex, identity, connected = [], ignoreOrders = []) {
		return state.hands[playerIndex].filter(o => {
			const { clued, newly_clued, order, clues } = state.deck[o];
			const { inferred, possible, info_lock } = this.thoughts[o];

			return !connected.includes(order) &&			// not already connected
				clued && !newly_clued && 					// previously clued
				possible.has(identity) &&					// must be a possibility
				(info_lock === undefined || info_lock.has(identity)) &&
				(inferred.length !== 1 || inferred.array[0]?.matches(identity)) && 		// must not be information-locked on a different identity
				clues.some(clue => cardTouched(identity, state.variant, clue)) &&		// at least one clue matches
				!ignoreOrders.includes(o);
		});
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {Identity} identity
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 * @param {boolean} forcePink 		Whether to force a prompt on a possibly-pink card.
	 */
	find_prompt(state, playerIndex, identity, connected = [], ignoreOrders = [], forcePink = false) {
		const order = state.hands[playerIndex].find(o => {
			const { clued, newly_clued, order, clues } = state.deck[o];
			const { inferred, possible, info_lock } = this.thoughts[o];

			return !connected.includes(order) &&			// not already connected
				clued && !newly_clued && 					// previously clued
				possible.has(identity) &&					// must be a possibility
				(info_lock === undefined || info_lock.has(identity)) &&
				(inferred.length !== 1 || inferred.array[0]?.matches(identity)) && 		// must not be information-locked on a different identity
				clues.some(clue => cardTouched(identity, state.variant, clue)) &&				// at least one clue matches
				(!state.variant.suits[identity.suitIndex].match(variantRegexes.pinkish) || forcePink ||	// pink rank match
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
		const order = state.hands[playerIndex].find(o => !this.thoughts[o].touched && !connected.includes(o));

		return (order !== undefined && !ignoreOrders.includes(order)) ? order : undefined;
	}

	/**
	 * Finds all possible finesses, or an empty array if there are none.
	 * @param {number[]} hand
	 * @param {number[]} connected 		Orders of cards that have previously connected
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_ambiguous_finesses(hand, connected = [], ignoreOrders = []) {
		let finessable = hand.filter(order => !this.thoughts[order].clued && (!this.thoughts[order].finessed || this.thoughts[order].uncertain) && !connected.includes(order));

		const certain = finessable.findIndex(order => !this.thoughts[order].uncertain);
		if (certain != -1)
			finessable = finessable.slice(0, certain + 1).reverse();

		return finessable.filter(order => !ignoreOrders.includes(order));
	}
}
