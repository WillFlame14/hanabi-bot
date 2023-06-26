import { cardTouched } from '../variants.js';
import { isBasicTrash, visibleFind } from './hanabi-util.js';
import { logCard } from '../tools/log.js';
import logger from '../tools/logger.js';

/**
 * @typedef {import("./State.js").State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BaseClue} BaseClue
 */

/**
 * An array of Cards, with some helper functions attached.
 * @extends Array<Card>
 */
export class Hand extends Array {
	playerIndex = -1;

	/**
	 * @param {State} state
     * @param {number} playerIndex
     * @param {Card[]} args
     */
	constructor(state, playerIndex, ...args) {
		super(...args);

		this.state = state;
		this.playerIndex = playerIndex;
	}

	clone() {
		const newHand = new Hand(this.state, this.playerIndex);
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
     * Returns whether the hand is locked (i.e. every card is clued, chop moved, or an unplayable finesse AND not loaded).
     */
	isLocked() {
		return this.every(c => c.clued || c.chop_moved || (c.finessed && this.state.play_stacks[c.suitIndex] < c.rank)) && !this.isLoaded();
	}

	/**
	 * Returns whether the hand is loaded (i.e. has a known playable or trash).
	 */
	isLoaded() {
		return this.find_playables().length > 0 || this.find_known_trash().length > 0;
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
     * @param {BaseClue} clue
     */
	clueTouched(clue) {
		return this.filter(card => cardTouched(card, this.state.suits, clue));
	}

	/**
	 * Finds known playables in the hand.
	 */
	find_playables() {
		const playables = [];
		const { play_stacks: stacks } = this.state;

		for (const card of this) {
			let playable = true;

			// Card is probably trash
			if (card.inferred.length === 0) {
				// Still, double check if all possibilities are playable
				for (const possible of card.possible) {
					if (stacks[possible.suitIndex] + 1 !== possible.rank) {
						playable = false;
						break;
					}
				}
			}
			else {
				for (const inferred of card.inferred) {
					// Note: Do NOT use hypo stacks
					if (stacks[inferred.suitIndex] + 1 !== inferred.rank) {
						playable = false;
						break;
					}
				}
			}

			if (playable) {
				playables.push(card);
			}
		}
		return playables;
	}

	/**
	 * Finds known trash in the hand.
	 */
	find_known_trash() {
		const trash = [];

		/** @type {(suitIndex: number, rank: number, order: number) => boolean} */
		const visible_elsewhere = (suitIndex, rank, order) => {
			// Visible in someone else's hand or visible in the same hand (but only one is trash)
			return visibleFind(this.state, this.playerIndex, suitIndex, rank, { ignore: [this.playerIndex] }).some(c => (c.clued || c.finessed) && c.order !== order) ||
				this.findCards(suitIndex, rank).some(c => c.clued && c.order !== order && c.focused);
		};

		for (const card of this) {
			const possibilities = (card.inferred.length === 0 || this.playerIndex !== this.state.ourPlayerIndex) ? card.possible : card.inferred;

			// Every possibility is trash or known duplicated somewhere
			if (possibilities.every(c => isBasicTrash(this.state, c.suitIndex, c.rank) || visible_elsewhere(c.suitIndex, c.rank, card.order))) {
				logger.debug(`order ${card.order} is trash, possibilities ${possibilities.map(c => logCard(c)).join()}, results ${possibilities.map(c => isBasicTrash(this.state, c.suitIndex, c.rank) + '|' + visible_elsewhere(c.suitIndex, c.rank, card.order)).join()}`);
				trash.push(card);
			}
		}
		return trash;
	}
}
