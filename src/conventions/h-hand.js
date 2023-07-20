import { Hand } from '../basics/Hand.js';
import { cardValue, isCritical } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';

/**
 * @typedef {import('../basics/Card.js').Card} Card
 */

export class HGroup_Hand extends Hand {
	clone() {
		const newHand = new HGroup_Hand(this.state, this.playerIndex);
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
	 * Returns the value of the chop card, or 4 if the hand is locked.
	 * @param {{afterClue?: boolean}} options
	 */
	chopValue(options = {}) {
		const index = this.chopIndex(options);
		return index === -1 ? 4 : cardValue(this.state, this[index]);
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {number} suitIndex
	 * @param {number} rank
	 * @param {string[]} suits 			All suits in the current game.
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_prompt(suitIndex, rank, suits, ignoreOrders = []) {
		return this.find(card => {
			const { clued, newly_clued, order, inferred, possible, clues } = card;
			// Ignore unclued, newly clued, and known cards (also intentionally ignored cards)
			if (!clued || newly_clued || possible.length === 1 || ignoreOrders.includes(order)) {
				return false;
			}

			// Ignore cards that don't match the inference
			if (!possible.some(p => p.matches(suitIndex, rank))) {
				return false;
			}

			// Ignore cards that don't match and have information lock
			if (inferred.length === 1 && !(inferred[0].suitIndex === suitIndex && inferred[0].rank === rank)) {
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

	/**
	 * Finds the best discard in a locked hand.
	 */
	locked_discard() {
		// If any card's crit% is 0
		const crit_percents = Array.from(this.map(card => {
			const possibilities = card.inferred.length === 0 ? card.possible : card.inferred;
			const percent = possibilities.filter(p => isCritical(this.state, p.suitIndex, p.rank)).length / possibilities.length;

			return { card, percent };
		})).sort((a, b) => a.percent - b.percent);

		const least_crits = crit_percents.filter(({ percent }) => percent === crit_percents[0].percent);

		/**
		 * @param {{suitIndex: number, rank: number}} possibility
		 * @param {boolean} all_crit
		 */
		const distance = ({ suitIndex, rank }, all_crit) => {
			return (all_crit ? rank * 5 : 0) + rank - this.state.hypo_stacks[this.playerIndex][suitIndex];
		};

		let max_dist = 0;

		/** @type Card */
		let furthest_card;

		for (const { card } of least_crits) {
			const possibilities = card.inferred.length === 0 ? card.possible : card.inferred;
			const curr_distance = possibilities.reduce((sum, p) => sum += distance(p, crit_percents[0].percent === 1), 0);

			if (curr_distance > max_dist) {
				max_dist = curr_distance;
				furthest_card = card;
			}
		}
		return furthest_card;
	}
}
