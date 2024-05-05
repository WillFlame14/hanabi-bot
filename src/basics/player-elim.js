import { cardCount } from '../variants.js';
import { unknownIdentities } from './hanabi-util.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./Hand.js').Hand} Hand
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').ActualCard} ActualCard
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').Link} Link
 */

/**
 * Eliminates card identities using only possible information.
 * @this {Player}
 * @param {State} state
 */
export function card_elim(state) {
	const identities = this.all_possible.array.slice();
	const certain_map = /** @type {Map<string, Set<number>>} */ (new Map());

	/** @type {(order: number) => void} */
	const addToMap = (order) => {
		const id = this.thoughts[order].identity();

		if (id === undefined)
			return;

		const id_hash = logCard(id);
		certain_map.set(id_hash, (certain_map.get(id_hash) ?? new Set()).add(order));
	};

	for (const { order } of state.hands.flat())
		addToMap(order);

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const id_hash = logCard(identity);

		if (!this.all_possible.has(identity) ||
			state.baseCount(identity) + (certain_map.get(id_hash)?.size ?? 0) !== cardCount(state.variant, identity)
		)
			continue;

		if (!this.all_inferred.has(identity))
			throw new Error(`failing to eliminate identity ${id_hash} from inferred`);

		// Remove it from the list of future possibilities
		this.all_possible = this.all_possible.subtract(identity);
		this.all_inferred = this.all_inferred.subtract(identity);

		for (const { order } of state.hands.flat()) {
			const card = this.thoughts[order];

			if (card.possible.length <= 1 || certain_map.get(id_hash)?.has(order))
				continue;

			card.possible = card.possible.subtract(identity);
			card.inferred = card.inferred.subtract(identity);

			if (card.inferred.length === 0 && !card.reset)
				this.reset_card(order);

			// Card can be further eliminated
			else if (card.possible.length === 1)
				identities.push(card.identity());

			addToMap(order);
		}
		logger.debug(`removing ${id_hash} from ${state.playerNames[this.playerIndex]} possibilities, now ${this.all_possible.map(logCard)}`);
	}
}

/**
 * Eliminates card identities based on Good Touch Principle.
 * Returns the orders of the cards that lost all inferences (were reset).
 * @this {Player}
 * @param {State} state
 * @param {boolean} only_self 	Whether to only use cards in own hand for elim (e.g. in 2-player games, where GTP is less strong.)
 */
export function good_touch_elim(state, only_self = false) {
	/** @type {Set<number>} Orders of cards that are in unconfirmed connections */
	const unconfirmed = new Set();

	for (const { connections, conn_index } of this.waiting_connections) {
		// If this player is next, assume the connection is true
		if (connections[conn_index].reacting === this.playerIndex)
			continue;

		for (let i = conn_index; i < connections.length; i++)
			unconfirmed.add(connections[i].card.order);
	}

	const match_map = /** @type {Map<string, Set<number>>} */ (new Map());
	const hard_match_map = /** @type {Map<string, Set<number>>} */ (new Map());

	/** @type {(order: number) => void} */
	const addToMaps = (order) => {
		const card = this.thoughts[order];
		const id = card.identity({ infer: true, symmetric: this.playerIndex === -1 });

		if (!card.touched || id === undefined ||
			(state.deck[order].identity() !== undefined && !state.deck[order].matches(id)) ||		// Card is visible and doesn't match
			(!card.matches(id) && card.newly_clued && !card.focused) ||			// Unknown newly clued cards off focus?
			unconfirmed.has(order)
		)
			return;

		const id_hash = logCard(id);

		if (card.matches(id) || card.focused)
			hard_match_map.set(id_hash, (hard_match_map.get(id_hash) ?? new Set()).add(order));

		match_map.set(id_hash, (match_map.get(id_hash) ?? new Set()).add(order));
	};

	/** @type {number[]} */
	const elim_candidates = [];

	for (let i = 0; i < state.numPlayers; i++) {
		if (only_self && i !== this.playerIndex)
			continue;

		for (const { order } of state.hands[i]) {
			addToMaps(order);

			const card = this.thoughts[order];
			const can_elim = card.touched ||					// Touched cards always elim
				(this.playerIndex !== -1 && card.chop_moved);	// Chop moved cards can asymmetric elim

			if (can_elim && card.inferred.length > 0 && card.inferred.some(inf => !state.isBasicTrash(inf)) && !card.certain_finessed)
				elim_candidates.push(order);
		}
	}

	const identities = this.all_possible.array.slice();
	const resets = /** @type {Set<number>} */ (new Set());

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const id_hash = logCard(identity);
		const soft_matches = match_map.get(id_hash);

		if (soft_matches === undefined && !state.isBasicTrash(identity))
			continue;

		const hard_matches = hard_match_map.get(logCard(identity));
		const matches = hard_matches ?? soft_matches ?? new Set();

		for (const order of elim_candidates) {
			const card = this.thoughts[order];

			if (matches.has(order) || card.inferred.length === 0 || !card.inferred.has(identity))
				continue;

			// Check if every match was from the clue giver
			const asymmetric_gt = Utils.range(0, state.numPlayers).some(index =>
				card.clues.every(c => c.giver === index) &&
				matches.size > 0 &&
				Array.from(matches).every(o =>
					state.hands[index].some(c => c.order === o) &&
					this.thoughts[o].possibilities.length > 1
				));

			if (asymmetric_gt)
				continue;

			// TODO: Temporary stop-gap so that Bob still plays into it. Bob should actually clue instead.
			if (card.finessed && [0, 1].some(i => card.finesse_index === state.actionList.length - i)) {
				logger.warn(`tried to gt eliminate ${id_hash} from recently finessed card (player ${this.playerIndex}, order ${order})!`);
				card.certain_finessed = true;
				elim_candidates.splice(elim_candidates.indexOf(order), 1);
				continue;
			}

			const pre_inferences = card.inferred.length;
			card.inferred = card.inferred.subtract(identity);

			if (this.playerIndex === -1) {
				this.elims[id_hash] ??= [];
				this.elims[id_hash].push(order);
			}

			if (card.inferred.length === 0 && !card.reset) {
				this.reset_card(order);
				resets.add(order);
			}
			// Newly eliminated
			else if (card.inferred.length === 1 && pre_inferences > 1 && !state.isBasicTrash(card.inferred.array[0])) {
				identities.push(card.inferred.array[0]);
			}

			addToMaps(order);
		}
	}

	return resets;
}

