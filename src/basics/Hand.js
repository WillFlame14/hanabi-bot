import { cardTouched } from '../variants.js';
import logger from '../tools/logger.js';

/**
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 */

/**
 * An array of Cards, with some helper functions attached.
 * @extends Array<Card>
 */
export class Hand extends Array {
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
     * Returns whether the hand is locked (i.e. every card is clued, chop moved, or an unplayable finesse).
     * @param {import("./State.js").State} state
     */
	isLocked(state) {
		return this.every(c => c.clued || c.chop_moved || (c.finessed && state.play_stacks[c.suitIndex] < c.rank));
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
     * Returns an array of cards matching the provided suitIndex and rank.
     * @param {number} suitIndex
     * @param {number} rank
     * @param {MatchOptions} options
     */
	findCards(suitIndex, rank, options = {}) {
		return this.filter(c => c.matches(suitIndex, rank, options));
	}

	/**
	 * Returns an array of cards touched by the clue.
     * @param {string[]} suits
     * @param {BaseClue} clue
     */
	clueTouched(suits, clue) {
		return this.filter(card => cardTouched(card, suits, clue));
	}
}
