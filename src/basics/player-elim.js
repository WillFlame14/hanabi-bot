import { cardCount } from '../variants.js';
import { IdentitySet } from './IdentitySet.js';
import { unknownIdentities } from './hanabi-util.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';
import { produce } from '../StateProxy.js';

/**
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
	const certain_map = /** @type {Map<string, Set<number>>} */ (new Map());
	let uncertain_ids = state.base_ids;
	let uncertain_map = /** @type {Map<number, IdentitySet>} */ (new Map());

	const candidates = state.hands.flatMap((hand, playerIndex) => hand.map(order => ({ playerIndex, order })));
	let identities = state.all_ids;

	/** @type {(order: number) => void} */
	const addToMap = (order) => {
		const card = this.thoughts[order];
		const id = card.identity({ symmetric: this.playerIndex === -1 });

		if (id !== undefined) {
			const id_hash = logCard(id);
			certain_map.set(id_hash, (certain_map.get(id_hash) ?? new Set()).add(order));
			candidates.splice(candidates.findIndex(c => c.order === order), 1);
		}
	};

	for (const order of state.hands.flat())
		addToMap(order);

	/**
	 * The "typical" empathy operation. If there are enough known instances of an identity, it is removed from every card (including future cards).
	 * Returns true if at least one card was modified.
	 */
	const basic_elim = () => {
		let changed = false;
		const curr_identities = identities.array;
		let new_identities = identities;

		for (let i = 0; i < curr_identities.length; i++) {
			const identity = curr_identities[i];
			const id_hash = logCard(identity);

			const known_count = state.baseCount(identity) + (certain_map.get(id_hash)?.size ?? 0) + (uncertain_ids.has(identity) ? 1 : 0);
			const total_count = cardCount(state.variant, identity);

			if (known_count !== total_count)
				continue;

			// Remove it from the list of future possibilities
			this.all_possible = this.all_possible.subtract(identity);
			this.all_inferred = this.all_inferred.subtract(identity);
			new_identities = new_identities.subtract(identity);

			for (const { order } of candidates) {
				const { possible, inferred } = this.thoughts[order];

				if (!possible.has(identity) || certain_map.get(id_hash)?.has(order) || uncertain_map.get(order)?.has(identity))
					continue;

				changed = true;

				this.updateThoughts(order, (draft) => {
					draft.possible = possible.subtract(identity);
					draft.inferred = inferred.subtract(identity);
				});

				const updated_card = this.thoughts[order];

				if (updated_card.inferred.length === 0 && !updated_card.reset) {
					this.thoughts[order] = this.reset_card(order);
				}
				// Card can be further eliminated
				else if (updated_card.possible.length === 1) {
					curr_identities.push(updated_card.identity());
					addToMap(order);
				}
			}
			// logger.debug(`removing ${id_hash} from ${state.playerNames[this.playerIndex]} possibilities, now ${this.all_possible.map(logCard)}`);
		}
		identities = new_identities;
		return changed;
	};

	/**
	 * The "sudoku" empathy operation, involving 2 parts.
	 * Symmetric info - if Alice has [r5,g5] and Bob has [r5,g5], then everyone knows how r5 and g5 are distributed.
	 * Naked pairs - If Alice has 3 cards with [r4,g5], then everyone knows that both r4 and g5 cannot be elsewhere (will be eliminated in basic_elim).
	 * Returns true if at least one card was modified.
	 */
	const cross_elim = () => {
		uncertain_ids = state.base_ids;
		uncertain_map = new Map();

		let changed = false;

		const cross_elim_candidates = candidates.filter(({ order }) => {
			const card = this.thoughts[order];
			return card.possible.length <= 5 || card.clued;
		});

		/**
		 * @param {{ order: number, playerIndex: number }[]} entries
		 * @param {IdentitySet} identities
		 */
		const perform_elim = (entries, identities) => {
			// There are N cards for N identities - everyone knows they are holding what they cannot see
			for (const { playerIndex: p1, order: o1 } of entries) {
				const elim_id = state.deck[o1].identity();
				if (elim_id === undefined)
					continue;

				for (const { playerIndex: p2, order: o2 } of entries) {
					// Players still cannot elim from themselves
					if (p1 === p2 || !this.thoughts[o2].possible.has(elim_id))
						continue;

					const { possible, inferred } = this.thoughts[o2];
					this.updateThoughts(o2, (draft) => {
						draft.possible = possible.subtract(elim_id);
						draft.inferred = inferred.intersect(possible);
					});
					changed = true;
				}
			}

			if (!changed) {
				for (const { order } of entries)
					uncertain_map.set(order, state.base_ids.union(identities));

				uncertain_ids = uncertain_ids.union(identities);
			}

			for (const e of entries)
				cross_elim_candidates.splice(cross_elim_candidates.findIndex(({ order }) => order === e.order), 1);
		};

		/** @param {IdentitySet} identities */
		const total_multiplicity = (identities) => identities.reduce((acc, id) => acc += cardCount(state.variant, id) - state.baseCount(id), 0);

		for (let i = 2; i <= cross_elim_candidates.length; i++) {
			const subsets = Utils.allSubsetsOfSize(cross_elim_candidates.filter(({ order }) => this.thoughts[order].possible.length <= i), i);

			for (const subset of subsets) {
				let failed = false;
				let acc_ids = state.base_ids;
				for (const { order } of subset) {
					acc_ids = acc_ids.union(this.thoughts[order].possible);

					if (total_multiplicity(acc_ids) > subset.length) {
						failed = true;
						break;
					}
				}

				if (!failed && subset.length === total_multiplicity(acc_ids))
					perform_elim(subset, acc_ids);
			}
		}

		return changed;
	};

	basic_elim();

	while (cross_elim() || basic_elim());
}