/**
 * @this {Player}
 * @param {number} order
 */
export function reset_card(order) {
	const card = this.thoughts[order];
	card.reset = true;

	if (card.finessed) {
		card.finessed = false;
		card.hidden = false;
		if (card.old_inferred !== undefined) {
			card.inferred = card.old_inferred.intersect(card.possible);
		}
		else {
			logger.error(`no old inferred on card with order ${order}! player ${this.playerIndex}`);
			card.inferred = card.possible;
		}

		// Filter out future waiting connections involving this card
		this.waiting_connections = this.waiting_connections.filter(wc =>
			!wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order));
	}
	else {
		card.inferred = card.possible;
	}
}

/**
 * Finds good touch (non-promised) links in the hand.
 * @this {Player}
 * @param {State} state
 * @param {Hand} [hand]
 */
export function find_links(state, hand = state.hands[this.playerIndex]) {
	if (this.playerIndex === -1 && hand === undefined) {
		for (const hand of state.hands)
			this.find_links(state, hand);

		return;
	}

	const linked_orders = new Set(this.links.flatMap(link => link.cards.map(c => c.order)));

	for (const { order } of hand) {
		const card = this.thoughts[order];

		if (linked_orders.has(order) ||									// Already in a link
			card.identity() !== undefined ||							// We know what this card is
			card.inferred.length === 0 ||								// Card has no inferences
			card.inferred.length > 3 ||									// Card has too many inferences
			card.inferred.every(inf => state.isBasicTrash(inf))) {		// Card is trash
			continue;
		}

		// Find all unknown cards with the same inferences
		const linked_cards = Array.from(hand.filter(c =>
			card.identity() === undefined && card.inferred.equals(this.thoughts[c.order].inferred)
		));

		if (linked_cards.length === 1)
			continue;

		// We have enough inferred cards to eliminate elsewhere
		// TODO: Sudoku elim from this
		if (linked_cards.length > card.inferred.reduce((sum, inf) => sum += unknownIdentities(state, this, inf), 0)) {
			logger.info('adding link', linked_cards.map(c => c.order), 'inferences', card.inferred.map(logCard), state.playerNames[this.playerIndex]);

			this.links.push({ cards: linked_cards, identities: card.inferred.map(c => c.raw()), promised: false });
			for (const c of linked_cards)
				linked_orders.add(c.order);
		}
	}
}

/**
 * Refreshes the array of links based on new information (if any).
 * @this {Player}
 * @param {State} state
 */
export function refresh_links(state) {
	// Get the link indices that we need to redo (after learning new things about them)
	const remove_indices = [];

	for (let i = 0; i < this.links.length; i++) {
		const { cards, identities, promised } = this.links[i];

		if (promised) {
			if (identities.length > 1)
				throw new Error(`found promised link with cards ${cards.map(c => c.order)} but multiple identities ${identities.map(logCard)}`);

			// At least one card matches, promise resolved
			if (cards.some(c => this.thoughts[c.order].identity()?.matches(identities[0]))) {
				remove_indices.push(i);
			}
			else {
				// Reduce cards to ones that still have the identity as a possibility
				const viable_cards = cards.filter(c => this.thoughts[c.order].possible.has(identities[0]));

				if (viable_cards.length <= 1) {
					if (viable_cards.length === 0) {
						logger.warn(`promised identity ${logCard(identities[0])} not found among cards ${cards.map(c => c.order)}, rewind?`);
					}
					else {
						const viable_card = this.thoughts[viable_cards[0].order];
						viable_card.inferred = viable_card.inferred.intersect(identities[0]);
					}
					remove_indices.push(i);
				}
				else {
					this.links[i].cards = viable_cards;
				}
			}
		}
		else {
			const revealed = cards.filter(c => {
				const card = this.thoughts[c.order];

				// The card is globally known or an identity is no longer possible
				return card.identity() || identities.some(id => !card.possible.has(id));
			});

			if (revealed.length > 0)
				remove_indices.push(i);
		}
	}

	// Clear links that we're removing
	this.links = this.links.filter((_, index) => !remove_indices.includes(index));
	this.find_links(state);
}

/**
 * @this {Player}
 * @param {Identity} identity
 */
export function restore_elim(identity) {
	const id = logCard(identity);
	const elims = this.elims[id];

	if (elims) {
		logger.warn('adding back inference', id, 'which was falsely eliminated from', elims);

		for (const order of elims) {
			const card = this.thoughts[order];

			// Add the inference back if it's still a possibility
			if (card.possible.has(identity))
				card.inferred = card.inferred.union(identity);
		}

		this.all_inferred = this.all_inferred.union(identity);
		this.elims[id] = undefined;
	}
}
