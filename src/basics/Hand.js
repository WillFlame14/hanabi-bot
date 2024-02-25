import logger from '../tools/logger.js';
import { cardTouched } from '../variants.js';

/**
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('./Card.js').ActualCard} ActualCard
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../variants.js').Variant} Variant
 */

/**
 * An array of Cards, with some helper functions attached.
 * @extends Array<ActualCard>
 */
export class Hand extends Array {
	/**
	 * @param {ActualCard[]} args
	 */
	constructor( ...args) {
		super(...args);
	}

	clone() {
		const newHand = new Hand();
		for (const card of this)
			newHand.push(card.clone());

		return newHand;
	}

	/**
	 * Removes the card with the given order from the hand.
	 * @param {number} order
	 */
	removeOrder(order) {
		const card_index = this.findIndex(c => c.order === order);

		if (card_index === -1) {
			logger.error('could not find such card index!');
			return;
		}

		// Remove the card from their hand
		this.splice(card_index, 1);
	}

	/**
	 * Returns the card with the given order.
	 * @param {number} order
	 * @returns The card if it exists, or undefined otherwise.
	 */
	findOrder(order) {
		return this.find(c => c.order === order);
	}

	/**
	 * Returns an array of cards matching the provided identity.
	 * @param {Identity} identity
	 */
	findCards(identity) {
		return Array.from(this.filter(c => c.matches(identity)));
	}

	/**
	 * Returns an array of cards touched by the clue.
	 * @param {BaseClue} clue
	 * @param {Variant} variant
	 */
	clueTouched(clue, variant) {
		return Array.from(this.filter(card => cardTouched(card, variant, clue)));
	}
}
