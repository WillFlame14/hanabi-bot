const { find_chop, determine_focus, good_touch_elim } = require('./hanabi-logic.js');
const { remove_card_from_hand } = require('./action-helper.js');
const { take_action } = require('./take-action.js');
const Utils = require('./util.js');

const CLUE = { COLOUR: 0, NUMBER: 1 };

function handle_action(state, action, tableID, catchup = false) {
	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { clue, giver, list, target } = action;

			// First, should update all basic positive & negative possiblilities of other cards and update hypo stacks
			const new_possible = [];
			const bad_touch = [];
			if (clue.type === CLUE.COLOUR) {
				const suitIndex = clue.value;

				for (let rank = 1; rank <= 5; rank++) {
					new_possible.push({ suitIndex, rank });

					if (rank <= state.play_stacks[suitIndex]) {
						bad_touch.push({ suitIndex, rank });
					}
				}
			}
			else {
				const rank = clue.value;
				for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
					new_possible.push({ suitIndex, rank });

					if (state.play_stacks[suitIndex] >= rank) {
						bad_touch.push({ suitIndex, rank });
					}
				}
			}

			for (const card of state.hands[target]) {
				if (list.includes(card.order)) {
					card.possible = Utils.intersectCards(card.possible, new_possible);
					card.inferred = Utils.intersectCards(card.inferred, new_possible);

					// Clued cards should also obey good touch principle
					// TODO: Subtract clued cards in other hands (use hypo stacks?)
					card.inferred = Utils.subtractCards(card.possible, bad_touch);
				}
				else {
					// Unclued cards don't have to obey good touch principle
					card.possible = Utils.subtractCards(card.possible, new_possible);
					card.inferred = Utils.subtractCards(card.inferred, new_possible);
				}
			}

			// Someone telling us about our hand
			// TODO: look for all completely filled-in cards and remove them from possibilities
			// if (target === state.ourPlayerIndex) {
				const { focused_card, chop } = determine_focus(state.hands[target], list);
				// console.log('focused_card', focused_card, 'chop?', chop);

				// Try to determine all the possible inferences of the card
				if (focused_card.possible.length > 1) {
					const focus_possible = [];

					if (clue.type === CLUE.COLOUR) {
						const suitIndex = clue.value;
						const current_stack_rank = state.play_stacks[suitIndex];	// TODO: Should use hypo stacks instead of play stacks

						// Play clue
						// TODO: need to check for other clued cards in other hands (hypo stacks should fix this)
						// TODO: need to check for filled in cards at the same time
						// TODO: look for 1-away finesse
						focus_possible.push({ suitIndex, rank: current_stack_rank + 1 });

						// Save clue on chop (5 save cannot be done with number)
						if (chop) {
							for (let rank = current_stack_rank + 2; rank < 5; rank++) {
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
					console.log('final inference on focused card', focused_card.inferred.map(c => Utils.cardToString(c)));
				}

				// Focused card only has one possible inference, so remove that possibility from other clued cards via good touch principle
				// TODO: maybe modify if focused card is unplayable now but has rank high enough
				if (focused_card.inferred.length === 1) {
					const other_cards = state.hands[target].filter(c => c.order !== focused_card.order);
					good_touch_elim(other_cards, focused_card.inferred);
				}
				console.log('hand state after clue', Utils.logHand(state.hands[target]));
			// }
			// else {
			// 	// TODO: Maintain theory of mind (i.e. keep track of what other players know about their hands)
			// }

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
				console.log('full count of', full_count);
				console.log(state.discard_stacks[suitIndex][rank - 1]);
				console.log(Utils.visibleFind(state.hands, suitIndex, rank).length);
				console.log(state.play_stacks[suitIndex] >= rank ? 1 : 0);

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