/**
 * Eliminates card identities based on Good Touch Principle.
 * Returns the orders of the cards that lost all inferences (were reset).
 * @this {Player}
 * @param {State} state
 * @param {boolean} only_self 	Whether to only use cards in own hand for elim (e.g. in 2-player games, where GTP is less strong.)
 */
export function good_touch_elim(state, only_self = false) {
	const match_map = /** @type {Map<string, Set<number>>} */ (new Map());
	const hard_match_map = /** @type {Map<string, Set<number>>} */ (new Map());
	const cross_map = /** @type {Map<number, Set<number>>} */ (new Map());

	/** @type {(order: number) => void} */
	const addToMaps = (order) => {
		const card = this.thoughts[order];
		const id = card.identity({ infer: true, symmetric: this.playerIndex === -1 });

		if (!card.touched)
			return;

		if (id === undefined) {
			if (card.inferred.length < 5 && this.playerIndex === -1) {
				const cross_set = cross_map.get(card.inferred.value) ?? new Set();
				cross_set.add(order);
				cross_map.set(card.inferred.value, cross_set);
			}
			return;
		}

		if ((state.deck[order].identity() !== undefined && !state.deck[order].matches(id)) ||		// Card is visible and doesn't match
			(state.baseCount(id) + state.hands.flat().filter(o => state.deck[o].matches(id) && o !== order).length === cardCount(state.variant, id)) ||	// Card cannot match
			(!card.matches(id) && card.newly_clued && !card.focused) ||			// Unknown newly clued cards off focus?
			card.uncertain
		)
			return;

		const id_hash = logCard(id);

		if (card.matches(id) || card.focused)
			hard_match_map.set(id_hash, (hard_match_map.get(id_hash) ?? new Set()).add(order));

		match_map.set(id_hash, (match_map.get(id_hash) ?? new Set()).add(order));

		const matches = match_map.get(id_hash);
		const hard_matches = hard_match_map.get(id_hash);

		if (matches && hard_matches && (state.baseCount(id) + matches.size > cardCount(state.variant, id))) {
			const visibles = Array.from(matches).concat(Array.from(hard_matches)).filter(o => state.deck[o].matches(id));

			if (visibles.length > 0) {
				for (const v of visibles) {
					const holder = state.hands.findIndex(hand => hand.includes(v));

					// This player can see the identity, so their card must be trash - the player with the identity can see the trash
					for (const hard_match of hard_matches) {
						if (state.hands.findIndex(hand => hand.includes(hard_match)) !== holder)
							hard_matches.delete(hard_match);
					}
				}
				hard_match_map.delete(id_hash);
				return;
			}
		}
	};

	const cross_elim = () => {
		for (const [identities, orders] of cross_map) {
			const identity_set = new IdentitySet(state.variant.suits.length, identities);

			// There aren't the correct number of cards sharing this set of identities
			if (orders.size !== identity_set.length)
				continue;

			const orders_arr = Array.from(orders);
			const holders = orders_arr.map(o => state.hands.findIndex(hand => hand.includes(o)));
			let change = false;

			for (let i = 0; i < orders.size; i++) {
				const card = this.thoughts[orders_arr[i]];

				for (let j = 0; j < orders.size; j++) {
					const other_card = state.deck[orders_arr[j]];

					// Globally, a player can subtract identities others have, knowing others can see the identities they have.
					if (i !== j && holders[i] !== holders[j] && card.inferred.has(other_card)) {
						this.updateThoughts(orders_arr[i], (draft) => { draft.inferred = this.thoughts[orders_arr[i]].inferred.subtract(other_card); });
						change = true;
					}
				}
			}

			if (change) {
				cross_map.delete(identities);

				for (const order of orders)
					addToMaps(order);
			}
		}
	};

	/** @type {{ order: number, playerIndex: number, cm: boolean }[]} */
	const elim_candidates = [];

	for (let i = 0; i < state.numPlayers; i++) {
		if (only_self && i !== this.playerIndex)
			continue;

		for (const order of state.hands[i]) {
			addToMaps(order);

			if (this.thoughts[order].trash)
				continue;

			const card = this.thoughts[order];

			if (card.inferred.length > 0 && card.possible.some(inf => !state.isBasicTrash(inf)) && !card.certain_finessed) {
				// Touched cards always elim
				if (card.touched)
					elim_candidates.push({ order, playerIndex: i, cm: false });

				// Chop moved cards can asymmetric/visible elim
				else if (card.chop_moved)
					elim_candidates.push({ order, playerIndex: i, cm: this.playerIndex === -1 });
			}
		}
	}

	cross_elim();

	const identities = state.all_ids.array;
	const resets = /** @type {Set<number>} */ (new Set());

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const id_hash = logCard(identity);
		const soft_matches = match_map.get(id_hash);

		if (soft_matches === undefined && !state.isBasicTrash(identity))
			continue;

		const hard_matches = hard_match_map.get(logCard(identity));
		const matches = hard_matches ?? soft_matches ?? new Set();
		const matches_arr = Array.from(matches);

		for (const { order, playerIndex, cm } of elim_candidates) {
			const old_card = this.thoughts[order];

			if (matches.has(order) || old_card.inferred.length === 0 || !old_card.inferred.has(identity))
				continue;

			const visible_elim = state.hands.some(hand => hand.some(o => matches.has(o) && state.deck[o].matches(identity, { assume: true }))) &&
				state.baseCount(identity) + matches.size >= cardCount(state.variant, identity);

			const original_clue = old_card.clues[0];

			// Check if every match was from the clue giver (or vice versa)
			const asymmetric_gt = !(cm && visible_elim) && matches.size > 0 &&
				(matches_arr.every(o => {
					const match_orig_clue = this.thoughts[o].clues[0];
					return match_orig_clue?.giver === playerIndex && match_orig_clue.turn > (original_clue?.turn ?? 0);
				}) ||
				(original_clue?.giver && matches_arr.every(o =>
					state.hands[original_clue?.giver].includes(o) &&
					this.thoughts[o].possibilities.length > 1
				)));

			if (asymmetric_gt)
				continue;

			// TODO: Temporary stop-gap so that Bob still plays into it. Bob should actually clue instead.
			if (old_card.finessed && [0, 1].some(i => old_card.finesse_index === state.actionList.length - i)) {
				logger.warn(`tried to gt eliminate ${id_hash} from recently finessed card (player ${this.playerIndex}, order ${order})!`);
				this.updateThoughts(order, (draft) => { draft.certain_finessed = true; });
				elim_candidates.splice(elim_candidates.findIndex(c => c.order === order), 1);
				continue;
			}

			// Check if can't visible elim on cm card (not visible, or same hand)
			if (cm && !visible_elim)
				continue;

			this.updateThoughts(order, (draft) => { draft.inferred = this.thoughts[order].inferred.subtract(identity); });
			const new_card = this.thoughts[order];

			if (this.playerIndex === -1) {
				this.elims[id_hash] ??= [];

				if (!this.elims[id_hash].includes(order))
					this.elims[id_hash].push(order);
			}

			if (!cm) {
				if (new_card.inferred.length === 0 && !new_card.reset) {
					this.thoughts[order] = this.reset_card(order);
					resets.add(order);
				}
				// Newly eliminated
				else if (new_card.inferred.length === 1 && old_card.inferred.length > 1 && !state.isBasicTrash(new_card.inferred.array[0])) {
					identities.push(new_card.inferred.array[0]);
				}
			}

			addToMaps(order);

			if (i === identities.length - 1)
				cross_elim();
		}
	}

	return resets;
}

