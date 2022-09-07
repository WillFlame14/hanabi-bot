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

			// Remove it from the list of future possibilities
			state.all_possible = state.all_possible.filter(c => !c.matches(suitIndex, rank));

			// Remove it from everyone's hands
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

	if (playerIndex === state.ourPlayerIndex) {
		card_elim(state, suitIndex, rank);
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
		card_elim(state, suitIndex, rank);
	}

	state.cards_left--;

	// suitIndex and rank are -1 if they're your own cards
}

function card_elim(state, suitIndex, rank) {
	const full_count = state.discard_stacks[suitIndex][rank - 1] +
		Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length +
		(state.play_stacks[suitIndex] >= rank ? 1 : 0);

	// If all copies of a card are already visible (or we have too many copies)
	if (full_count >= Utils.CARD_COUNT[rank - 1] && state.all_possible.some(c => c.matches(suitIndex, rank))) {
		// Remove it from the list of future possibilities
		state.all_possible = state.all_possible.filter(c => !c.matches(suitIndex, rank));

		// Everyone other than the ones holding the cards can elim
		for (let i = 0; i < state.numPlayers; i++) {
			const hand = state.hands[i];
			const matching_cards = hand.filter(c => {
				if (i === state.ourPlayerIndex) {
					return (c.possible.length === 1 && c.possible[0].matches(suitIndex, rank)) ||
					(c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank));
				}
				else {
					return c.matches(suitIndex, rank);
				}
			});

			if (matching_cards.length > 0) {
				// The matching cards (possibly only 1 in hand) are known
				if (matching_cards.every(c => c.possible.length === 1 ||
					(c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank)))
				) {
					// Elim on all the other cards in hand
					for (const card of hand) {
						if (matching_cards.some(c => c.order === card.order)) {
							continue;
						}

						// Only elim from possible if 100% sure
						if (matching_cards.every(c => c.possible.length === 1)) {
							card.subtract('possible', [{suitIndex, rank}]);
						}
						card.subtract('inferred', [{suitIndex, rank}]);
					}
				}
				continue;
			}

			for (const card of hand) {
				card.subtract('possible', [{suitIndex, rank}]);
				card.subtract('inferred', [{suitIndex, rank}]);
			}
		}

		logger.debug(`removing ${Utils.logCard(suitIndex, rank)} from hand and future possibilities`);
	}
}

module.exports = {
	onClue,
	onDiscard,
	onDraw
};
