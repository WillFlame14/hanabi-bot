const Utils = require('./util.js');

function find_chop(hand) {
	let chop = -1;
	for (let i = hand.length - 1; i >= 0; i--) {
		if (!hand[i].clued) {
			return i;
		}
	}
	return -1;
}

function determine_focus(hand, list) {
	const chopIndex = find_chop(hand);
	// console.log('determining focus with chopIndex', chopIndex, 'list', list, 'chop card', hand[chopIndex]);

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

function good_touch_elim(hand, cards) {
	for (const card of hand) {
		if (card.clued) {
			card.inferred = Utils.subtractCards(card.inferred, cards);
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

module.exports = { find_chop, determine_focus, good_touch_elim, bad_touch_num };
