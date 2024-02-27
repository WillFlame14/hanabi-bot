import { isBasicTrash, isCritical, playableAway, unknownIdentities } from './hanabi-util.js';
import * as Utils from '../tools/util.js';
import * as Elim from './player-elim.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Hand.js').Hand} Hand
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').BasicCard} BasicCard
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').Link} Link
 * @typedef {import('../types.js').WaitingConnection} WaitingConnection
 */

export class Player {
	card_elim = Elim.card_elim;
	refresh_links = Elim.refresh_links;
	find_links = Elim.find_links;
	good_touch_elim = Elim.good_touch_elim;
	reset_card = Elim.reset_card;
	restore_elim = Elim.restore_elim;

	/**
	 * @param {number} playerIndex
	 * @param {BasicCard[]} all_possible
	 * @param {BasicCard[]} all_inferred
	 * @param {number[]} hypo_stacks
	 * @param {Card[]} [thoughts]
	 * @param {Link[]} [links]
	 * @param {Set<number>} unknown_plays
	 * @param {WaitingConnection[]} waiting_connections
	 * @param {Record<string, number[]>} elims
	 */
	constructor(playerIndex, all_possible, all_inferred, hypo_stacks, thoughts = [], links = [], unknown_plays = new Set(), waiting_connections = [], elims = {}) {
		this.playerIndex = playerIndex;

		this.thoughts = thoughts;
		this.links = links;

		this.hypo_stacks = hypo_stacks;
		this.all_possible = all_possible;
		this.all_inferred = all_inferred;

		/**
		 * The orders of playable cards whose identities are not known, according to each player. Used for identifying TCCMs.
		 */
		this.unknown_plays = unknown_plays;

		this.waiting_connections = waiting_connections;
		this.elims = elims;
	}

	clone() {
		return new Player(this.playerIndex,
			this.all_possible.slice(),
			this.all_inferred.slice(),
			this.hypo_stacks.slice(),
			this.thoughts.map(infs => infs.clone()),
			this.links.map(link => Utils.objClone(link)),
			this.unknown_plays,
			Utils.objClone(this.waiting_connections),
			Utils.objClone(this.elims));
	}

	get hypo_score() {
		return this.hypo_stacks.reduce((sum, stack) => sum + stack) + this.unknown_plays.size;
	}

	/**
	 * Returns whether they think the given player is locked (i.e. every card is clued, chop moved, or finessed AND not loaded).
	 * @param {State} state
	 * @param {number} playerIndex
	 */
	thinksLocked(state, playerIndex) {
		return state.hands[playerIndex].every(c => this.thoughts[c.order].saved) && !this.thinksLoaded(state, playerIndex);
	}

	/**
	 * Returns whether they they think the given player is loaded (i.e. has a known playable or trash).
	 * @param {State} state
	 * @param {number} playerIndex
	 */
	thinksLoaded(state, playerIndex) {
		return this.thinksPlayables(state, playerIndex).length > 0 || this.thinksTrash(state, playerIndex).length > 0;
	}

	/**
	 * Returns playables in the given player's hand, according to this player.
	 * @param {State} state
	 * @param {number} playerIndex
	 */
	thinksPlayables(state, playerIndex) {
		const linked_orders = this.linkedOrders(state);

		// TODO: Revisit if the card identity being known is relevant?
		// (e.g. if I later discover that I did not have a playable when I thought I did)
		return Array.from(state.hands[playerIndex].filter(c => {
			const card = this.thoughts[c.order];
			return !linked_orders.has(c.order) &&
				card.possibilities.every(p => playableAway(state, p) === 0) &&
				card.matches_inferences();
		}));
	}

	/**
	 * Finds trash in the given hand, according to this player.
	 * @param {State} state
	 * @param {number} playerIndex
	 */
	thinksTrash(state, playerIndex) {
		/** @type {(identity: Identity, order: number) => boolean} */
		const visible_elsewhere = (identity, order) =>
			state.hands.flat().some(c => {
				const card = this.thoughts[c.order];

				return card.matches(identity, { infer: true }) &&
					(c.clued || card.finessed) &&
					c.order !== order &&
					!this.links.some(link => link.cards.some(lc => lc.order === order));
			});

		return Array.from(state.hands[playerIndex].filter(c => {
			const poss = this.thoughts[c.order].possibilities;

			// Every possibility is trash or duplicated somewhere
			const trash = poss.every(p => isBasicTrash(state, p) || visible_elsewhere(p, c.order));

			if (trash)
				logger.debug(`order ${c.order} is trash, poss ${poss.map(logCard).join()}, ${poss.map(p => isBasicTrash(state, p) + '|' + visible_elsewhere(p, c.order)).join()}`);

			return trash;
		}));
	}

	/**
	 * Finds the best discard in a locked hand.
	 * Breaks ties using the leftmost card.
	 * @param {State} state
	 * @param {Hand} hand
	 */
	lockedDiscard(state, hand) {
		// If any card's crit% is 0
		const crit_percents = Array.from(hand.map(c => {
			const poss = this.thoughts[c.order].possibilities;
			const percent = poss.filter(p => isCritical(state, p)).length / poss.length;

			return { card: c, percent };
		})).sort((a, b) => a.percent - b.percent);

		const least_crits = crit_percents.filter(({ percent }) => percent === crit_percents[0].percent);

		/**
		 * @param {{suitIndex: number, rank: number}} possibility
		 * @param {boolean} all_crit
		 */
		const distance = ({ suitIndex, rank }, all_crit) => {
			const crit_distance = (all_crit ? rank * 5 : 0) + rank - this.hypo_stacks[suitIndex];
			return crit_distance < 0 ? 5 : crit_distance;
		};

		const { card: furthest_card } = Utils.maxOn(least_crits, ({ card }) =>
			this.thoughts[card.order].possibilities.reduce((sum, p) => sum += distance(p, crit_percents[0].percent === 1), 0));

		return furthest_card;
	}

	/**
	 * Returns the orders of cards of which this player is unsure about their identities (i.e. at least one is bad touched).
	 * @param {State} state
	 */
	linkedOrders(state) {
		const unknownLinks = this.links.filter(({ cards, identities }) =>
			cards.length > identities.reduce((sum, identity) => sum += unknownIdentities(state, this, identity), 0));

		return new Set(unknownLinks.flatMap(link => link.cards.map(c => c.order)));
	}
}
