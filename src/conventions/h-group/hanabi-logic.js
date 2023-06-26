import { CLUE } from '../../constants.js';
import { getPace, isTrash } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logHand } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 */

/**
 * Returns the index (0-indexed) of the chop card in the given hand.
 * 
 * The 'afterClue' option can be set to true to find chop after a clue.
 * Otherwise, the default behaviour finds chop which could be a newly clued card.
 * @param {Hand} hand
 * @param {{afterClue?: boolean}} options
 * @returns The index of the chop card, or -1 if the hand doesn't have a chop.
 */
export function find_chop(hand, options = {}) {
	for (let i = hand.length - 1; i >= 0; i--) {
		const { clued, newly_clued, chop_moved } = hand[i];
		if (chop_moved || (clued && (options.afterClue ? true : !newly_clued))) {
			continue;
		}
		return i;
	}
	return -1;
}

/**
 * Finds a prompt in the hand for the given suitIndex and rank.
 * @param {Hand} hand
 * @param {number} suitIndex
 * @param {number} rank
 * @param {string[]} suits 			All suits in the current game.
 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
 * @returns {Card}					The prompted card, or undefined if no card is a valid prompt.
 */
export function find_prompt(hand, suitIndex, rank, suits, ignoreOrders = []) {
	return hand.find(card => {
		const { clued, newly_clued, order, inferred, possible, clues } = card;
		// Ignore unclued, newly clued, and known cards (also intentionally ignored cards)
		if (!clued || newly_clued || possible.length === 1 || ignoreOrders.includes(order)) {
			return false;
		}

		// Ignore cards that don't match the inference
		if (!possible.some(p => p.matches(suitIndex, rank))) {
			return false;
		}

		// Ignore cards that don't match and have information lock
		if (inferred.length === 1 && !(inferred[0].suitIndex === suitIndex && inferred[0].rank === rank)) {
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
 * Finds a finesse in the hand for the given suitIndex and rank.
 * @param {Hand} hand
 * @param {number[]} ignoreOrders 	Orders of cards to ignore when searching.
 * @returns {Card}		The card on finesse position, or undefined if there is none.
 */
export function find_finesse(hand, ignoreOrders = []) {
	return hand.find(card => !card.clued && !card.finessed && !ignoreOrders.includes(card.order));
}

/**
 * Finds the focused card and whether it was on chop before the clue.
 * 
 * The 'beforeClue' option is needed if this is called before the clue has been interpreted
 * to prevent focusing a previously clued card.
 * @param {Hand} hand
 * @param {number[]} list 	The orders of all cards that were just clued.
 * @param {{beforeClue?: boolean}} options
 */
export function determine_focus(hand, list, options = {}) {
	const chopIndex = find_chop(hand);
	logger.debug('determining focus with chopIndex', chopIndex, 'list', list, 'hand', logHand(hand));

	// Chop card exists, check for chop focus
	if (chopIndex !== -1 && list.includes(hand[chopIndex].order)) {
		return { focused_card: hand[chopIndex], chop: true };
	}

	// Check for leftmost newly clued
	for (const card of hand) {
		if ((options.beforeClue ? !card.clued : card.newly_clued) && list.includes(card.order)) {
			return { focused_card: card, chop: false };
		}
	}

	// Check for leftmost chop moved
	for (const card of hand) {
		if (card.chop_moved && list.includes(card.order)) {
			return { focused_card: card, chop: false };
		}
	}

	// Check for leftmost re-clued
	for (const card of hand) {
		if (list.includes(card.order)) {
			return { focused_card: card, chop: false };
		}
	}

	console.log('list', list, 'hand', logHand(hand));
	throw new Error('No focus found!');
}

/**
 * Returns all cards that would be bad touch if clued. In the case of duplicates, both will be returned.
 * @param {State} state
 * @param {Card[]} cards
 */
export function find_bad_touch(state, cards, focusedCardOrder = -1) {
	/** @type {Card[]} */
	const bad_touch_cards = [];

	for (const card of cards) {
		let bad_touch = false;

		// Assume focused card cannot be bad touched
		if (card.order === focusedCardOrder) {
			continue;
		}

		const { suitIndex, rank } = card;
		// Card has already been played or can never be played
		// Or someone else has the card finessed, clued or chop moved already
		if (isTrash(state, state.ourPlayerIndex, suitIndex, rank, card.order)) {
			bad_touch = true;
		}
		// Cluing both copies of a card (will return both as bad touch)
		else if (cards.some(c => c.matches(suitIndex, rank) && c.order !== card.order)) {
			bad_touch = true;
		}
		else {
			// The card is inferred in our hand with high likelihood
			const our_hand = state.hands[state.ourPlayerIndex];

			for (const card of our_hand) {
				if (card.inferred.length <= 2 && card.inferred.some(c => c.matches(suitIndex, rank))) {
					bad_touch = true;
					break;
				}
			}
		}

		if (bad_touch) {
			bad_touch_cards.push(card);
		}
	}
	return bad_touch_cards;
}

/**
 * Returns the current stall severity for the giver. [None, Early game, DDA/SDCM, Locked hand, 8 clues]
 * @param {State} state
 * @param {number} giver
 */
export function stall_severity(state, giver) {
	if (state.clue_tokens === 7 && state.turn_count !== 1) {
		return 4;
	}
	if (state.hands[giver].isLocked()) {
		return 3;
	}
	if (inEndgame(state)) {
		return 1.5;
	}
	if (state.early_game) {
		return 1;
	}
	return 0;
}

/**
 * Returns whether the state is in the endgame.
 * @param {State} state
 */
export function inEndgame(state) {
	return getPace(state) < state.numPlayers;
}

/**
 * Returns the current minimum clue value.
 * @param  {State} state
 * @return {number}
 */
export function minimum_clue_value(state) {
	// -0.5 if 2 players (allows tempo clues to be given)
	// -10 if endgame
	return 1 - (state.numPlayers === 2 ? 0.5 : 0) - (inEndgame(state) ? 10 : 0);
}
