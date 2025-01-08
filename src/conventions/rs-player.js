import { Card } from '../basics/Card.js';
import { IdentitySet } from '../basics/IdentitySet.js';
import { Player } from '../basics/Player.js';
import { CLUE } from '../constants.js';
import { cardTouched, colourableSuits, variantRegexes } from '../variants.js';

import * as Utils from '../tools/util.js';

/**
 * @typedef {import('./ref-sieve.js').default} Game
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../variants.js').Variant} Variant
 */

export class RS_Player extends Player {
	/** @param {RS_Player} json */
	static fromJSON(json) {
		return new RS_Player(json.playerIndex,
			IdentitySet.fromJSON(json.all_possible),
			IdentitySet.fromJSON(json.all_inferred),
			json.hypo_stacks.slice(),
			new Set(json.hypo_plays),
			json.thoughts.map(Card.fromJSON),
			json.links.map(Utils.objClone),
			json.play_links.map(Utils.objClone),
			new Set(json.unknown_plays),
			Utils.objClone(json.waiting_connections),
			Utils.objClone(json.elims));
	}

	/**
	 * Returns playables in the given player's hand, according to this player.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {{assume?: boolean, symmetric?: boolean}} options
	 */
	thinksPlayables(state, playerIndex, options = {}) {
		const linked_orders = this.linkedOrders(state);

		return super.thinksPlayables(state, playerIndex, options).filter(o => !linked_orders.has(o));
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
		const order = state.hands[playerIndex].findLast(o => {
			const { clued, newly_clued, order, clues } = state.deck[o];
			const { inferred, possible, info_lock } = this.thoughts[o];

			return !connected.includes(order) &&			// not already connected
				clued && !newly_clued && 					// previously clued
				possible.has(identity) &&					// must be a possibility
				(info_lock === undefined || info_lock.has(identity)) &&
				(inferred.length !== 1 || inferred.array[0]?.matches(identity)) && 		// must not be information-locked on a different identity
				clues.some(clue => cardTouched(identity, state.variant, clue)) &&				// at least one clue matches
				(!variantRegexes.pinkish.test(state.variant.suits[identity.suitIndex]) || forcePink ||	// pink rank match
					!(clues.every(c1 => clues.every(c2 => c1.type === c2.type && c1.value === c2.value)) && clues.length > 0 && clues[0].type === CLUE.RANK && clues[0].value !== identity.rank) ||
					clues.some(clue => clue.type === CLUE.COLOUR && variantRegexes.pinkish.test(colourableSuits(state.variant)[clue.value])));
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
}
