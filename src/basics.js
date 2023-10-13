import { Card } from './basics/Card.js';
import { cardCount } from './variants.js';
import { find_possibilities } from './basics/helper.js';
import { baseCount, unknownIdentities, visibleFind } from './basics/hanabi-util.js';

import logger from './tools/logger.js';
import { logCard, logLinks } from './tools/log.js';
import * as Utils from './tools/util.js';

/**
 * @typedef {import('./basics/State.js').State} State
 * @typedef {import('./types.js').BasicCard} BasicCard
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * @param {State} state
 * @param {ClueAction} action
 */
export function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.suits);

	for (const card of state.hands[target]) {
		const previously_unknown = card.possible.length > 1;

		if (list.includes(card.order)) {
			const inferences_before = card.inferred.length;
			card.intersect('possible', new_possible);
			card.intersect('inferred', new_possible);

			if (!card.clued) {
				card.newly_clued = true;
				card.clued = true;
			}
			card.clues.push(clue);
			if (card.inferred.length < inferences_before) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}
		}
		else {
			card.subtract('possible', new_possible);
			card.subtract('inferred', new_possible);
		}

		// If card is now definitely known to everyone and wasn't previously - eliminate
		if (previously_unknown && card.possible.length === 1) {
			for (let i = 0; i < state.numPlayers; i++) {
				card_elim(state, i, card.possible[0].raw());
				refresh_links(state, i);
			}
		}
	}

	state.clue_tokens--;
}

/**
 * @param {State} state
 * @param {DiscardAction} action
 */
export function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.discard_stacks[suitIndex][rank - 1]++;

	// Card is now definitely known to everyone - eliminate
	for (let i = 0; i < state.numPlayers; i++) {
		card_elim(state, i, { suitIndex, rank });
		refresh_links(state, i);
	}

	// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits, { suitIndex, rank }) && state.max_ranks[suitIndex] > rank - 1) {
		state.max_ranks[suitIndex] = rank - 1;
	}

	if (failed) {
		state.strikes++;
	}

	// Bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {DrawAction} action
 */
export function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new Card({
		suitIndex,
		rank,
		order,
		possible: state.all_possible[playerIndex].slice(),
		inferred: state.all_inferred[playerIndex].slice(),
		drawn_index: state.actionList.length
	});
	state.hands[playerIndex].unshift(card);

	// If we know its identity, everyone elims except the player who drew the card
	if (card.identity() !== undefined) {
		for (let i = 0; i < state.numPlayers; i++) {
			if (i !== playerIndex) {
				card_elim(state, i, { suitIndex, rank });
				refresh_links(state, i);
			}
		}
	}

	state.cardOrder = order;
	state.cardsLeft--;

	// suitIndex and rank are -1 if they're your own cards
}

/**
 * @param {State} state
 * @param {PlayAction} action
 */
