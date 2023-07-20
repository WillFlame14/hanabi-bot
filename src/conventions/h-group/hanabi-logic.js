import { getPace, isTrash } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logHand } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../h-hand.js').HGroup_Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 */

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
	const chopIndex = hand.chopIndex();
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
	if (state.clue_tokens === 8 && state.turn_count !== 1) {
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
