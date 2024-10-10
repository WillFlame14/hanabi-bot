import { unknownIdentities } from './hanabi-util.js';
import { IdentitySet } from './IdentitySet.js';
import { cardCount } from '../variants.js';
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

	/** @type {number[]} */
	hypo_stacks;

	/** @type {{ orders: number[], prereqs: Identity[], connected: number}[]} */
	play_links;

	/** @type {Set<number>} */
	hypo_plays;

	/**
	 * @param {number} playerIndex
	 * @param {IdentitySet} all_possible
	 * @param {IdentitySet} all_inferred
	 * @param {number[]} hypo_stacks
	 * @param {Card[]} [thoughts]
	 * @param {Link[]} [links]
	 * @param {{ orders: number[], prereqs: Identity[], connected: number}[]} [play_links]
	 * @param {Set<number>} [unknown_plays]
	 * @param {WaitingConnection[]} [waiting_connections]
	 * @param {Record<string, number[]>} [elims]
	 */
	constructor(playerIndex, all_possible, all_inferred, hypo_stacks, thoughts = [], links = [], play_links = [], unknown_plays = new Set(), waiting_connections = [], elims = {}) {
		this.playerIndex = playerIndex;

		this.thoughts = thoughts;
		this.links = links;
		this.play_links = play_links;

		this.hypo_stacks = hypo_stacks;
		this.all_possible = all_possible;
		this.all_inferred = all_inferred;

		/**
		 * The orders of playable cards whose identities are not known, according to each player. Used for identifying TCCMs.
		 */
		this.unknown_plays = unknown_plays;

		this.hypo_plays = new Set();

		this.waiting_connections = waiting_connections;
		this.elims = elims;
	}

	clone() {
		return new Player(this.playerIndex,
			this.all_possible,
			this.all_inferred,
			this.hypo_stacks.slice(),
			this.thoughts.map(infs => infs.clone()),
			this.links.map(link => Utils.objClone(link)),
			this.play_links.map(link => Utils.objClone(link)),
			this.unknown_plays,
			Utils.objClone(this.waiting_connections),
			Utils.objClone(this.elims));
	}

	shallowCopy() {
		return new Player(this.playerIndex,
			this.all_possible,
			this.all_inferred,
			this.hypo_stacks,
			this.thoughts,
			this.links,
			this.play_links,
			this.unknown_plays,
			this.waiting_connections,
			this.elims);
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
	 * @param {{assume?: boolean}} options
	 */
	thinksLoaded(state, playerIndex, options = {}) {
		return this.thinksPlayables(state, playerIndex, options).length > 0 || this.thinksTrash(state, playerIndex).length > 0;
	}

	/**
	 * Returns playables in the given player's hand, according to this player.
	 * @param {State} state
	 * @param {number} playerIndex
	 * @param {{assume?: boolean}} options
	 */
	thinksPlayables(state, playerIndex, options = {}) {
		const linked_orders = this.linkedOrders(state);

		// TODO: Revisit if the card identity being known is relevant?
		// (e.g. if I later discover that I did not have a playable when I thought I did)
		return Array.from(state.hands[playerIndex].filter(c => {
			const card = this.thoughts[c.order];
			const unsafe_linked = linked_orders.has(c.order) &&
				(state.strikes === 2 ||
					card.possible.some(p => state.play_stacks[p.suitIndex] + 1 < p.rank && p.rank <= state.max_ranks[p.suitIndex]) ||
					Array.from(linked_orders).some(o => this.thoughts[o].focused && o !== c.order));
			// We are waiting for a play to prove this connection
			const waiting_proof = this.waiting_connections.some(wc =>
				wc.connections.some((conn, ci) => ci >= wc.conn_index && conn.card.order === c.order &&
					wc.connections.some((conn2, ci2) => ci2 >= wc.conn_index && ci > ci2 && conn2.type == 'waiting'))
			);

			return (!card.trash || card.possible.every(p => !state.isBasicTrash(p))) && !unsafe_linked && !waiting_proof &&
				card.possibilities.every(p => (card.chop_moved ? state.isBasicTrash(p) : false) || state.isPlayable(p)) &&	// cm cards can ignore trash ids
				card.possibilities.some(p => state.isPlayable(p)) &&	// Exclude empty case
				((options?.assume ?? true) || !this.waiting_connections.some((wc, i1) =>
					// Unplayable target of possible waiting connection
					(wc.focused_card.order === c.order && !state.isPlayable(wc.inference) && card.possible.has(wc.inference)) ||
					wc.connections.some((conn, ci) => ci >= wc.conn_index && conn.card.order === c.order && (
						// Unplayable connecting card
						conn.identities.some(i => !state.isPlayable(i) && card.possible.has(i)) ||
						// A different connection on the same focus doesn't use this connecting card
						this.waiting_connections.some((wc2, i2) =>
							i1 !== i2 && wc2.focused_card.order === wc.focused_card.order && wc2.connections.every(conn2 => conn2.card.order !== c.order))))
				)) &&
				state.hasConsistentInferences(card);
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
					(c.clued || (card.finessed && !card.uncertain)) &&
					c.order !== order &&
					!this.links.some(link => link.cards.some(lc => lc.order === order));
			});

		return Array.from(state.hands[playerIndex].filter(c => {
			if (this.thoughts[c.order].trash)
				return true;

			const poss = this.thoughts[c.order].possibilities;

			// Every possibility is trash or duplicated somewhere
			const trash = poss.every(p => state.isBasicTrash(p) || visible_elsewhere(p, c.order));

			if (trash)
				logger.debug(`order ${c.order} is trash, poss ${poss.map(logCard).join()}, ${poss.map(p => state.isBasicTrash(p) + '|' + visible_elsewhere(p, c.order)).join()}`);

			return trash;
		}));
	}

	/**
	 * Finds the best discard in a locked hand. Breaks ties using the leftmost card.
	 * @param {State} state
	 * @param {Hand} hand
	 */
	lockedDiscard(state, hand) {
		// If any card's crit% is 0
		const crit_percents = Array.from(hand.map(c => {
			const poss = this.thoughts[c.order].possibilities;
			const percent = poss.filter(p => state.isCritical(p)).length / poss.length;

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
	 * Finds the best play in a locked hand. Breaks ties using the leftmost card.
	 * @param {State} state
	 * @param {Hand} hand
	 */
	anxietyPlay(state, hand) {
		return Array.from(hand.map((c, i) => {
			const poss = this.thoughts[c.order].possibilities;
			const percent = poss.filter(p => state.isPlayable(p)).length / poss.length;

			return { card: c, percent, index: i };
		})).sort((a, b) => {
			const diff = b.percent - a.percent;
			return diff !== 0 ? diff : a.index - b.index;
		})[0].card;
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

	get hypo_score() {
		return this.hypo_stacks.reduce((sum, stack) => sum + stack) + this.unknown_plays.size;
	}

	/** @param {number} order */
	dependentConnections(order) {
		return this.waiting_connections.filter(wc => wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order));
	}

	/**
	 * @param {State} state
	 * Computes the hypo stacks and unknown plays.
	 */
	update_hypo_stacks(state) {
		// Reset hypo stacks to play stacks
		const hypo_stacks = state.play_stacks.slice();
		const unknown_plays = new Set();
		const already_played = new Set();

		let found_new_playable = true;
		let good_touch_elim = new IdentitySet(state.variant.suits.length, 0);

		const linked_orders = this.linkedOrders(state);

		/**
		 * Checks if all possibilities have been either eliminated by good touch or are playable (but not all eliminated).
		 * @param {BasicCard[]} poss
		 */
		const delayed_playable = (poss) => {
			const remaining_poss = poss.filter(c => !good_touch_elim.has(c));
			return remaining_poss.length > 0 && remaining_poss.every(c => hypo_stacks[c.suitIndex] + 1 === c.rank);
		};

		// Attempt to play all playable cards
		while (found_new_playable) {
			found_new_playable = false;

			for (const { order } of state.hands.flat()) {
				const card = this.thoughts[order];

				if (!card.saved || good_touch_elim.has(card) || linked_orders.has(order) || unknown_plays.has(order) || already_played.has(order))
					continue;

				const fake_wcs = this.waiting_connections.filter(wc =>
					wc.focused_card.order === order && !state.deck[wc.focused_card.order].matches(wc.inference, { assume: true }));

				// Ignore all waiting connections that will be proven wrong
				const diff = card.clone();
				diff.inferred = diff.inferred.subtract(fake_wcs.flatMap(wc => wc.inference));

				const playable = state.hasConsistentInferences(diff) &&
					(delayed_playable(diff.possible.array) ||
						delayed_playable(diff.inferred.array) ||
						(diff.finessed && delayed_playable([card])) ||
						this.play_links.some(pl => pl.connected === order && pl.orders.every(o => unknown_plays.has(o))));

				if (!playable)
					continue;

				const id = card.identity({ infer: true });
				const actual_id = state.deck[order].identity();

				// Do not allow false updating of hypo stacks
				if (this.playerIndex === -1 && (
					(id && state.deck.filter(c => c?.matches(id) && c.order !== order).length === cardCount(state.variant, id)) ||
					(actual_id &&
						(!card.inferred.has(actual_id) ||		// None of the inferences match
						state.hands.flat().some(c => unknown_plays.has(c.order) && c.matches(actual_id))))
				))
					continue;

				if (id === undefined) {
					// Playable, but the player doesn't know what card it is
					unknown_plays.add(order);
					already_played.add(order);
					found_new_playable = true;

					const promised_link = this.links.find(link => link.promised && link.cards.some(c => c.order === order));

					// All cards in a promised link will be played
					if (promised_link?.cards.every(c => unknown_plays.has(c.order))) {
						const id2 = promised_link.identities[0];

						if (id2.rank !== hypo_stacks[id2.suitIndex] + 1) {
							logger.warn(`tried to add ${logCard(id2)} onto hypo stacks, but they were at ${hypo_stacks[id2.suitIndex]}??`);
						}
						else {
							hypo_stacks[id2.suitIndex] = id2.rank;
							good_touch_elim = good_touch_elim.union(id2);
						}
					}
					continue;
				}

				const { suitIndex, rank } = id;

				if (rank !== hypo_stacks[suitIndex] + 1) {
					// e.g. a duplicated 1 before any 1s have played will have all bad possibilities eliminated by good touch
					logger.warn(`tried to add new playable card ${logCard(id)} ${card.order}, hypo stacks at ${hypo_stacks[suitIndex]}`);
					continue;
				}

				hypo_stacks[suitIndex] = rank;
				good_touch_elim = good_touch_elim.union(id);
				found_new_playable = true;
				already_played.add(order);
			}
		}
		this.hypo_stacks = hypo_stacks;
		this.unknown_plays = unknown_plays;
		this.hypo_plays = already_played;
	}
}
