const { ACTION } = require('../../constants.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_clue_value(clue_result) {
	const { finesses, new_touched, playables, bad_touch, elim } = clue_result;
	return finesses + 0.5*(new_touched + playables.length) + 0.01*elim - bad_touch;
}

function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const clue_value = find_clue_value(clue.result);
		logger.info('clue', Utils.logClue(clue), 'value', clue_value);

		if (clue_value > best_clue_value) {
			best_clue_value = clue_value;
			best_clue = clue;
		}
	}

	return { clue: best_clue, clue_value: best_clue_value };
}

function find_unlock(state, target) {
	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (Utils.playableAway(state, suitIndex, rank) === 1) {
			// See if we have the connecting card (should be certain)
			const our_connecting = state.hands[state.ourPlayerIndex].find(c => c.matches(suitIndex, rank - 1, { infer: true }));

			if (our_connecting !== undefined) {
				// The card must become playable
				const known = card.inferred.every(c => {
					return Utils.playableAway(state, c.suitIndex, c.rank) === 0 || c.matches(suitIndex, rank);
				});

				if (known) {
					return { tableID: state.tableID, type: ACTION.PLAY, target: our_connecting.order };
				}
			}
		}
	}
	return;
}

function find_play_over_save(state, target, all_play_clues, locked = false) {
	for (const clue of all_play_clues) {
		const clue_value = find_clue_value(clue.result);
		if (clue_value < (locked ? 0 : 1)) {
			continue;
		}

		const { playables } = clue.result;
		const target_cards = playables.filter(({ playerIndex }) => playerIndex === target);
		const immediately_playable = target_cards.find(({ card }) => Utils.playableAway(state, card.suitIndex, card.rank) === 0);

		// The card can be played without any additional help
		if (immediately_playable !== undefined) {
			const { type, target, value } = clue;
			return { tableID: state.tableID, type, target, value };
		}

		// Try to see if any target card can be made playable by players between us and them, including themselves
		for (const target_card of target_cards) {
			let found = false;
			let additional_help = 0;

			for (let i = 1; i <= state.numPlayers; i++) {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

				let help, lowest_rank = target_card.rank;
				for (const { playerIndex, card } of playables) {
					if (playerIndex !== i) {
						continue;
					}

					if (card.suitIndex === target_card.suitIndex && card.rank < lowest_rank) {
						help = card;
					}
				}

				if (help !== undefined) {
					// Make sure the helping card can add to the play stack
					if (state.play_stacks[target_card.suitIndex] + additional_help + 1 === help.rank) {
						additional_help++;

						if (state.play_stacks[target_card.suitIndex] + additional_help + 1 === target_card.rank) {
							found = true;
							break;
						}
					}
				}

				if (playerIndex === target) {
					break;
				}
			}

			if (found) {
				const { type, target, value } = clue;
				return { tableID: state.tableID, type, target, value };
			}
		}
	}
	return;
}

