import { cardCount } from '../variants.js';
import { baseCount, unknownIdentities } from './hanabi-util.js';
import * as Basics from '../basics.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard, logLinks } from '../tools/log.js';

/**
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./State.js').State} State
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').Link} Link
 */

/**
 * @this {Player}
 * @param {State} state
 * @param {BasicCard} identity 		The identity to be eliminated.
 * @returns {Card[]}				Any additional recursive eliminations performed.
 */
export function card_elim(state, identity) {
	// Skip if already eliminated
	if (!this.all_possible.some(c => c.matches(identity))) {
		return [];
	}

	const base_count = baseCount(state, identity);
	const certain_cards = state.hands.flat().filter(c => this.thoughts[c.order].matches(identity, { infer: true }));
	const total_count = cardCount(state.suits, identity);

	let new_elims = /** @type {Card[]} */ ([]);

	// All cards are known accounted for
	if (base_count + certain_cards.length === total_count) {
		// Remove it from the list of future possibilities
		this.all_possible = this.all_possible.filter(c => !c.matches(identity));

		for (const { order } of state.hands.flat()) {
			const card = this.thoughts[order];

			if (card.possible.length > 1 && !certain_cards.some(c => c.order === card.order)) {
				card.subtract('possible', [identity]);
				card.subtract('inferred', [identity]);

				// Card can be further eliminated
				if (card.possible.length === 1) {
					const identity2 = card.identity();
					new_elims.push(identity2);

					for (let i = 0; i < state.numPlayers; i++) {
						const recursive_elims = this.card_elim(state, identity2.raw()).filter(c => !new_elims.some(elim => elim.matches(c)));
						new_elims = new_elims.concat(recursive_elims);
					}
				}
			}
		}
		logger.debug(`removing ${logCard(identity)} from ${state.playerNames[this.playerIndex]} possibilities`);
	}
	return new_elims;
}

/**
 * @this {Player}
 * @param {State} state
 * @param {BasicCard} identity 		The identity to be eliminated.
 * @returns {Card[]}				Any additional recursive eliminations performed.
 */
export function infer_elim(state, identity) {
	this.card_elim(state, identity);

	// Skip if already eliminated
	if (!this.all_inferred.some(c => c.matches(identity))) {
		return [];
	}

	const base_count = baseCount(state, identity);
	let inferred_cards = state.hands.flat().filter(c => this.thoughts[c.order].matches(identity, { infer: true }));
	const total_count = cardCount(state.suits, identity);
	let focus_elim = false;

	let new_elims = /** @type {Card[]} */ ([]);

	if (base_count + inferred_cards.length >= total_count) {
		if (base_count + inferred_cards.length > total_count) {
			logger.warn(`inferring ${base_count + inferred_cards.length} copies of ${logCard(identity)}`);

			const initial_focus = inferred_cards.filter(c => this.thoughts[c.order].focused);

			// TODO: Check if "base_count + 1 === total_count" is needed?
			if (initial_focus.length === 1) {
				logger.info('eliminating from focus!');
				inferred_cards = initial_focus;
				focus_elim = true;
			}
			else {
				const new_link = { cards: inferred_cards, identities: [identity], promised: false };

				// Don't add duplicates of the same link
				if (!this.links.some(link => Utils.objEquals(link, new_link))) {
					logger.info('adding link', logLinks([new_link]));
					this.links.push(new_link);
				}
			}
		}

		// Remove it from the list of future inferences
		this.all_inferred = this.all_inferred.filter(c => !c.matches(identity));

		for (const { order } of state.hands.flat()) {
			const card = this.thoughts[order];

			if ((card.inferred.length > 1 || focus_elim) && !inferred_cards.some(c => c.order === card.order)) {
				card.subtract('inferred', [identity]);

				// Card can be further eliminated
				if (card.inferred.length === 1) {
					if (card.identity() !== undefined && !card.matches(identity)) {
						logger.warn(`incorrectly trying to elim card ${logCard(card)} as ${logCard(identity)}!`);
						continue;
					}

					const identity2 = card.inferred[0];
					new_elims.push(identity2);

					for (let i = 0; i < state.numPlayers; i++) {
						const recursive_elims = this.infer_elim(state, identity2.raw()).filter(c => !new_elims.some(elim => elim.matches(c)));
						new_elims = new_elims.concat(recursive_elims);
					}
				}
			}
		}
		logger.debug(`removing ${logCard(identity)} from ${state.playerNames[this.playerIndex]} inferences`);
	}
	return new_elims;
}

