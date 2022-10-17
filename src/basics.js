const { CARD_COUNT } = require('./constants.js');
const { Card } = require('./basics/Card.js');
const { find_possibilities } = require('./basics/helper.js');
const { logger } = require('./logger.js');
const { visibleFind } = require('./basics/hanabi-util.js');
const Utils = require('./util.js');

function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.suits);

	for (const card of state.hands[target]) {
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
				card.reasoning_turn.push(state.turn_count + 1);
			}
		}
		else {
			card.subtract('possible', new_possible);
			card.subtract('inferred', new_possible);
		}

		// Eliminate in own hand (no one has eliminated this card yet since we just learned about it)
		if (card.possible.length === 1) {
			card_elim(state, card.possible[0].suitIndex, card.possible[0].rank);
		}
	}

	state.clue_tokens--;
}

function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.discard_stacks[suitIndex][rank - 1]++;
	card_elim(state, suitIndex, rank);

	// Discarded all copies of a card
	if (state.discard_stacks[suitIndex][rank - 1] === CARD_COUNT[rank - 1] && state.max_ranks[suitIndex] > rank - 1) {
		state.max_ranks[suitIndex] = rank - 1;
	}

	// Bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new Card(suitIndex, rank, {
		order,
		possible: Utils.objClone(state.all_possible[playerIndex]),
		inferred: Utils.objClone(state.all_possible[playerIndex])
	});
	state.hands[playerIndex].unshift(card);

	// Don't eliminate if we drew the card (since we don't know what it is)
	if (playerIndex !== state.ourPlayerIndex) {
		card_elim(state, suitIndex, rank, [playerIndex]);
	}

	state.cards_left--;

	// suitIndex and rank are -1 if they're your own cards
}

function card_elim(state, suitIndex, rank, ignorePlayerIndexes = []) {
	for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
		if (ignorePlayerIndexes.includes(playerIndex)) {
			continue;
		}

		// Skip if already eliminated
		if (!state.all_possible[playerIndex].some(c => c.matches(suitIndex, rank))) {
			continue;
		}

		const base_count = state.discard_stacks[suitIndex][rank - 1] + (state.play_stacks[suitIndex] >= rank ? 1 : 0);
		const certain_count = base_count + visibleFind(state, playerIndex, suitIndex, rank, { infer: false }).length;
		const inferred_count = base_count + visibleFind(state, playerIndex, suitIndex, rank).length;

		// Note that inferred_count >= certain_count.
		// If all copies of a card are already visible (or there exist too many copies)
		if (inferred_count >= CARD_COUNT[rank - 1]) {
			// Remove it from the list of future possibilities
			state.all_possible[playerIndex] = state.all_possible[playerIndex].filter(c => !c.matches(suitIndex, rank));

			for (const card of state.hands[playerIndex]) {
				// All cards are known accounted for, so eliminate on all cards that are not known
				if (certain_count === CARD_COUNT[rank - 1]) {
					if (!card.matches(suitIndex, rank, { symmetric: true })) {
						card.subtract('possible', [{suitIndex, rank}]);
						card.subtract('inferred', [{suitIndex, rank}]);
					}
				}
				// All cards are inferred accounted for, so eliminate on all cards that are not inferred
				else if (inferred_count === CARD_COUNT[rank - 1]) {
					if (!card.matches(suitIndex, rank, { symmetric: true, infer: true })) {
						card.subtract('inferred', [{suitIndex, rank}]);
					}
				}
				// There is an extra inference somewhere, and not enough known cards
				else if (inferred_count > CARD_COUNT[rank - 1]) {
					logger.error(`inferred ${inferred_count} copies of ${Utils.logCard({suitIndex, rank})}`);
					// TODO: There was a lie somewhere, waiting for fix? Or can deduce from focus?
					break;
				}
			}
			logger.debug(`removing ${Utils.logCard({suitIndex, rank})} from ${state.playerNames[playerIndex]}'s hand and future possibilities`);
		}
	}
}

module.exports = {
	onClue,
	onDiscard,
	onDraw
};
