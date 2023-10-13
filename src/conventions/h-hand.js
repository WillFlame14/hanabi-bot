import { Hand } from '../basics/Hand.js';
import { cardValue } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';

/**
 * @typedef {import('../basics/Card.js').Card} Card
 * @typedef {import('./h-group.js').default} State
 * @typedef {import('../types.js').BasicCard} BasicCard
 */

export class HGroup_Hand extends Hand {
	clone() {
		const newHand = new HGroup_Hand();
		for (const card of this) {
			newHand.push(card.clone());
		}
		return newHand;
	}

	/**
	 * Returns the index (0-indexed) of the chop card, or -1 if the hand doesn't have a chop.
	 * 
	 * The 'afterClue' option can be set to true to find chop after a clue.
	 * Otherwise, the default behaviour finds chop which could be a newly clued card.
	 * @param {{afterClue?: boolean}} options
	 */
	chopIndex(options = {}) {
		for (let i = this.length - 1; i >= 0; i--) {
			const { clued, newly_clued, chop_moved } = this[i];
			if (chop_moved || (clued && (options.afterClue ? true : !newly_clued))) {
				continue;
			}
			return i;
		}
		return -1;
	}

	/**
	 * Returns the chop card, or undefined if the hand doesn't have a chop.
	 * @param {{afterClue?: boolean}} options
	 */
	chop(options = {}) {
		return this[this.chopIndex(options)];
	}

	/**
	 * Returns the value of the chop card, 4 if the hand is locked, and 0 if no chop but loaded.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {{afterClue?: boolean}} options
	 */
	static chopValue(state, playerIndex, options = {}) {
		const index = state.hands[playerIndex].chopIndex(options);
		return index !== -1 ? cardValue(state, state.hands[playerIndex][index]) :
				Hand.isLoaded(state, playerIndex) ? 0 : 4;
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {BasicCard} identity
	 * @param {string[]} suits 			All suits in the current game.
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_prompt(identity, suits, ignoreOrders = []) {
		const { suitIndex, rank } = identity;

		return this.find(card => {
			const { clued, newly_clued, order, inferred, possible, clues } = card;
			// Ignore unclued, newly clued, and known cards (also intentionally ignored cards)
			if (!clued || newly_clued || possible.length === 1 || ignoreOrders.includes(order)) {
				return false;
			}

			// Ignore cards that don't match the inference
			if (!possible.some(p => p.matches(identity))) {
				return false;
			}

			// Ignore cards that don't match and have information lock
			if (inferred.length === 1 && !(inferred[0].matches(identity))) {
				return false;
			}

			// A clue must match the card (or rainbow/omni connect)
			if (clues.some(clue =>
				(clue.type === CLUE.COLOUR && (clue.value === suitIndex || ['Rainbow', 'Omni'].includes(suits[suitIndex]))) ||
				(clue.type === CLUE.RANK && clue.value === rank))
			) {
				return true;
			}
			return false;
		});
	}

	/**
	 * Finds a finesse for the given suitIndex and rank, or undefined if there is none.
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_finesse(ignoreOrders = []) {
		return this.find(card => !card.clued && !card.finessed && !ignoreOrders.includes(card.order));
	}
}
