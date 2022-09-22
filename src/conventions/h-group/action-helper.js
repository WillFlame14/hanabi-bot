const { ACTION } = require('../../constants.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const { finesses, new_touched, playables, bad_touch } = clue.result;
		const clue_value = 2*finesses + 0.5*(new_touched + playables) - 2*bad_touch;
		logger.info('clue', Utils.logClue(clue), 'value', clue_value);

		if (clue_value > best_clue_value) {
			best_clue_value = clue_value;
			best_clue = clue;
		}
	}

	return { clue: best_clue, clue_value: best_clue_value };
}

function find_urgent_clues(state, tableID, play_clues, save_clues, fix_clues) {
	const urgent_clues = [[], [], [], [], [], [], []];

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;
		const playable_cards = find_playables(state.play_stacks, state.hands[target]);
		const trash_cards = find_known_trash(state, target);

		// They require a save clue
		// Urgency: [next, save only] [next, play/fix over save] [next, fix]
		// (play) (give play if 2+ clues)
		// [other, save only] [other, play/fix over save] [other, fix]
		// (give play if < 2 clues) [early saves]
		if (save_clues[target] !== undefined) {
			// They don't already have a playable or trash
			if (playable_cards.length === 0 && trash_cards.length === 0) {
				// Try to see if they have a playable card that connects to one in our hand
				for (const card of state.hands[target]) {
					const { suitIndex, rank } = card;
					const one_away = Utils.playableAway(state, suitIndex, rank) === 1;

					if (one_away) {
						// See if we have the connecting card (should be certain)
						const our_connecting =
							state.hands[state.ourPlayerIndex].find(c => c.matches(suitIndex, rank - 1, { infer: true }));

						if (our_connecting !== undefined) {
							// The card must become playable
							const known = card.inferred.every(c => {
								return Utils.playableAway(state, c.suitIndex, c.rank) === 0 || c.matches(suitIndex, rank);
							});

							if (known) {
								Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: our_connecting.order });
							}
						}
					}
				}

				// TODO: Try to see if we can give a finesse involving them

				// Giving save clues to the player directly after us is more urgent
				const { clue, clue_value } = select_play_clue(play_clues[target]);
				const trash_fix = fix_clues[target].find(clue => clue.trash);
				if (clue_value > 0 && state.clue_tokens >= 2) {
					// Can give them a play clue, so less urgent (need at least 2 clue tokens)
					urgent_clues[1 + (i !== 1 ? 3 : 0)].push(clue);
				}
				else if (trash_fix !== undefined && state.clue_tokens >= 2) {
					// Can give them a fix clue, so less urgent
					urgent_clues[1 + (i !== 1 ? 3 : 0)].push(trash_fix);
				}
				else {
					// Play clue value is too low or cannot give play, give save clue
					urgent_clues[i !== 1 ? 3 : 0].push(save_clues[target]);
				}
			}
			// They have a playable or trash card
			else {
				urgent_clues[6].push(save_clues[target]);
			}
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			urgent_clues[2 + (i !== 1 ? 3 : 0)].push(fix_clues[target][0]);
		}
	}
	return urgent_clues;
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
		}

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

module.exports = { select_play_clue, find_urgent_clues, determine_playable_card };
