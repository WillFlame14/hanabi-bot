const { CLUE } = require('../../constants.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { getPace, isBasicTrash, isSaved } = require('../../basics/hanabi-util.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_chop(hand, options = {}) {
	for (let i = hand.length - 1; i >= 0; i--) {
		const { clued, newly_clued, chop_moved } = hand[i];
		if (chop_moved || (clued && (options.includeNew ? true : !newly_clued))) {
			continue;
		}
		return i;
	}
	return -1;
}

function find_prompt(hand, suitIndex, rank, suits, ignoreOrders = []) {
	for (const card of hand) {
		const { clued, newly_clued, order, possible, clues } = card;
		// Ignore unclued, newly clued, and known cards (also intentionally ignored cards)
		if (!clued || newly_clued || possible.length === 1 || ignoreOrders.includes(order)) {
			continue;
		}

		// Ignore cards that don't match the inference
		if (!possible.some(p => p.matches(suitIndex, rank))) {
			continue;
		}


		// A clue must match the card (or rainbow/omni connect)
		if (clues.some(clue =>
			(clue.type === CLUE.COLOUR && (clue.value === suitIndex || ['Rainbow', 'Omni'].includes(suits[suitIndex]))) ||
			(clue.type === CLUE.RANK && clue.value === rank))
		) {
			return card;
		}
	}
	return;
}

function find_finesse(hand, suitIndex, rank, ignoreOrders = []) {
	for (const card of hand) {
		// Ignore clued and finessed cards (also intentionally ignored cards)
		if (card.clued || card.finessed || ignoreOrders.includes(card.order)) {
			continue;
		}

		// Ignore cards that don't match the inference
		if (!card.inferred.some(p => p.matches(suitIndex, rank))) {
			continue;
		}

		return card;
	}
	return;
}

function determine_focus(hand, list, options = {}) {
	const chopIndex = find_chop(hand);
	logger.debug('determining focus with chopIndex', chopIndex, 'list', list, 'hand', Utils.logHand(hand));

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
}

function find_bad_touch(state, cards) {
	let bad_touch_cards = [];
	for (const card of cards) {
		let bad_touch = false;

		const { suitIndex, rank } = card;
		// Card is either already played or can never be played
		if (isBasicTrash(state, suitIndex, rank)) {
			bad_touch = true;
		}
		// Someone else has the card finessed, clued or chop moved already
		else if (isSaved(state, state.ourPlayerIndex, suitIndex, rank, card.order)) {
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

function stall_severity(state, giver) {
	if (state.clue_tokens === 7 && state.turn_count !== 0) {
		return 4;
	}
	if (state.hands[giver].isLocked()) {
		if (find_playables(state.play_stacks, state.hands[giver]).length > 0 ||
			find_known_trash(state, giver).length > 0) {
			return 0;
		}
		return 3;
	}
	if (state.early_game) {
		return 1;
	}
	return 0;
}

function inEndgame(state) {
	return getPace(state) < state.numPlayers;
}

module.exports = { find_chop, find_prompt, find_finesse, determine_focus, find_bad_touch, stall_severity, inEndgame };
