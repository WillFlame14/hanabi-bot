import { cardCount } from '../variants.js';
import { baseCount, isBasicTrash, unknownIdentities, visibleFind } from './hanabi-util.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').ActualCard} ActualCard
 * @typedef {import('./Card.js').BasicCard} BasicCard
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
	const identities = this.all_possible.slice();

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const certain_cards = visibleFind(state, this, identity);

		if (baseCount(state, identity) + certain_cards.length !== cardCount(state.suits, identity)) {
			continue;
		}

		// Remove it from the list of future possibilities
		this.all_possible.splice(this.all_possible.findIndex(c => c.matches(identity)), 1);
		this.all_inferred.splice(this.all_inferred.findIndex(c => c.matches(identity)), 1);

		for (const { order } of state.hands.flat()) {
			const card = this.thoughts[order];

			if (card.possible.length > 1 && !certain_cards.some(c => c.order === order)) {
				card.subtract('possible', [identity]);
				card.subtract('inferred', [identity]);

				// Card can be further eliminated
				if (card.possible.length === 1 && this.all_possible.some(c => c.matches(card.identity()))) {
					identities.push(card.identity());
				}
			}
		}
		logger.debug(`removing ${logCard(identity)} from ${state.playerNames[this.playerIndex]} possibilities, now ${this.all_possible.map(c => logCard(c))}`);
	}
}

/**
 * Eliminates card identities based on Good Touch Principle.
 * Returns the orders of the cards that lost all inferences (were reset).
 * @this {Player}
 * @param {State} state
 */
export function good_touch_elim(state) {
	const identities = this.all_possible.slice();
	const resets = /** @type {Set<number>} */ (new Set());

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const matches = state.hands.flat().filter(c => {
			const card = this.thoughts[c.order];
			return card.saved &&
				card.matches(identity, { infer: true }) &&
				(card.matches(identity) || !card.newly_clued || card.focused) &&		// Don't good touch from unknown newly clued cards off focus?
				!this.waiting_connections.some(wc => wc.connections.some(conn => conn.card.order === c.order));
		});

		if (matches.length === 0 && !isBasicTrash(state, identity)) {
			continue;
		}

		const hard_matches = matches.filter(c => {
			const card = this.thoughts[c.order];
			return card.matches(identity) || card.focused;
		});

		for (const { order } of state.hands.flat()) {
			const card = this.thoughts[order];

			if (!card.saved ||															// Unsaved cards
				hard_matches.some(c => c.order === order) ||							// Hard matches
				(hard_matches.length === 0 && matches.some(c => c.order === order)) ||	// Soft matches when there are no hard matches
				card.inferred.length === 0 ||											// Cards with no inferences
				!card.inferred.some(c => c.matches(identity))) {						// Cards that don't have this inference
				continue;
			}

			const pre_inferences = card.inferred.length;
			card.subtract('inferred', [identity]);

			if (this.playerIndex === -1) {
				if (state.elims[logCard(identity)] === undefined) {
					state.elims[logCard(identity)] = [];
				}
				state.elims[logCard(identity)].push(order);
			}

			if (card.inferred.length === 0) {
				card.reset = true;
				resets.add(order);

				if (card.finessed) {
					card.finessed = false;
					card.inferred = card.old_inferred;

					// Filter out future waiting connections involving this card
					this.waiting_connections = this.waiting_connections.filter(wc =>
						!wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order));
				}
				else {
					card.inferred = card.possible.slice();
				}
			}
			// Newly eliminated
			else if (card.inferred.length === 1 && pre_inferences > 1) {
				identities.push(card.inferred[0]);
			}
		}
	}

	return Array.from(resets);
}

/**
 * Finds good touch (non-promised) links in the hand.
 * @this {Player}
 * @param {State} state
 */
export function find_links(state) {
	if (this.playerIndex === -1) {
		return;
	}

	const hand = state.hands[this.playerIndex];

	for (const { order } of hand) {
		const card = this.thoughts[order];

		if (this.links.some(({cards}) => cards.some(c => c.order === order)) ||		// Already in a link
			card.identity() !== undefined ||										// We know what this card is
			card.inferred.length === 0) {											// Card has no inferences
			continue;
		}

		// Find all unknown cards with the same inferences
		const linked_cards = Array.from(hand.filter(c => {
			const card2 = this.thoughts[c.order];

			return card.identity() === undefined &&
				card.inferred.length === card2.inferred.length &&
				card2.inferred.every(inf => card.inferred.some(inf2 => inf2.matches(inf)));
		}));

		// We have enough inferred cards to eliminate elsewhere
		// TODO: Sudoku elim from this
		if (linked_cards.length > card.inferred.reduce((sum, inf) => sum += unknownIdentities(state, this, inf), 0)) {
			logger.info('adding link', linked_cards.map(c => c.order), 'inferences', card.inferred.map(inf => logCard(inf)), this.playerIndex);

			this.links.push({ cards: linked_cards, identities: card.inferred.map(c => c.raw()), promised: false });
		}
	}
}

/**
 * Refreshes the array of links based on new information (if any).
 * @this {Player}
 * @param {State} state
 */
export function refresh_links(state) {
	if (this.playerIndex === -1) {
		return;
	}

	// Get the link indices that we need to redo (after learning new things about them)
	const redo_elim_indices = Utils.findIndices(this.links, ({cards, identities}) =>
		cards.some(c => {
			const card = this.thoughts[c.order];

			// The card is globally known or an identity is no longer possible
			return card.identity() || identities.some(id => !card.possible.some(p => p.matches(id)));
		})
	);

	// Clear links that we're redoing
	this.links = this.links.filter((_, index) => !redo_elim_indices.includes(index));

	this.card_elim(state);
	this.find_links(state);
}