export function onPlay(state, action) {
	const { order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.play_stacks[suitIndex] = rank;

	// Card is now definitely known to everyone - eliminate
	for (let i = 0; i < state.numPlayers; i++) {
		card_elim(state, i, { suitIndex, rank });
		refresh_links(state, i);
	}

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {number} playerIndex 		The index of the player performing elimination.
 * @param {BasicCard} identity 		The identity to be eliminated.
 * @returns {Card[]}			Any additional recursive eliminations performed.
 */
export function card_elim(state, playerIndex, identity) {
	// Skip if already eliminated
	if (!state.all_possible[playerIndex].some(c => c.matches(identity))) {
		return [];
	}

	const base_count = baseCount(state, identity);
	const certain_cards = visibleFind(state, playerIndex, identity, { infer: [] });
	const total_count = cardCount(state.suits, identity);

	let new_elims = /** @type {Card[]} */ ([]);

	// All cards are known accounted for
	if (base_count + certain_cards.length === total_count) {
		// Remove it from the list of future possibilities (and inferences)
		state.all_possible[playerIndex] = state.all_possible[playerIndex].filter(c => !c.matches(identity));
		state.all_inferred[playerIndex] = state.all_inferred[playerIndex].filter(c => !c.matches(identity));

		for (const card of state.hands[playerIndex]) {
			if (card.possible.length > 1 && !certain_cards.some(c => c.order === card.order)) {
				card.subtract('possible', [identity]);
				card.subtract('inferred', [identity]);

				// Card can be further eliminated
				if (card.inferred.length === 1 || card.possible.length === 1) {
					const identity2 = card.identity({ symmetric: true, infer: true });

					// Do not further eliminate on a rewinded card proven to be a different identity
					if (playerIndex === state.ourPlayerIndex && card.possible.length > 1 && !card.matches(identity2)) {
						continue;
					}

					new_elims.push(identity2);

					for (let i = 0; i < state.numPlayers; i++) {
						const recursive_elims = card_elim(state, i, identity2.raw()).filter(c => !new_elims.some(elim => elim.matches(c)));
						new_elims = new_elims.concat(recursive_elims);
					}
				}
			}
		}
		logger.debug(`removing ${logCard(identity)} from ${state.playerNames[playerIndex]}'s hand and future possibilities`);
	}
	else {
		// Skip if already eliminated
		if (!state.all_inferred[playerIndex].some(c => c.matches(identity))) {
			return [];
		}

		let inferred_cards = visibleFind(state, playerIndex, identity).filter(c =>
			!state.hands[state.ourPlayerIndex].some(card => card.order === c.order && card.rewinded && !card.matches(identity)));
		let focus_elim = false;

		if (base_count + inferred_cards.length >= total_count) {
			if (base_count + inferred_cards.length > total_count) {
				logger.warn(`inferring ${base_count + inferred_cards.length} copies of ${logCard(identity)}`);

				const initial_focus = inferred_cards.filter(card => card.focused);

				// TODO: Check if "base_count + 1 === total_count" is needed?
				if (initial_focus.length === 1) {
					logger.info('eliminating from focus!');
					inferred_cards = initial_focus;
					focus_elim = true;
				}
				else {
					const new_link = { cards: inferred_cards, identities: [identity], promised: false };

					// Don't add duplicates of the same link
					if (!state.links[playerIndex].some(link => Utils.objEquals(link, new_link))) {
						logger.info('adding link', logLinks([new_link]));
						state.links[playerIndex].push(new_link);
					}
				}
			}

			// Remove it from the list of future inferences
			state.all_inferred[playerIndex] = state.all_inferred[playerIndex].filter(c => !c.matches(identity));

			for (const card of state.hands[playerIndex]) {
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
							const recursive_elims = card_elim(state, i, identity2.raw()).filter(c => !new_elims.some(elim => elim.matches(c)));
							new_elims = new_elims.concat(recursive_elims);
						}
					}
				}
			}
			logger.debug(`removing ${logCard(identity)} from ${state.playerNames[playerIndex]}'s hand and future inferences`);
		}
	}
	return new_elims;
}

/**
 * Finds good touch (non-promised) links in the hand.
 * @param {State} state
 * @param {number} playerIndex
 */
export function find_links(state, playerIndex) {
	const hand = state.hands[playerIndex];
	const links = state.links[playerIndex];

	for (const card of hand) {
		// Already in a link, ignore
		if (links.some(({cards}) => cards.some(c => c.order === card.order))) {
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
		const linked_cards = Array.from(hand.filter(c =>
			c.identity() === undefined &&
			card.inferred.length === c.inferred.length &&
			c.inferred.every(inf => card.inferred.some(inf2 => inf2.matches(inf)))
		));

		// We have enough inferred cards to eliminate elsewhere
		// TODO: Sudoku elim from this
		if (linked_cards.length > card.inferred.reduce((sum, inf) => sum += unknownIdentities(state, playerIndex, inf), 0)) {
			logger.info('adding link', linked_cards.map(c => c.order), 'inferences', card.inferred.map(inf => logCard(inf)));

			links.push({ cards: linked_cards, identities: card.inferred.map(c => c.raw()), promised: false });
		}
	}
}

/**
 * Refreshes the array of links based on new information (if any).
 * @param {State} state
 * @param {number} playerIndex
 */
export function refresh_links(state, playerIndex) {
	const links = state.links[playerIndex];

	// Get the link indices that we need to redo (after learning new things about them)
	const redo_elim_indices = links.map(({cards, identities}, index) =>
		// The card is globally known or an identity is no longer possible
		cards.some(c => c.identity({ symmetric: true }) || identities.some(id => !c.possible.some(p => p.matches(id)))) ? index : -1
	).filter(index => index !== -1);

	// Try eliminating all the identities again
	const redo_elim_ids = redo_elim_indices.map(index => links[index].identities).flat();

	// Clear links that we're redoing
	state.links[playerIndex] = links.filter((_, index) => !redo_elim_indices.includes(index));

	for (const id of redo_elim_ids) {
		card_elim(state, playerIndex, id);
	}

	find_links(state, playerIndex);
}
