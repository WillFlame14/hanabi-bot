const { find_clues, find_tempo_clues, find_stall_clue } = require('./clue-finder.js');
const { find_chop } = require('./hanabi-logic.js');
const { ACTION, find_playables, find_known_trash } = require('../../basics.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const { bad_touch, touch } = clue;

		if (touch - 2*bad_touch > best_clue_value) {
			best_clue_value = touch - 2*bad_touch;
			best_clue = clue;
		}
	}

	return { clue: best_clue, value: best_clue_value };
}

function take_action(state, tableID) {
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues } = find_clues(state);

	// First, check if anyone needs an urgent save
	// TODO: Check if someone else can save
	// TODO: scream discard?
	if (state.clue_tokens > 0) {
		const urgent_save_clues = [[], []];

		for (let i = 1; i < state.numPlayers; i++) {
			const target = (state.ourPlayerIndex + i) % state.numPlayers;
			const playable_cards = find_playables(state.play_stacks, state.hands[target]);
			const trash_cards = find_known_trash(state, state.hands[target]);

			// They require a save clue and don't have a playable or trash
			if (save_clues[target] !== undefined && playable_cards.length === 0 && trash_cards.length === 0) {
				const { clue, value } = select_play_clue(play_clues[target]);
				if (value > 0 && state.clue_tokens >= 2) {
					// Can give them a play clue, so less urgent (need at least 2 clue tokens)
					urgent_save_clues[1].push(clue);
				}
				else {
					// Cannot give them a play clue, so more urgent
					urgent_save_clues[0].push(save_clues[target]);
				}
			}
		}

		// Go through urgent save clues in order of priority
		for (const clues of urgent_save_clues) {
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
	playable_cards = Utils.subtractCards(playable_cards, trash_cards);
	console.log('playable cards', Utils.logHand(playable_cards));
	console.log('trash cards', Utils.logHand(trash_cards));

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
