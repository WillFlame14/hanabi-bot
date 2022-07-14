const { good_touch_elim, remove_card_from_hand, update_hypo_stacks } = require('./basics.js');
const Utils = require('./util.js');

function handle_action(state, action, tableID, catchup = false) {
	const save_state = Utils.objClone(state);
	// Avoid storing unnecessary and recursive structures
	save_state.actionList = undefined;
	save_state.history = undefined;

	state.history.push(save_state);
	state.actionList.push(action);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			state.interpret_clue(state, action);

			state.clue_tokens--;
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { failed, order, playerIndex, rank, suitIndex } = action;
			remove_card_from_hand(state.hands[playerIndex], order);

			state.discard_stacks[suitIndex][rank - 1]++;

			// Discarded all copies of a card
			if (state.discard_stacks[suitIndex][rank - 1] === Utils.CARD_COUNT[rank - 1]) {
				// This card previously wasn't known to be all visible
				if (state.all_possible.some(c => Utils.cardMatch(c, suitIndex, rank))) {
					console.log('Discarded all copies of', Utils.cardToString(action), 'which was previously unknown.');
					for (const hand of state.hands) {
						for (const card of hand) {
							card.possible = Utils.subtractCards(card.possible, [{suitIndex, rank}]);
							card.inferred = Utils.subtractCards(card.inferred, [{suitIndex, rank}]);
						}
					}
				}
				if (state.max_ranks[suitIndex] > rank - 1) {
					state.max_ranks[suitIndex] = rank - 1;
				}
			}

			// Discarding a useful card (for whatever reason)
			if (state.hypo_stacks[suitIndex] >= rank && state.play_stacks[suitIndex] < rank) {
				const duplicates = Utils.visibleFind(state, playerIndex, suitIndex, rank);

				// Mistake discard or sarcastic discard (but unknown transfer location)
				if (duplicates.length === 0 || duplicates[0].inferred.length > 1) {
					console.log(`${state.playerNames[playerIndex]} discarded useful card ${Utils.cardToString(action)}, setting hypo stack ${rank - 1}`);
					state.hypo_stacks[suitIndex] = rank - 1;
				}
			}

			// bombs count as discards, but they don't give a clue token
			if (!failed && state.clue_tokens < 8) {
				state.clue_tokens++;
			}
			break;
		}
		case 'draw': {
			// { type: 'draw', playerIndex: 0, order: 2, suitIndex: 1, rank: 2 },
			const { order, playerIndex, suitIndex, rank } = action;
			state.hands[playerIndex].unshift({
				order, suitIndex, rank,
				clued: false,
				newly_clued: false,
				finessed: false,
				possible: Utils.objClone(state.all_possible),
				inferred: Utils.objClone(state.all_possible),
				waiting_finesse_players: [],
				reasoning: []
			});

			// We can't see our own cards, but we can see others' at least
			if (playerIndex !== state.ourPlayerIndex) {
				const full_count = state.discard_stacks[suitIndex][rank - 1] +
					Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length +
					(state.play_stacks[suitIndex] >= rank ? 1 : 0);

				// If all copies of a card are already visible
				if (full_count === Utils.CARD_COUNT[rank - 1]) {
					// Remove it from the list of future possibilities
					state.all_possible = state.all_possible.filter(c => !Utils.cardMatch(c, suitIndex, rank));

					// Also remove it from hand possibilities
					for (const card of state.hands[state.ourPlayerIndex]) {
						// Do not remove it from itself
						if (card.possible.length === 1 || (card.inferred.length === 1 && Utils.cardMatch(card.inferred[0], suitIndex, rank))) {
							continue;
						}
						card.possible = Utils.subtractCards(card.possible, [{ suitIndex, rank }]);
						card.inferred = Utils.subtractCards(card.inferred, [{ suitIndex, rank }]);
					}
					console.log(`removing ${Utils.cardToString({suitIndex, rank})} from hand and future possibilities`);
				}
			}

			state.cards_left--;

			// suitIndex and rank are -1 if they're your own cards
			break;
		}
		case 'gameOver':
			Utils.sendCmd('tableUnattend', { tableID });
			break;
		case 'turn':
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			if (action.currentPlayerIndex === state.ourPlayerIndex && !catchup) {
				setTimeout(() => state.take_action(state, tableID), 2000);

				// Update notes on cards
				for (const card of state.hands[state.ourPlayerIndex]) {
					if (card.inferred.length < 5) {
						setTimeout(() => Utils.writeNote(card, tableID), Math.random() * 5000);
					}
				}
			}
			break;
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			remove_card_from_hand(state.hands[playerIndex], order);

			state.play_stacks[suitIndex] = rank;

			// Apply good touch principle on remaining possibilities
			for (const hand of state.hands) {
				good_touch_elim(hand, [{suitIndex, rank}]);
			}

			// Update hypo stacks
			console.log('updating hypo stack (play)');
			update_hypo_stacks(state, playerIndex, suitIndex, rank);

			// Get a clue token back for playing a 5
			if (rank === 5 && state.clue_tokens < 8) {
				state.clue_tokens++;
			}
			// console.log('suit', suitIndex, 'now has play stack', state.play_stacks[suitIndex]);
			break;
		}
		default:
			break;
	}
}

module.exports = { handle_action };