/**
 * @this {Player}
 * @param {number} order
 */
export function reset_card(order) {
	const { possible, old_inferred } = this.thoughts[order];

	return produce(this.thoughts[order], (draft) => {
		draft.reset = true;

		if (draft.finessed) {
			draft.finessed = false;
			draft.hidden = false;
			if (draft.old_inferred !== undefined) {
				draft.inferred = old_inferred.intersect(possible);
			}
			else {
				logger.error(`no old inferred on card with order ${order}! player ${this.playerIndex}`);
				draft.inferred = possible;
			}
		}
		else {
			draft.inferred = possible;
		}
	});
}

/**
 * Finds good touch (non-promised) links in the hand.
 * @this {Player}
 * @param {State} state
 * @param {number[]} [hand]
 */
export function find_links(state, hand = state.hands[this.playerIndex]) {
	if (this.playerIndex === -1 && hand === undefined)
		return state.hands.flatMap(hand => this.find_links(state, hand));

	const links = [];
	const linked_orders = new Set(this.links.flatMap(link => link.orders));

	for (const order of hand) {
		const card = this.thoughts[order];

		if (linked_orders.has(order) ||									// Already in a link
			card.identity() !== undefined ||							// We know what this card is
			card.inferred.length === 0 ||								// Card has no inferences
			card.inferred.length > 3 ||									// Card has too many inferences
			card.inferred.every(inf => state.isBasicTrash(inf))) {		// Card is trash
			continue;
		}

		// Find all unknown cards with the same inferences
		const orders = hand.filter(o => card.identity() === undefined && card.inferred.equals(this.thoughts[o].inferred));
		if (orders.length === 1)
			continue;

		// We have enough inferred cards to eliminate elsewhere
		// TODO: Sudoku elim from this
		if (orders.length > card.inferred.reduce((sum, inf) => sum += unknownIdentities(state, this, inf), 0)) {
			logger.info('adding link', orders, 'inferences', card.inferred.map(logCard), state.playerNames[this.playerIndex]);

			links.push({ orders, identities: card.inferred.map(c => c.raw()), promised: false });
			for (const o of orders)
				linked_orders.add(o);
		}
	}

	return links;
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
		const { orders, identities, promised } = this.links[i];

		if (promised) {
			if (identities.length > 1)
				throw new Error(`found promised link with orders ${orders} but multiple identities ${identities.map(logCard)}`);

			// At least one card matches, promise resolved
			if (orders.some(o => this.thoughts[o].identity()?.matches(identities[0]))) {
				remove_indices.push(i);
			}
			else {
				// Reduce cards to ones that still have the identity as a possibility
				const viable_orders = orders.filter(o => this.thoughts[o].possible.has(identities[0]));

				if (viable_orders.length <= 1) {
					if (viable_orders.length === 0)
						logger.warn(`promised identity ${logCard(identities[0])} not found among cards ${orders}, rewind?`);
					else
						this.updateThoughts(viable_orders[0], (draft) => { draft.inferred = this.thoughts[viable_orders[0]].inferred.intersect(identities[0]); });
					remove_indices.push(i);
				}
				else {
					this.links[i].orders = viable_orders;
				}
			}
		}
		else {
			const revealed = orders.filter(o => {
				const card = this.thoughts[o];

				// The card is globally known or an identity is no longer possible
				return card.identity() || identities.some(id => !card.possible.has(id));
			});

			if (revealed.length > 0) {
				remove_indices.push(i);
				continue;
			}

			const focused_orders = orders.filter(o => this.thoughts[o].focused);

			if (focused_orders.length === 1) {
				logger.info('eliminating link with inferences', identities.map(logCard), 'from focus! final', focused_orders[0]);
				this.updateThoughts(orders[0], (draft) => { draft.inferred = this.thoughts[orders[0]].inferred.intersect(identities[0]); });
				remove_indices.push(i);
			}

			const lost_inference = identities.find(i => orders.every(o => !this.thoughts[o].inferred.has(i)));
			if (lost_inference !== undefined) {
				logger.info('linked orders', orders, 'lost inference', logCard(lost_inference));
				remove_indices.push(i);
			}
		}
	}

	// Clear links that we're removing
	this.links = this.links.filter((_, index) => !remove_indices.includes(index)).concat(this.find_links(state));
}

/**
 * @this {Player}
 * @param {Identity} identity
 */
export function restore_elim(identity) {
	const id = logCard(identity);
	const elims = this.elims[id];

	if (elims?.length > 0) {
		logger.warn('adding back inference', id, 'which was falsely eliminated from', elims);

		for (const order of elims) {
			// Add the inference back if it's still a possibility
			if (this.thoughts[order].possible.has(identity))
				this.updateThoughts(order, (draft) => { draft.inferred = this.thoughts[order].inferred.union(identity); });
		}

		this.all_inferred = this.all_inferred.union(identity);
		this.elims[id] = undefined;
	}
}
