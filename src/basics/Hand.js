import { cardTouched } from '../variants.js';
import { isBasicTrash, unknownIdentities, visibleFind } from './hanabi-util.js';
import * as Basics from '../basics.js';

import { logCard } from '../tools/log.js';
import logger from '../tools/logger.js';

/**
 * @typedef {import("./State.js").State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Link} Link
 */

/**
 * An array of Cards, with some helper functions attached.
 * @extends Array<Card>
 */
export class Hand extends Array {
	playerIndex = -1;

	/** @type {Link[]} */
	links = [];

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

		const linked_orders = new Set();

		for (const { cards, identities } of this.links) {
			// We aren't sure about the identities of these cards - at least one is bad touched
			if (cards.length > identities.reduce((sum, { suitIndex, rank }) => sum += unknownIdentities(this.state, this.playerIndex, suitIndex, rank), 0)) {
				cards.forEach(c => linked_orders.add(c.order));
			}
		}

		for (const card of this) {
			if (linked_orders.has(card.order)) {
				continue;
			}

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

	/**
	 * Finds good touch (non-promised) links in the hand.
	 */
	find_links() {
		for (const card of this) {
			// Already in a link, ignore
			if (this.links.some(({cards}) => cards.some(c => c.order === card.order))) {
				continue;
			}

			// We know what this card is
			if (card.identity() !== undefined) {
				continue;
			}

			// Card has no inferences
			if (card.inferred.length === 0) {
				continue;
			}

			// Find all unknown cards with the same inferences
			const linked_cards = Array.from(this.filter(c =>
				card.identity() === undefined &&
				card.inferred.length === c.inferred.length &&
				c.inferred.every(({suitIndex, rank}) => card.inferred.some(inf2 => inf2.matches(suitIndex, rank)))
			));

			// We have enough inferred cards to eliminate elsewhere
			// TODO: Sudoku elim from this
			if (linked_cards.length > card.inferred.reduce((sum, { suitIndex, rank }) => sum += unknownIdentities(this.state, this.playerIndex, suitIndex, rank), 0)) {
				logger.info('adding link', linked_cards.map(c => c.order), 'inferences', card.inferred.map(inf => logCard(inf)));

				this.links.push({ cards: linked_cards, identities: card.inferred.map(c => c.raw()), promised: false });
			}
		}
	}

	/**
	 * Refreshes the array of links based on new information (if any).
	 */
	refresh_links() {
		// Get the link indices that we need to redo (after learning new things about them)
		const redo_elim_indices = this.links.map(({cards, identities}, index) =>
			// The card is globally known or an identity is no longer possible
			cards.some(c => c.identity({ symmetric: true }) || identities.some(id => !c.possible.some(p => p.matches(id.suitIndex, id.rank)))) ? index : -1
		).filter(index => index !== -1);

		// Try eliminating all the identities again
		const redo_elim_ids = redo_elim_indices.map(index => this.links[index].identities).flat();

		// Clear links that we're redoing
		this.links = this.links.filter((_, index) => !redo_elim_indices.includes(index));

		for (const id of redo_elim_ids) {
			Basics.card_elim(this.state, this.playerIndex, id.suitIndex, id.rank);
		}

		this.find_links();
	}
}
