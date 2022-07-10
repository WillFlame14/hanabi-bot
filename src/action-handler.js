const { find_finesse_pos, determine_focus, good_touch_elim } = require('./hanabi-logic.js');
const { CLUE, find_possibilities, find_bad_touch, find_connecting, find_own_finesses, remove_card_from_hand } = require('./action-helper.js');
const { take_action } = require('./take-action.js');
const Utils = require('./util.js');

function handle_action(state, action, tableID, catchup = false) {
	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { clue, giver, list, target } = action;
			const { focused_card, chop } = determine_focus(state.hands[target], list);
			// console.log('focused_card', focused_card, 'chop?', chop);

			// Going through each card that was clued
			for (const order of list) {
				const card = Utils.findOrder(state.hands[target], order);
				card.clued = true;
				card.newly_clued = true;
			}

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
			console.log('bad touch', bad_touch.map(c => Utils.cardToString(c)).join(','));

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
										card.finessed = true;
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
								const duplicates = Utils.visibleFind(state, target, suitIndex, rank);

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
								save = true;
							}
						}
					}
				}
				focused_card.inferred = Utils.intersectCards(focused_card.inferred, focus_possible);
				console.log('final inference on focused card', focused_card.inferred.map(c => Utils.cardToString(c)).join(','));
			}

			let feasible = false, connections, conn_suit;

			if (focused_card.inferred.length === 0) {
				// Reset inference
				focused_card.inferred = Utils.objClone(focused_card.possible);

				if (target === state.ourPlayerIndex) {
					// FIX: Look at the card that results from blind play to determine the connection
					let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;

					for (const card of focused_card.possible) {
						({ feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank));
						const blind_plays = connections.filter(conn => conn.self).length;
						console.log('feasible?', feasible, 'blind plays', blind_plays);

						if (feasible && blind_plays < min_blind_plays) {
							conn_save = connections;
							conn_suit = card.suitIndex;
							min_blind_plays = blind_plays;
						}
					}

					if (conn_save !== undefined) {
						connections = conn_save;
						feasible = true;
					}
				}
				else {
					({ feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank));
					conn_suit = focused_card.suitIndex;
				}
			}
			else if (focused_card.inferred.length === 1) {
				const { suitIndex, rank } = (target === state.ourPlayerIndex) ? focused_card.inferred[0] : focused_card;

				// Card doesn't match inference, or card isn't playable
				if (!Utils.cardMatch(focused_card.inferred[0], suitIndex, rank) || rank > state.hypo_stacks[suitIndex] + 1) {
					// Reset inference
					focused_card.inferred = Utils.objClone(focused_card.possible);
					({ feasible, connections } = find_own_finesses(state, giver, target, suitIndex, rank));
					conn_suit = suitIndex;
				}
			}

			if (feasible) {
				console.log('finesse possible!');
				let next_rank = state.hypo_stacks[conn_suit] + 1;
				for (const connection of connections) {
					const { type, card } = connection;

					card.inferred = [{ suitIndex: conn_suit, rank: next_rank }];
					card.finessed = (type === 'finesse');
					next_rank++;
				}
				// Set correct inference on focused card
				focused_card.inferred = [{suitIndex: conn_suit, rank: next_rank}];
			}

			// Focused card only has one possible inference, so remove that possibility from other clued cards via good touch principle
			if (focused_card.inferred.length === 1) {
				// Don't elim on the focused card
				good_touch_elim(state.hands[target], focused_card.inferred, [focused_card.order]);

				// Update hypo stacks (need to check if was save?)
				const { suitIndex, rank } = focused_card.inferred[0];
				console.log('updating hypo stack (inference)');
				update_hypo_stacks(state, target, suitIndex, rank);
			}
			console.log('hand state after clue', Utils.logHand(state.hands[target]));

			// Remove the newly_clued flag
			for (const order of list) {
				const card = Utils.findOrder(state.hands[target], order);
				card.newly_clued = false;
			}

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
				waiting_finesse_players: []
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
