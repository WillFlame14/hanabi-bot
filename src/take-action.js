const { ACTION, find_playables, find_known_trash } = require('./action-helper.js');
const { find_clues, find_tempo_clues, find_stall_clue } = require('./clue-finder.js');
const { find_chop } = require('./hanabi-logic.js');
const Utils = require('./util.js');

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
			const trash_cards = find_known_trash(state.play_stacks, state.max_ranks, state.hands[target]);

			// They require a save clue and don't have a playable or trash
			if (save_clues[target] !== undefined && playable_cards.length === 0 && trash_cards.length === 0) {
				if (play_clues[target].length > 0 && state.clue_tokens > 1) {
					// Can give them a play clue, so less urgent (need at least 2 clue tokens)
					urgent_save_clues[1].push(play_clues[target][0]);
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
	const trash_cards = find_known_trash(state.play_stacks, state.max_ranks, hand);

	// Determine if any cards are clued duplicates, and if so, perform a sarcastic discard
	for (const card of hand) {
		if (!card.clued) {
			continue;
		}
		let all_duplicates = true;
		// Playable card from inference or from known
		const possibilities = (card.inferred.length !== 0) ? card.inferred : card.possible;
		for (const possible of possibilities) {
			// Find all duplicates, excluding itself
			const duplicates = Utils.visibleFind(state, state.ourPlayerIndex, possible.suitIndex, possible.rank).filter(c => c.order !== card.order);

			// No duplicates or none of duplicates are clued
			if (duplicates.length === 0 || !duplicates.some(c => c.clued)) {
				all_duplicates = false;
				break;
			}
		}

		if (all_duplicates) {
			trash_cards.unshift(card);
			playable_cards = playable_cards.filter(c => c.order !== card.order);
			break;
		}
	}
	console.log('playable cards', Utils.logHand(playable_cards));

	// No saves needed, so play
	if (playable_cards.length > 0) {
		// TODO: Play order (connecting card in other hand, 5, connecting card in own hand, lowest card)
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: playable_cards[0].order });
	}
	else {
		if (state.clue_tokens > 0) {
			let best_touch_value = 0;
			let best_clue;

			for (let i = 1; i < state.numPlayers; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;

				// TODO: Only give selfish clues to save cards on chop
				if (play_clues[target].length > 0) {
					for (const clue of play_clues[target]) {
						const { bad_touch, touch } = clue;

						if (touch - 2*bad_touch > best_touch_value) {
							best_touch_value = touch - 2*bad_touch;
							best_clue = clue;
						}
					}
				}
			}

			// In 2 player, all tempo clues become valuable
			if (state.numPlayers === 2) {
				const otherPlayerIndex = (state.ourPlayerIndex + 1) % 2;
				const tempo_clues = find_tempo_clues(state);

				if (tempo_clues[otherPlayerIndex].length > 0 && best_clue === undefined) {
					const { type, value } = tempo_clues[otherPlayerIndex][0];
					Utils.sendCmd('action', { tableID, type, target: otherPlayerIndex, value });
					return;
				}
			}

			if (best_clue !== undefined) {
				const { type, target, value} = best_clue;
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
