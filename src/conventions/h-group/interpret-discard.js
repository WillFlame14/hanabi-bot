const { Card } = require('../../basics/Card.js');
const { find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_sarcastic(hand, suitIndex, rank) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = Utils.handFindInfer(hand, suitIndex, rank);
	if (known_sarcastic.length > 0) {
		return known_sarcastic;
	}
	// Otherwise, find all cards that could match that identity
	return hand.filter(c => c.clued && c.possible.some(p => p.matches(suitIndex, rank)));
}

function undo_hypo_stacks(state, playerIndex, suitIndex, rank) {
	logger.info(`${state.playerNames[playerIndex]} discarded useful card ${Utils.logCard(suitIndex, rank)}, setting hypo stack ${rank - 1}`);
	if (state.hypo_stacks[suitIndex] >= rank) {
		state.hypo_stacks[suitIndex] = rank - 1;
	}
}

function apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const s of sarcastic) {
		s.union('inferred', [new Card(suitIndex, rank)]);
	}

	const playable = (card) => {
		return card.inferred.every(c => Utils.playableAway(state, c.suitIndex, c.rank) === 0);
	}

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(s => !playable(s))) {
		undo_hypo_stacks(state, playerIndex, suitIndex, rank);
	}
}

function interpret_discard(state, action, card, tableID) {
	const { order, playerIndex, rank, suitIndex } = action;

	const trash = find_known_trash(state, playerIndex);
	// Early game and discard wasn't known trash or misplay, so end early game
	if (state.early_game && !trash.some(c => c.matches(suitIndex, rank)) && !action.failed) {
		state.early_game = false;
	}

	// If the card doesn't match any of our inferences, rewind to the reasoning and adjust
	if (!card.rewinded && !card.matches_inferences()) {
		logger.info('all inferences', card.inferred.map(c => c.toString()));
		state.rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, true, tableID);
		return;
	}

	// Discarding a useful card
	if (state.hypo_stacks[suitIndex] >= rank && state.play_stacks[suitIndex] < rank) {
		const duplicates = Utils.visibleFind(state, playerIndex, suitIndex, rank);

		// Card was bombed
		if (action.failed) {
			undo_hypo_stacks(state, playerIndex, suitIndex, rank);
		}
		else {
			// Sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], suitIndex, rank);

				if (sarcastic.length === 1) {
					sarcastic[0].inferred = [new Card(suitIndex, rank)];
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
				}
			}
			// Sarcastic discard to other
			else {
				for (let i = 1; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], suitIndex, rank);

					if (sarcastic.some(c => c.matches(suitIndex, rank))) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							sarcastic[0].inferred = [new Card(suitIndex, rank)];
							logger.info(`writing ${Utils.logCard(suitIndex, rank)} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
							logger.info('unknown sarcastic');
						}
						break;
					}
				}
			}
		}
	}
}

module.exports = { interpret_discard };
