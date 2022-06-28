const { ACTION, find_own_playables, find_known_trash, find_clues, remove_card_from_hand } = require('./action-helper.js');
const { find_chop } = require('./hanabi-logic.js');
const Utils = require('./util.js');

function take_action(state, tableID) {
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues } = find_clues(state);

	// First, check if anyone needs an urgent save
	// TODO: Check if players have something safe to do (playable or trash)
	// TODO: Check if someone else can save
	// TODO: scream discard?
	if (state.clue_tokens > 0) {
		for (let i = 1; i < state.numPlayers; i++) {
			const target = (state.ourPlayerIndex + i) % state.numPlayers;

			// They require a save clue and cannot be given a play clue
			if (save_clues[target] !== undefined && play_clues[target].length === 0) {
				const { type, value } = save_clues[target];
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}

		// Then, check if anyone needs a save that can be distracted by a play
		// TODO: Check if someone else can save
		for (let i = 1; i < state.numPlayers; i++) {
			const target = (state.ourPlayerIndex + i) % state.numPlayers;

			// They require a save clue and can be given a play clue
			if (save_clues[target] !== undefined && play_clues[target].length > 0) {
				const { type, value } = play_clues[target][0];
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}
	}

	// Then, look for playables or trash in own hand
	let playable_cards = find_own_playables(state.play_stacks, hand);
	const trash_cards = find_known_trash(state.play_stacks, hand);

	// Determine if any playable cards are clued duplicates, and if so, perform a sarcastic discard
	for (let i = 0; i < playable_cards.length; i++) {
		const card = playable_cards[i];

		let all_duplicates = true;
		// Playable card from inference or from lie
		const possibilities = (card.inferred.length !== 0) ? card.inferred : card.possible;
		for (const possible of possibilities) {
			const duplicates = Utils.visibleFind(state.hands, possible.suitIndex, possible.rank);
			console.log('checking for duplicate of suitIndex', possible.suitIndex, 'rank', possible.rank, 'duplicates', duplicates.map(c => c.clued));

			// No duplicates or none of duplicates are clued
			if (duplicates.length === 0 || !duplicates.some(c => c.clued)) {
				all_duplicates = false;
				break;
			}
		}

		if (all_duplicates) {
			console.log('found duplicate card');
			trash_cards.unshift(card);
			playable_cards[i] = null;
			break;
		}
	}
	playable_cards = playable_cards.filter(c => c !== null);
	console.log('playable cards', playable_cards);

	// No saves needed, so play
	// TODO: Give "save" to playable cards on chop instead
	if (playable_cards.length > 0) {
		// TODO: Play order (connecting card in other hand, 5, connecting card in own hand, lowest card)
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: playable_cards[0].order });
	}
	else {
		if (state.clue_tokens > 0) {
			for (let i = 1; i < state.numPlayers; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;

				if (play_clues[target].length > 0) {
					const { type, value } = play_clues[target][0];
					Utils.sendCmd('action', { tableID, type, target, value });
					return;
				}
			}
		}

		// 8 clue state
		// TODO: Add stall clues
		if (state.clue_tokens === 8) {
			const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
			Utils.sendCmd('action', { tableID, type: ACTION.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank });
			return;
		}

		// Locked hand and no good clues to give
		// TODO: Add stall clues
		if (state.hands[state.ourPlayerIndex].every(c => c.clued)) {
			// Discard if possible
			if (trash_cards.length > 0) {
				Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
				return;
			}

			// Give stall clue if possible
			// TODO: Add stall clues
			if (state.clue_tokens > 0) {
				const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
				Utils.sendCmd('action', { tableID, type: ACTION.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank });
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
		console.log('trash cards', trash_cards, 'chop index', chopIndex);

		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discard.order });
	}
}

module.exports = { take_action };
