const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_chop(hand) {
	for (let i = hand.length - 1; i >= 0; i--) {
		if (!hand[i].clued) {
			return i;
		}
	}
	return -1;
}

function find_finesse_pos(hand, already_finessed = 0) {
	for (let i = 0; i < hand.length; i++) {
		const card = hand[i];
		if (!(card.clued || card.finessed)) {
			if (already_finessed === 0) {
				return i;
			}
			else {
				already_finessed--;
			}
		}
	}
	return -1;
}

function determine_focus(hand, list) {
	const chopIndex = find_chop(hand);
	logger.debug('determining focus with chopIndex', chopIndex, 'list', list, 'chopIndex', chopIndex);

	// Chop card exists, check for chop focus
	if (chopIndex !== -1 && list.includes(hand[chopIndex].order)) {
		return { focused_card: hand[chopIndex], chop: true };
	}

	// Check for leftmost newly clued
	for (let i = 0; i < hand.length; i++) {
		if (!hand[i].clued && list.includes(hand[i].order)) {
			return { focused_card: hand[i], chop: false };
		}
	}

	// Check for leftmost re-clued
	for (let i = 0; i < hand.length; i++) {
		if (list.includes(hand[i].order)) {
			return { focused_card: hand[i], chop: false };
		}
	}
}

function bad_touch_num(state, target, cards) {
	let count = 0;
	for (const card of cards) {
		let bad_touch = false;

		const { suitIndex, rank } = card;
		// Play stack is already at that rank or higher
		if (state.play_stacks[suitIndex] >= rank) {
			bad_touch = true;
		}
		// Someone else has the card clued already
		else if (Utils.visibleFind(state, target, suitIndex, rank).some(c => c.clued)) {
			bad_touch = true;
		}
		// Cluing both copies of a card (only include < so we don't double count)
		else if (cards.some(c => Utils.cardMatch(c, suitIndex, rank) && c.order < card.order)) {
			bad_touch = true;
		}
		else {
			// The card is inferred in our hand with high likelihood
			const our_hand = state.hands[state.ourPlayerIndex];

			for (const card of our_hand) {
				if (card.inferred.length < 5 && card.inferred.some(c => Utils.cardMatch(c, suitIndex, rank))) {
					bad_touch = true;
					break;
				}
			}
		}

		if (bad_touch) {
			count++;
		}
	}
	return count;
}

module.exports = { find_chop, find_finesse_pos, determine_focus, bad_touch_num };
