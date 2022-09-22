const { ACTION } = require('../../constants.js');
const { select_play_clue, find_urgent_clues, determine_playable_card } = require('./action-helper.js');
const { find_clues, find_tempo_clues, find_stall_clue } = require('./clue-finder.js');
const { find_chop } = require('./hanabi-logic.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function take_action(state, tableID) {
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues } = find_clues(state);
	const urgent_clues = find_urgent_clues(state, tableID, play_clues, save_clues, fix_clues);

	logger.info('all urgent clues', urgent_clues);

	// First, check if anyone needs an urgent save
	// TODO: scream discard?
	if (state.clue_tokens > 0) {
		for (let i = 0; i < 3; i++) {
			const clues = urgent_clues[i];
			if (clues.length > 0) {
				const { type, target, value } = clues[0];
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}
	}

	// Then, look for playables or trash in own hand
	let playable_cards = find_playables(state.play_stacks, hand);
	const trash_cards = find_known_trash(state, state.ourPlayerIndex);

	// Remove sarcastic discards from playables
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	logger.debug('playable cards', Utils.logHand(playable_cards));
	logger.info('trash cards', Utils.logHand(trash_cards));

	// No saves needed, so play
	if (playable_cards.length > 0) {
		// TODO: Play order (connecting card in other hand, 5, connecting card in own hand, lowest card)
		const card = determine_playable_card(state, playable_cards);
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: card.order });
	}
	else {
		if (state.clue_tokens > 0) {
			// Go through rest of urgent clues in order of priority
			for (let i = 3; i < 7; i++) {
				// Give play clue (at correct priority level)
				if (i === (state.clue_tokens > 1 ? 3 : 6)) {
					let all_play_clues = play_clues.flat();

					// In 2 player, all tempo clues become valuable
					if (state.numPlayers === 2) {
						const otherPlayerIndex = (state.ourPlayerIndex + 1) % 2;
						all_play_clues = all_play_clues.concat(find_tempo_clues(state)[otherPlayerIndex]);
					}

					const { clue, clue_value } = select_play_clue(all_play_clues);
					const minimum_clue_value = state.cards_left < 5 ? -10 : 0.9;

					if (clue_value > minimum_clue_value) {
						const { type, target, value } = clue;
						Utils.sendCmd('action', { tableID, type, target, value });
						return;
					}
					else {
						logger.info('clue too low value', Utils.logClue(clue), clue_value);
					}
				}

				const clues = urgent_clues[i];
				if (clues.length > 0) {
					const { type, target, value } = clues[0];
					Utils.sendCmd('action', { tableID, type, target, value });
					return;
				}
			}
		}

		// 8 clues
		if (state.clue_tokens === 8) {
			const { type, value, target } = find_stall_clue(state, 4);

			// Should always be able to find a clue, even if it's a hard burn
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}

		// Discard known trash
		if (trash_cards.length > 0) {
			Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
			return;
		}

		// Locked hand and no good clues to give
		if (state.hands[state.ourPlayerIndex].every(c => c.clued) && state.clue_tokens > 0) {
			const { type, value, target } = find_stall_clue(state, 3);
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}

		// Early game
		if (state.early_game && state.clue_tokens > 0) {
			const clue = find_stall_clue(state, 1);

			if (clue !== undefined) {
				const { type, value, target } = clue;
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}

		// Nothing else to do, so discard chop
		const chopIndex = find_chop(hand);
		logger.debug('discarding chop index', chopIndex);
		let discard;

		if (chopIndex !== -1) {
			discard = hand[chopIndex];
		}
		else {
			discard = hand[Math.floor(Math.random() * hand.length)];
		}

		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discard.order });
	}
}

module.exports = { take_action };
