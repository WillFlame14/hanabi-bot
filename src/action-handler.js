const { find_finesse_pos, determine_focus, good_touch_elim } = require('./hanabi-logic.js');
const { CLUE, find_possibilities, find_bad_touch, find_connecting, remove_card_from_hand } = require('./action-helper.js');
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
			const bad_touch = find_bad_touch(state, giver, target);
			for (const card of state.hands[target]) {
				if (card.inferred.length > 1 && (card.clued || list.includes(card.order))) {
					card.inferred = Utils.subtractCards(card.inferred, bad_touch);
				}
			}

			const { focused_card, chop } = determine_focus(state.hands[target], list);
			// console.log('focused_card', focused_card, 'chop?', chop);

			// Try to determine all the possible inferences of the card
			if (focused_card.inferred.length > 1) {
				let save = false;
				const focus_possible = [];
				console.log('hypo stacks in clue interpretation:', state.hypo_stacks);

				if (clue.type === CLUE.COLOUR) {
					const suitIndex = clue.value;
					let next_playable_rank = state.hypo_stacks[suitIndex] + 1;
					//console.log('determining if play clue. suitIndex:', suitIndex, 'play:', state.play_stacks[suitIndex], 'hypo:', state.hypo_stacks[suitIndex]);

					// Play clue
					focus_possible.push({ suitIndex, rank: next_playable_rank });

					// Try looking for a connecting card
					let connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);
					let found_connecting = false;

					while (connecting !== undefined) {
						found_connecting = true;
						// TODO: Use the reacting person to see if they do something urgent instead of playing into finesse
						const { type, reacting, card } = connecting;

						if (type === 'prompt' || type === 'known') {
							state.hypo_stacks[suitIndex]++;
						}
						else if (type === 'finesse') {
							focused_card.waiting_finesse_players.push(reacting);
							card.finessed = true;

							// Even if a finesse is possible, it might not be a finesse
							focus_possible.push({ suitIndex, rank: next_playable_rank });
						}

						next_playable_rank++;
						connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);
					}

					// Our card could be the final rank that we can't find
					if (found_connecting) {
						focus_possible.push({ suitIndex, rank: next_playable_rank });
					}

					// Include our card on hypo stacks so we can give selfish clues
					// state.hypo_stacks[suitIndex]++;

					// Save clue on chop (5 save cannot be done with number)
					if (chop) {
						for (let rank = next_playable_rank + 1; rank < 5; rank++) {
							// Check if card is critical and not visible in anyone's hand
							if (Utils.isCritical(state, suitIndex, rank)) {
								focus_possible.push({ suitIndex, rank });
								save = true;
							}
						}
					}
				}
				else {
					const rank = clue.value;

					// Play clue
					for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
						let stack_rank = state.hypo_stacks[suitIndex] + 1;

						//console.log('determining if play clue. suitIndex:', suitIndex, 'play:', state.play_stacks[suitIndex], 'hypo:', state.hypo_stacks[suitIndex]);

						// TODO: look for 1-away finesse
						if (rank === stack_rank) {
							focus_possible.push({ suitIndex, rank });
						}
						else if (rank > stack_rank) {
							// Try looking for all connecting cards
							let connecting = find_connecting(state, giver, target, suitIndex, stack_rank);
							const connections = [];

							while (connecting !== undefined) {
								connections.push(connecting);
								stack_rank++;
								connecting = find_connecting(state, giver, target, suitIndex, stack_rank);
							}

							// Connected cards can stack up to this rank
							if (rank === stack_rank) {
								for (const connection of connections) {
									// TODO: Use the reacting person to see if they do something urgent instead of playing into finesse
									const { type, reacting, card } = connection;

									if (type === 'prompt' || type === 'known') {
										state.hypo_stacks[suitIndex]++;
									}
									else if (type === 'finesse') {
										focused_card.waiting_finesse_players.push(reacting);
									}
								}
								focus_possible.push({ suitIndex, rank });
							}
						}
					}

					// Save clue on chop
					if (chop) {
						for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
							let save2 = false;

							// Determine if it's a 2 save
							if (rank === 2 && state.play_stacks[suitIndex] + 1 !== rank) {
								console.log('checking for possible 2 save', Utils.cardToString({suitIndex, rank}));
								const duplicates = Utils.visibleFind(state, target, suitIndex, rank);

								// No duplicates found, so can be a 2 save
								if (duplicates.length === 0) {
									save2 = true;
									console.log('no duplicates found');
								}
								// Both duplicates found, so can't be a 2 save
								else if (duplicates.length === 2) {
									console.log('both duplicates found');
									continue;
								}
								else {
									// Can be a 2 save if the other 2 is in the giver's hand
									save2 = state.hands[giver].some(c => c.order === duplicates[0].order);
									console.log('in giver hand?', save2);
								}
							}

							if ((Utils.isCritical(state, suitIndex, rank) && state.play_stacks[suitIndex] + 1 !== rank) || save2) {
								focus_possible.push({ suitIndex, rank });
								save = true;
							}
						}
					}
				}
				// console.log('focus_possible', focus_possible);
				focused_card.inferred = Utils.intersectCards(focused_card.inferred, focus_possible);
				console.log('final inference on focused card', focused_card.inferred.map(c => Utils.cardToString(c)).join(','));

				// Focused card only has one possible inference, so remove that possibility from other clued cards via good touch principle
				// TODO: maybe modify if focused card is unplayable now but has rank high enough
				if (focused_card.inferred.length === 1) {
					const other_cards = state.hands[target].filter(c => c.order !== focused_card.order);
					good_touch_elim(other_cards, focused_card.inferred);

					// Update hypo stacks
					if (!save) {
						const { suitIndex, rank } = focused_card.inferred[0];
						if (target !== state.ourPlayerIndex && !Utils.cardMatch(focused_card, suitIndex, rank)) {
							console.log('Known card doesn\'t match inference! Not updating hypo stack.');
						}
						else {
							console.log('updating hypo stack (inference)');
							update_hypo_stacks(state, target, suitIndex, rank);
						}
					}
				}
				else if (focused_card.inferred.length === 0) {
					// Check for a prompt/finesse on us?
					// FIX: Not all the cards need to be from us (use visibleFind?)
					if (target !== state.ourPlayerIndex) {
						const our_hand = state.hands[state.ourPlayerIndex];
						const { suitIndex, rank } = focused_card;
						const connections = [];

						for (let i = state.hypo_stacks[suitIndex] + 1; i < rank; i++) {
							const prompted = our_hand.find(c => c.clued && c.inferred.some(inf => Utils.cardMatch(inf, suitIndex, rank)));
							if (prompted !== undefined) {
								console.log('found prompt in our hand');
								connections.push({type: 'prompt', card: prompted});
							}
							else {
								const finesse_pos = find_finesse_pos(our_hand);

								if (finesse_pos !== -1 && our_hand[finesse_pos].possible.some(c => Utils.cardMatch(c, suitIndex, rank))) {
									console.log('found finesse in our hand');
									connections.push({type: 'finesse', card: our_hand[finesse_pos]});
								}
								else {
									break;
								}
							}
						}

						// Found all connecting cards
						if (connections.length === rank - state.hypo_stacks[suitIndex] - 1) {
							for (let i = state.hypo_stacks[suitIndex] + 1; i < rank; i++) {
								const { type, card } = connections[i];

								card.inferred = [{ suitIndex, rank: i }];
								if (type === 'finesse') {
									card.finessed = true;
								}
							}
						}
						else {
							console.log('no inference found, resetting to all possibilities', focused_card.possible.map(c => Utils.cardToString(c)).join(','));
							focused_card.inferred = Utils.objClone(focused_card.possible);
						}
					}
					else {
						// TODO: We are the target and must also play (self-prompt, self-finesse)
						console.log('no inference found, resetting to all possibilities', focused_card.possible.map(c => Utils.cardToString(c)).join(','));
						focused_card.inferred = Utils.objClone(focused_card.possible);
					}
				}
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

			// Discarding a useful card (for whatever reason)
			if (state.hypo_stacks[suitIndex] >= rank &&
				state.play_stacks[suitIndex] < rank &&
				Utils.visibleFind(state, playerIndex, suitIndex, rank).length === 0) {
				console.log(`${state.playerNames[playerIndex]} discarded useful card ${Utils.cardToString(action)}, setting hypo stack ${rank - 1}`);
				state.hypo_stacks[suitIndex] = rank - 1;
			}
			else {
				console.log(state.hypo_stacks[suitIndex]);
				console.log(state.play_stacks[suitIndex]);
				console.log('found', Utils.visibleFind(state, playerIndex, suitIndex, rank));
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
				possible: Utils.objClone(state.all_possible),
				inferred: Utils.objClone(state.all_possible),
				waiting_finesse_players: []
			});

			// We can't see our own cards, but we can see others' at least
			if (playerIndex !== state.ourPlayerIndex) {
				const full_count = state.discard_stacks[suitIndex][rank - 1] +
					Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length +
					(state.play_stacks[suitIndex] >= rank ? 1 : 0);
				// console.log('full count of', full_count);

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

function update_hypo_stacks(state, target, suitIndex, rank) {
	if (state.hypo_stacks[suitIndex] < rank) {
		state.hypo_stacks[suitIndex] = rank;

		let final_hypo_rank = rank + 1;

		// FIX: Not all of these cards can necessarily be prompted
		// FIX: Unsure if only 'target' is enough
		while (Utils.visibleFind(state, target, suitIndex, final_hypo_rank).filter(c => c.clued && c.inferred.length === 1).length !== 0) {
			console.log('found connecting hypo card with rank', final_hypo_rank);
			final_hypo_rank++;
		}
		state.hypo_stacks[suitIndex] = final_hypo_rank - 1;
		console.log('final hypo stack of', suitIndex, 'is', final_hypo_rank - 1);
	}
}

module.exports = { handle_action };
