import { Hand } from '../basics/Hand.js';
import { Player } from '../basics/Player.js';
import { cardValue } from '../basics/hanabi-util.js';
import { CLUE } from '../constants.js';

/**
 * @typedef {import('../basics/Card.js').Card} Card
 * @typedef {import('./h-group.js').default} State
 * @typedef {import('../types.js').Identity} Identity
 */

export class HGroup_Player extends Player {
	clone() {
		return new HGroup_Player(this.playerIndex, this.thoughts, this.links, this.hypo_stacks, this.all_possible, this.all_inferred, this.unknown_plays);
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
			const { clued, newly_clued } = hand[i];
			console.log('trying to get thoughts on order', hand[i].order, 'playerIndex', this.playerIndex);
			if (this.thoughts[hand[i].order] === undefined) {
				console.log(this.thoughts);
			}
			const { chop_moved, finessed } = this.thoughts[hand[i].order];

			if (chop_moved || (clued && (options.afterClue ? true : !newly_clued)) || finessed) {
				continue;
			}
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

		return chop ? cardValue(state, this, chop) : (this.thinksLoaded(state, playerIndex) ? 0 : 4);
	}

	/**
	 * Finds a prompt in the hand for the given suitIndex and rank, or undefined if no card is a valid prompt.
	 * @param {Hand} hand
	 * @param {Identity} identity
	 * @param {string[]} suits 			All suits in the current game.
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_prompt(hand, identity, suits, ignoreOrders = []) {
		const { suitIndex, rank } = identity;

		return hand.find(card => {
			const { clued, newly_clued, order, clues } = card;
			const { inferred, possible } = this.thoughts[card.order];

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
	 * @param {Hand} hand
	 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
	 */
	find_finesse(hand, ignoreOrders = []) {
		return hand.find(card => !card.clued && !this.thoughts[card.order].finessed && !ignoreOrders.includes(card.order));
	}
}
