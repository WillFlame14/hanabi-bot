const { determine_focus, good_touch_elim } = require('./hanabi-logic.js');
const { CLUE, find_possibilities, find_bad_touch, remove_card_from_hand } = require('./action-helper.js');
const { take_action } = require('./take-action.js');
const Utils = require('./util.js');

function handle_action(state, action, tableID, catchup = false) {
	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { clue, giver, list, target } = action;

			// Update all positive and negative possibilities for all cards, first ignoring good touch
			const new_possible = find_possibilities(clue, state.num_suits);

			for (const card of state.hands[target]) {
				if (list.includes(card.order)) {
					card.possible = Utils.intersectCards(card.possible, new_possible);
					card.inferred = Utils.intersectCards(card.inferred, new_possible);
				}
				else {
					// Untouched cards don't have to obey good touch principle
					card.possible = Utils.subtractCards(card.possible, new_possible);
					card.inferred = Utils.subtractCards(card.inferred, new_possible);
				}
			}

			// Touched cards should also obey good touch principle
			// FIX: Need to do this in a loop to recursively deduce information
			const bad_touch = find_bad_touch(state, giver);
			for (const card of state.hands[target]) {
				if (list.includes(card.order)) {
					card.inferred = Utils.subtractCards(card.inferred, bad_touch);
				}
			}

			const { focused_card, chop } = determine_focus(state.hands[target], list);
			// console.log('focused_card', focused_card, 'chop?', chop);

			// Try to determine all the possible inferences of the card
			if (focused_card.possible.length > 1) {
				const focus_possible = [];

				if (clue.type === CLUE.COLOUR) {
					const suitIndex = clue.value;
					let next_playable_rank = state.play_stacks[suitIndex];
					let connecting = true;

					// Play clue
					// TODO: look for 1-away finesse
					while (connecting) {
						next_playable_rank++;
						connecting = false;

						for (let i = 0; i < state.numPlayers; i++) {
							const hand = state.hands[i];

							// Looking through our hand or the giver's hand
							if (i === state.ourPlayerIndex || i === giver) {
								connecting = hand.some(card => card.clued &&
									(card.possible.length === 1 && Utils.cardMatch(card.possible[0], suitIndex, next_playable_rank)) ||
									(card.inferred.length === 1 && Utils.cardMatch(card.inferred[0], suitIndex, next_playable_rank))
								);
							}
							// Looking through another player's hand
							else {
								connecting = Utils.handFind(hand, suitIndex, next_playable_rank).some(c => c.clued);
							}

							if (connecting) {
								break;
							}
						}
					}
					focus_possible.push({ suitIndex, rank: next_playable_rank });

					// Save clue on chop (5 save cannot be done with number)
					if (chop) {
						for (let rank = next_playable_rank + 1; rank < 5; rank++) {
							// Check if card is critical and not visible in anyone's hand
							if (Utils.isCritical(state, suitIndex, rank)) {
								focus_possible.push({ suitIndex, rank });
							}
						}
					}
				}
				else {
					const rank = clue.value;

					// Play clue
					for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
						// TODO: need to check for other clued cards in other hands (hypo stacks should fix this)
						// TODO: look for 1-away finesse
						const stack_rank = state.play_stacks[suitIndex];
						if (rank === stack_rank + 1) {
							focus_possible.push({ suitIndex, rank });
						}
					}

					// Save clue on chop
					if (chop) {
						for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
							let save2 = false;

							// Determine if it's a 2 save
							if (rank === 2 && state.play_stacks[suitIndex] + 1 !== rank) {
								const duplicates = Utils.visibleFind(state.hands, suitIndex, rank);

								// No duplicates found, so can be a 2 save
								if (duplicates.length === 0) {
									save2 = true;
								}
								// Both duplicates found, so can't be a 2 save
								else if (duplicates.length === 2) {
									continue;
								}
								else {
									// Can be a 2 save if the other 2 is in the giver's hand
									save2 = state.hands[giver].some(c => c.order === duplicates[0].order);
								}
							}

							if ((Utils.isCritical(state, suitIndex, rank) && state.play_stacks[suitIndex] + 1 !== rank) || save2) {
								focus_possible.push({ suitIndex, rank });
							}
						}
					}
				}
				// console.log('focus_possible', focus_possible);
				focused_card.inferred = Utils.intersectCards(focused_card.inferred, focus_possible);
				console.log('final inference on focused card', focused_card.inferred.map(c => Utils.cardToString(c)).join(','));
			}

			// Focused card only has one possible inference, so remove that possibility from other clued cards via good touch principle
			// TODO: maybe modify if focused card is unplayable now but has rank high enough
			if (focused_card.inferred.length === 1) {
				const other_cards = state.hands[target].filter(c => c.order !== focused_card.order);
				good_touch_elim(other_cards, focused_card.inferred);
			}
			console.log('hand state after clue', Utils.logHand(state.hands[target]));

			// Going through each card that was clued
			for (const order of list) {
				const card = Utils.findOrder(state.hands[target], order);
				card.clued = true;
			}

			state.clue_tokens--;
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { failed, order, playerIndex, rank, suitIndex } = action;
			remove_card_from_hand(state.hands[playerIndex], order);

			state.discard_stacks[suitIndex][rank - 1]++;
			// console.log('suit', suitIndex, 'now has discard stack', state.discard_stacks[suitIndex]);

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
			}

			// bombs count as discards, but they don't give a clue token
			if (!failed) {
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
				possible: Utils.objClone(state.all_possible),
				inferred: Utils.objClone(state.all_possible)}
			);

			// We can't see our own cards, but we can see others' at least
			if (playerIndex !== state.ourPlayerIndex) {
				const full_count = state.discard_stacks[suitIndex][rank - 1] +
					Utils.visibleFind(state.hands, suitIndex, rank).length +
					(state.play_stacks[suitIndex] >= rank ? 1 : 0);
				// console.log('full count of', full_count);

				// If all copies of a card are already visible
				if (full_count === Utils.CARD_COUNT[rank - 1]) {
					// Remove it from the list of future possibilities
					state.all_possible = state.all_possible.filter(c => !Utils.cardMatch(c, suitIndex, rank));

					// Also remove it from hand possibilities
					for (const card of state.hands[state.ourPlayerIndex]) {
						card.possible = Utils.subtractCards(card.possible, [{ suitIndex, rank }]);
						card.inferred = Utils.subtractCards(card.inferred, [{ suitIndex, rank }]);
					}
					console.log(`removing suitIndex ${suitIndex} and rank ${rank} from hand and future possibilities`);
				}
			}

			// suitIndex and rank are -1 if they're your own cards
			break;
		}
		case 'gameOver':
			Utils.sendCmd('tableUnattend', { tableID });
			break;
		case 'turn':
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			if (action.currentPlayerIndex === state.ourPlayerIndex && !catchup) {
				setTimeout(() => take_action(state, tableID), 2000);

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

			// Get a clue token back for playing a 5
			if (rank === 5) {
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
