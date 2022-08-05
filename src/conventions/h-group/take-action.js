const { find_clues, find_tempo_clues, find_stall_clue } = require('./clue-finder.js');
const { find_chop } = require('./hanabi-logic.js');
const { ACTION, find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const { bad_touch, touch, finesses = 0 } = clue;
		const clue_value = 2*finesses + touch - 2.1*bad_touch;

		if (clue_value > best_clue_value) {
			best_clue_value = clue_value;
			best_clue = clue;
		}
	}

	return { clue: best_clue, value: best_clue_value };
}

function take_action(state, tableID) {
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues } = find_clues(state);

	// First, check if anyone needs an urgent save
	// TODO: Check if someone else can save
	// TODO: A fix clue can be used if it reveals trash
	// TODO: scream discard?
	if (state.clue_tokens > 0) {
		const urgent_clues = [[], [], []];

		const target = (state.ourPlayerIndex + 1) % state.numPlayers;
		const playable_cards = find_playables(state.play_stacks, state.hands[target]);
		const trash_cards = find_known_trash(state, state.hands[target]);

		// They require a save clue and don't already have a playable or trash
		if (save_clues[target] !== undefined && playable_cards.length === 0 && trash_cards.length === 0) {
			// Try to see if they have a playable card that connects to one in our hand
			for (const card of state.hands[target]) {
				const { suitIndex, rank } = card;
				const one_away = Utils.playableAway(state, suitIndex, rank) === 1;

				if (one_away) {
					// See if we have the connecting card (should be certain)
					const our_connecting = state.hands[state.ourPlayerIndex].find(c => {
						return c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank - 1);
					});

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

			const { clue, value } = select_play_clue(play_clues[target]);
			if (value > 0 && state.clue_tokens >= 2) {
				// Can give them a play clue, so less urgent (need at least 2 clue tokens)
				urgent_clues[1].push(clue);
			}
			else {
				// Play clue value is too low or cannot give play, give save clue
				urgent_clues[0].push(save_clues[target]);
			}
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			urgent_clues[2].push(fix_clues[target][0]);
		}

		// Go through urgent save clues in order of priority
		for (const clues of urgent_clues) {
			if (clues.length > 0) {
				const { type, target, value } = clues[0];
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}
	}

	// Then, look for playables or trash in own hand
	let playable_cards = find_playables(state.play_stacks, hand);
	const trash_cards = find_known_trash(state, hand);

	// Remove sarcastic discards from playables
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	logger.debug('playable cards', Utils.logHand(playable_cards));
	logger.debug('trash cards', Utils.logHand(trash_cards));

	// No saves needed, so play
	if (playable_cards.length > 0) {
		// TODO: Play order (connecting card in other hand, 5, connecting card in own hand, lowest card)
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: playable_cards[0].order });
	}
	else {
		if (state.clue_tokens > 0) {
			let all_play_clues = play_clues.flat();

			// In 2 player, all tempo clues become valuable
			if (state.numPlayers === 2) {
				const otherPlayerIndex = (state.ourPlayerIndex + 1) % 2;
				all_play_clues = all_play_clues.concat(find_tempo_clues(state)[otherPlayerIndex]);
			}

			const { clue, value } = select_play_clue(all_play_clues, state.cards_left < 5 ? -2 : 0);
			const minimum_clue_value = state.cards_left < 5 ? -2 : 0;

			if (value > minimum_clue_value) {
				const { type, target, value } = clue;
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
			else {
				logger.debug('clue too low value', clue, value);
			}
		}

		// 8 clues
		if (state.clue_tokens === 8) {
			const { type, value, target } = find_stall_clue(state, 4);

			// Should always be able to find a clue, even if it's a hard burn
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}

		// Locked hand and no good clues to give
		if (state.hands[state.ourPlayerIndex].every(c => c.clued)) {
			// Discard if possible
			if (trash_cards.length > 0) {
				Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
				return;
			}

			// Give stall clue if possible
			if (state.clue_tokens > 0) {
				const { type, value, target } = find_stall_clue(state, 3);
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}

		// Nothing else to do, so discard
		const chopIndex = find_chop(hand);
		logger.debug('discarding chop index', chopIndex);
		let discard;

		if (trash_cards.length > 0) {
			discard = trash_cards[0];
		}
		else if (chopIndex !== -1) {
			discard = hand[chopIndex];
		}
		else {
			discard = hand[Math.floor(Math.random() * hand.length)];
		}

		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discard.order });
	}
}

module.exports = { take_action };
