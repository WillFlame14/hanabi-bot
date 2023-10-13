import logger from '../tools/logger.js';
import { cardTouched } from '../variants.js';
import * as HandUtils from './hand-utils.js';

/**
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 */

/**
 * An array of Cards, with some helper functions attached.
 * @extends Array<Card>
 */
export class Hand extends Array {
	static isLocked = HandUtils.isLocked;
	static isLoaded = HandUtils.isLoaded;
	static find_playables = HandUtils.find_playables;
	static find_known_trash = HandUtils.find_known_trash;
	static locked_discard = HandUtils.locked_discard;

	/**
	 * @param {Card[]} args
	 */
	constructor( ...args) {
		super(...args);
	}

	clone() {
		const newHand = new Hand();
		for (const card of this) {
			newHand.push(card.clone());
		}
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
	 * @param {BasicCard} identity
	 * @param {MatchOptions} options
	 */
	findCards(identity, options = {}) {
		return Array.from(this.filter(c => c.matches(identity, options)));
	}

	/**
	 * Returns an array of cards touched by the clue.
	 * @param {BaseClue} clue
	 * @param {string[]} suits
	 */
	clueTouched(clue, suits) {
		return Array.from(this.filter(card => cardTouched(card, suits, clue)));
	}
}