/**
 * @this {Player}
 * @param {State} state
 * @param {number} playerIndex
 * @param {BasicCard} identity
 * @param {{ignore?: number[], hard?: boolean}} options
 */
export function good_touch_elim(state, playerIndex, identity, options = {}) {
	let additional_elims = gt_helper(state, this, identity, options);
	let elim_index = 0;

	while (elim_index < additional_elims.length) {
		const identity = additional_elims[elim_index].raw();
		for (let i = 0; i < state.numPlayers; i++) {
			const extra_card_elims = Basics.card_elim(state, playerIndex, identity);
			const extra_gtp_elims = gt_helper(state, this, identity);		// No ignoring or hard elims when recursing

			additional_elims = additional_elims.concat(extra_card_elims.concat(extra_gtp_elims));
		}
		elim_index++;
	}
}

/**
 * @param {State} state
 * @param {Player} player
 * @param {BasicCard} identity
 * @param {{ignore?: number[], hard?: boolean}} options
 */
function gt_helper(state, player, identity, options = {}) {
	const new_elims = [];

	for (const { order } of state.hands[player.playerIndex]) {
		const card = player.thoughts[order];

		if (options.ignore?.includes(card.order)) {
			continue;
		}

		if (card.saved && (options.hard || card.inferred.length > 1)) {
			const pre_inferences = card.inferred.length;

			card.subtract('inferred', [identity]);

			if (card.inferred.length === 0) {
				card.reset = true;

				if (card.finessed) {
					card.finessed = false;
					card.inferred = card.old_inferred;

					// Filter out future waiting connections involving this card
					state.waiting_connections = state.waiting_connections.filter(wc =>
						!wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === card.order));
				}
			}
			// Newly eliminated
			else if (card.inferred.length === 1 && pre_inferences > 1) {
				new_elims.push(card.inferred[0]);
			}
		}
	}

	return new_elims;
}

/**
 * Finds good touch (non-promised) links in the hand.
 * @this {Player}
 * @param {State} state
 */
export function find_links(state) {
	const hand = state.hands[this.playerIndex];

	for (const { order } of hand) {
		const card = this.thoughts[order];

		// Already in a link, ignore
		if (this.links.some(({cards}) => cards.some(c => c.order === order))) {
			continue;
		}

		// We know what this card is
		if (card.identity() !== undefined) {
			continue;
		}

		// Card has no inferences
		if (card.inferred.length === 0) {
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
			logger.info('adding link', linked_cards.map(c => c.order), 'inferences', card.inferred.map(inf => logCard(inf)));

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
	// Get the link indices that we need to redo (after learning new things about them)
	const redo_elim_indices = this.links.map(({cards, identities}, index) =>
		// The card is globally known or an identity is no longer possible
		cards.some(c => c.identity({ symmetric: true }) || identities.some(id => !c.possible.some(p => p.matches(id)))) ? index : -1
	).filter(index => index !== -1);

	// Try eliminating all the identities again
	const redo_elim_ids = redo_elim_indices.map(index => this.links[index].identities).flat();

	// Clear links that we're redoing
	this.links = this.links.filter((_, index) => !redo_elim_indices.includes(index));

	for (const id of redo_elim_ids) {
		this.infer_elim(state, id);
	}

	this.find_links(state);
}
