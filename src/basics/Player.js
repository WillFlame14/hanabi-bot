import { isBasicTrash, isCritical, playableAway, unknownIdentities } from './hanabi-util.js';
import * as Utils from '../tools/util.js';
import * as Elim from './player-elim.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Link} Link
 */

export class Player {
	card_elim = Elim.card_elim;
	infer_elim = Elim.infer_elim;
	refresh_links = Elim.refresh_links;
	find_links = Elim.find_links;
	good_touch_elim = Elim.good_touch_elim;

	/**
	 * @param {number} playerIndex
	 * @param {Card[]} thoughts
	 * @param {Link[]} [links]
	 * @param {number[]} [hypo_stacks]
	 * @param {Card[]} all_possible
	 * @param {Card[]} all_inferred
	 */
	constructor(playerIndex, thoughts, links = [], hypo_stacks = [], all_possible = [], all_inferred = []) {
		this.playerIndex = playerIndex;

		this.thoughts = thoughts;
		this.links = links;

		this.hypo_stacks = hypo_stacks;
		this.all_possible = all_possible;
		this.all_inferred = all_inferred;
	}

	clone() {
		return new Player(this.playerIndex,
			this.thoughts.map(infs => infs.clone()),
			this.links.slice(),
			this.hypo_stacks.slice(),
			this.all_possible.slice(),
			this.all_inferred.slice());
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
		const linked_orders = new Set();

		for (const { cards, identities } of state.links[playerIndex]) {
			// We aren't sure about the identities of these cards - at least one is bad touched
			if (cards.length > identities.reduce((sum, identity) => sum += unknownIdentities(state, this, identity), 0)) {
				cards.forEach(c => linked_orders.add(c.order));
			}
		}

		// TODO: Revisit if the card identity being known is relevant?
		// (e.g. if I later discover that I did not have a playable when I thought I did)
		return Array.from(state.hands[playerIndex].filter(c => {
			const card = this.thoughts[c.order];

			return !linked_orders.has(card.order) &&
				this.thoughts[card.order].possibilities.every(p => playableAway(state, p) === 0) &&
				card.matches_inferences();
		}));
	}

	/**
	 * Finds trash in the given player's hand, according to this player.
	 * @param {State} state
	 * @param {number} playerIndex
	 */
	thinksTrash(state, playerIndex) {
		/** @type {(identity: BasicCard, order: number) => boolean} */
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

			if (trash) {
				logger.debug(`order ${c.order} is trash, poss ${poss.map(c => logCard(c)).join()}, ${poss.map(p => isBasicTrash(state, p) + '|' + visible_elsewhere(p, c.order)).join()}`);
			}

			return trash;
		}));
	}

	/**
	 * Finds the best discard in a locked hand.
	 * Breaks ties using the leftmost card.
	 * @param {State} state
	 */
	lockedDiscard(state) {
		// If any card's crit% is 0
		const crit_percents = Array.from(state.hands[this.playerIndex].map(c => {
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
			const crit_distance = (all_crit ? rank * 5 : 0) + rank - state.hypo_stacks[this.playerIndex][suitIndex];
			return crit_distance < 0 ? 5 : crit_distance;
		};

		const { card: furthest_card } = Utils.maxOn(least_crits, ({ card }) =>
			this.thoughts[card.order].possibilities.reduce((sum, p) => sum += distance(p, crit_percents[0].percent === 1), 0));

		return furthest_card;
	}
}