function find_urgent_actions(state, play_clues, save_clues, fix_clues) {
	const urgent_actions = [[], [], [], [], [], [], [], [], []];

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;
		const playable_cards = find_playables(state.play_stacks, state.hands[target]);
		const trash_cards = find_known_trash(state, target);

		// They require a save clue or are locked
		// Urgency: [next, unlock] [next, save only] [next, play/fix over save] [next, urgent fix] [other, unlock]
		// (play) (give play if 2+ clues)
		// [other, save only] [other, play/fix over save] [all other fixes]
		// (give play if < 2 clues) [early saves]
		if (save_clues[target] !== undefined || Utils.handLocked(state.hands[target])) {
			// They already have a playable or trash (i.e. early save)
			if (playable_cards.length !== 0 || trash_cards.length !== 0) {
				if (save_clues[target] !== undefined) {
					const { type, value } = save_clues[target];
					urgent_actions[8].push({ tableID: state.tableID, type, target, value });
					continue;
				}
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[i === 1 ? 0 : 4].push(unlock_action);
				continue;
			}

			// Try to give a play clue involving them
			if (state.clue_tokens > 1) {
				const play_over_save = find_play_over_save(state, target, play_clues.flat(), Utils.handLocked(state.hands[target]));
				if (play_over_save !== undefined) {
					urgent_actions[i === 1 ? 2 : 6].push(play_over_save);
					continue;
				}
			}

			// Give them a fix clue with known trash if possible
			const trash_fix = fix_clues[target].find(clue => clue.trash);
			if (trash_fix !== undefined) {
				const { type, value } = trash_fix;
				urgent_actions[i === 1 ? 2 : 6].push({ tableID: state.tableID, type, target, value });
				continue;
			}

			// No alternative, have to give save
			if (save_clues[target] !== undefined) {
				const { type, value } = save_clues[target];
				urgent_actions[i === 1 ? 1 : 5].push({ tableID: state.tableID, type, target, value });
			}
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			const urgent_fix = fix_clues[target].find(clue => clue.urgent);

			if (urgent_fix !== undefined) {
				const { type, value } = urgent_fix;

				// Urgent fix on the next player is particularly urgent, but should prioritize urgent fixes for others too
				urgent_actions[i === 1 ? 3 : 7].push({ tableID: state.tableID, type, target, value });
				continue;
			}

			// No urgent fixes required
			const { type, value } = fix_clues[target][0];
			urgent_actions[7].push({ tableID: state.tableID, type, target, value });
		}
	}
	return urgent_actions;
}

function determine_playable_card(state, playable_cards) {
	const priorities = [[], [], [], [], [], []];

	let min_rank = 5;
	for (const card of playable_cards) {
		const possibilities = card.inferred.length > 0 ? card.inferred : card.possible;
		logger.debug(`examining card with possibilities ${possibilities.map(p => p.toString()).join(',')}`);

		// Blind play
		if (card.finessed) {
			logger.debug(`adding ${Utils.logCard(card.suitIndex, card.rank)} to blind play priority`);
			priorities[0].push(card);
			continue;
		}

		const connecting_in_hand = function (hand, suitIndex, rank) {
			return Utils.handFind(hand, suitIndex, rank).length > 0;
		};

		let priority = 1;
		for (const inference of possibilities) {
			const { suitIndex, rank } = inference;

			let connected = false;

			// Start at next player so that connecting in our hand has lowest priority
			for (let i = 1; i < state.numPlayers + 1; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;
				if (connecting_in_hand(state.hands[target], suitIndex, rank + 1)) {
					connected = true;

					// Connecting in own hand, demote priority to 2
					if (target === state.ourPlayerIndex) {
						logger.debug(`inference ${Utils.logCard(suitIndex, rank)} connects to own hand`);
						priority = 2;
					}
					else {
						logger.debug(`inference ${Utils.logCard(suitIndex, rank)} connects to other hand`);
					}
					break;
				}
				else {
					logger.debug(`inference ${Utils.logCard(suitIndex, rank)} doesn't connect to ${state.playerNames[target]}`);
				}
			}

			if (!connected) {
				logger.debug(`inference ${Utils.logCard(suitIndex, rank)} doesn't connect`);
				priority = 3;
				break;
			}
		}

		if (priority < 3) {
			priorities[priority].push(card);
			logger.debug(`connecting in ${priority === 1 ? 'other' : 'own'} hand!`);
			continue;
		}

		// Find the lowest possible rank for the card
		const rank = possibilities.reduce((lowest_rank, card) => card.rank < lowest_rank ? card.rank : lowest_rank, 5);

		// Playing a 5
		if (rank === 5) {
			priorities[3].push(card);
			continue;
		}

		// Unknown card
		if (possibilities.length > 1) {
			priorities[4].push(card);
			continue;
		}

		// Other
		if (rank <= min_rank) {
			priorities[5].unshift(card);
			min_rank = rank;
		}
	}

	for (const cards of priorities) {
		if (cards.length > 0) {
			return cards[0];
		}
	}
}

module.exports = { select_play_clue, find_urgent_actions, determine_playable_card };
