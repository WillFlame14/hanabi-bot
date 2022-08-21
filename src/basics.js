const { Card } = require('./basics/Card.js');
const { find_possibilities, remove_card_from_hand } = require('./basics/helper.js');
const { logger } = require('./logger.js');
const Utils = require('./util.js');

function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.num_suits);

	for (const card of state.hands[target]) {
		if (list.includes(card.order)) {
			card.intersect('possible', new_possible);
			card.intersect('inferred', new_possible);

			if (!card.clued) {
				card.newly_clued = true;
				card.clued = true;
			}
		}
		else {
			card.subtract('possible', new_possible);
			card.subtract('inferred', new_possible);
		}

		card.reasoning.push(state.actionList.length - 1);
		card.reasoning_turn.push(state.turn_count + 1);
	}

	state.clue_tokens--;
}

function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	remove_card_from_hand(state.hands[playerIndex], order);

	state.discard_stacks[suitIndex][rank - 1]++;

	// Discarded all copies of a card
	if (state.discard_stacks[suitIndex][rank - 1] === Utils.CARD_COUNT[rank - 1]) {
		// This card previously wasn't known to be all visible
		if (state.all_possible.some(c => c.matches(suitIndex, rank))) {
			logger.info('Discarded all copies of', Utils.logCard(suitIndex, rank), 'which was previously unknown.');
			for (const hand of state.hands) {
				for (const card of hand) {
					card.subtract('possible', [{suitIndex, rank}]);
					card.subtract('inferred', [{suitIndex, rank}]);
				}
			}
		}
		if (state.max_ranks[suitIndex] > rank - 1) {
			state.max_ranks[suitIndex] = rank - 1;
		}
	}

	// bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new Card(suitIndex, rank, {
		order,
		possible: Utils.objClone(state.all_possible),
		inferred: Utils.objClone(state.all_possible)
	});
	state.hands[playerIndex].unshift(card);

	// We can't see our own cards, but we can see others' at least
	if (playerIndex !== state.ourPlayerIndex) {
		const full_count = state.discard_stacks[suitIndex][rank - 1] +
			Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length +
			(state.play_stacks[suitIndex] >= rank ? 1 : 0);

		// If all copies of a card are already visible (or we have too many copies)
		if (full_count >= Utils.CARD_COUNT[rank - 1]) {
			// Remove it from the list of future possibilities
			state.all_possible = state.all_possible.filter(c => !c.matches(suitIndex, rank));

			// Also remove it from hand possibilities
			for (const card of state.hands[state.ourPlayerIndex]) {
				// Do not remove it from itself (unless it's critical)
				if (!Utils.isCritical(state, suitIndex, rank) &&
					(card.possible.length === 1 || (card.inferred.length === 1 && card.inferred[0].matches(suitIndex, rank)))) {
					continue;
				}
				card.subtract('possible', [{suitIndex, rank}]);
				card.subtract('inferred', [{suitIndex, rank}]);
			}
			logger.debug(`removing ${card.toString()} from hand and future possibilities`);
		}
	}

	state.cards_left--;

	// suitIndex and rank are -1 if they're your own cards
}

module.exports = {
	onClue,
	onDiscard,
	onDraw
};
