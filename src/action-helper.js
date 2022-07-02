const { find_finesse_pos } = require('./hanabi-logic.js');
const Utils = require('./util.js');

const ACTION = {
	PLAY: 0,
	DISCARD: 1,
	COLOUR: 2,
	RANK: 3
}

const CLUE = { COLOUR: 0, NUMBER: 1 };

function find_possibilities(clue, num_suits) {
	const new_possible = [];
	if (clue.type === CLUE.COLOUR) {
		const suitIndex = clue.value;
		for (let rank = 1; rank <= 5; rank++) {
			new_possible.push({ suitIndex, rank });
		}
	}
	else {
		const rank = clue.value;
		for (let suitIndex = 0; suitIndex < num_suits; suitIndex++) {
			new_possible.push({ suitIndex, rank });
		}
	}
	return new_possible;
}

function find_bad_touch(state, giver, target) {
	const bad_touch = [];

	// Find useless cards
	for (let suitIndex = 0; suitIndex <= state.num_suits; suitIndex++) {
		for (let rank = 0; rank <= state.play_stacks[suitIndex]; rank++) {
			bad_touch.push({suitIndex, rank});
		}
	}

	// Find cards clued in other hands (or inferred cards in our hand or giver's hand)
	for (let i = 0; i < state.hands.length; i++) {
		const hand = state.hands[i];
		for (const card of hand) {
			if (!card.clued || card.rank <= state.play_stacks[card.suitIndex]) {
				continue;
			}

			let suitIndex, rank, method;
			// Cards in our hand and the giver's hand are not known
			if ([state.ourPlayerIndex, giver, target].includes(i)) {
				if (card.possible.length === 1) {
					({suitIndex, rank} = card.possible[0]);
					method = 'elim';
				}
				else if (card.inferred.length === 1) {
					({suitIndex, rank} = card.inferred[0]);
					method = 'inference';
				}
				else {
					continue;
				}
			} else {
				({suitIndex, rank} = card);
				method = 'known';
			}

			if (state.play_stacks[suitIndex] < rank) {
				console.log(`adding ${Utils.cardToString({suitIndex, rank})} to bad touch via ${method}`);
				bad_touch.push({suitIndex, rank});
			}
		}
	}

	return bad_touch;
}

function find_connecting(state, giver, target, suitIndex, rank) {
	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		const known_connecting = hand.find(card => card.clued &&
			(card.possible.length === 1 && Utils.cardMatch(card.possible[0], suitIndex, rank)) ||
			(card.inferred.length === 1 && Utils.cardMatch(card.inferred[0], suitIndex, rank))
		);

		if (known_connecting !== undefined) {
			return { type: 'known', reacting: i, card: known_connecting };
		}
	}

	for (let i = 0; i < state.numPlayers; i++) {
		if (i === target || i === giver) {
			continue;
		}
		else {
			// Try looking through another player's hand (known to both giver and target)
			const hand = state.hands[i];

			const prompt_pos = hand.findIndex(c => c.clued);
			const finesse_pos = find_finesse_pos(hand);

			if (prompt_pos !== -1 && Utils.cardMatch(hand[prompt_pos], suitIndex, rank)) {
				console.log(`found prompt ${Utils.cardToString(hand[prompt_pos])} in ${state.playerNames[i]}'s hand`);
				return { type: 'prompt', reacting: i, card: hand[prompt_pos] };
			}
			// Prompt takes priority over finesse
			else if (finesse_pos !== -1 && Utils.cardMatch(hand[finesse_pos], suitIndex, rank)) {
				console.log(`found finesse ${Utils.cardToString(hand[finesse_pos])} in ${state.playerNames[i]}'s hand`);
				return { type: 'finesse', reacting: i, card: hand[finesse_pos] };
			}
		}
	}
	// TODO: Prompt or finesse on me (includes self-prompt, self-finesse)
}

function find_own_playables(stacks, hand) {
	// console.log('finding playables with stack', stacks, 'and hand', hand);
	const playables = [];

	for (const card of hand) {
		let playable = true;

		// Card is probably trash
		if (card.inferred.length === 0) {
			// Still, double check if all possibilities are playable
			for (const possible of card.possible) {
				if (stacks[possible.suitIndex] + 1 !== possible.rank) {
					playable = false;
					break;
				}
			}
		}
		else {
			for (const possible of card.inferred) {
				// Note: Do NOT use hypo stacks
				if (stacks[possible.suitIndex] + 1 !== possible.rank) {
					playable = false;
					break;
				}
			}
		}

		if (playable) {
			playables.push(card);
		}
	}
	return playables;
}

function find_known_trash(play_stacks, hand) {
	const trash = [];

	for (const card of hand) {
		let can_discard = true;
		for (const possible of card.possible) {
			// TODO: (possibly) need to check if visibleFind can see the others
			if (possible.rank > play_stacks[possible.suitIndex]) {
				can_discard = false;
				break;
			}
		}
		if (can_discard) {
			trash.push(card);
		}
	}
	return trash;
}

function remove_card_from_hand(hand, order) {
	const card_index = hand.findIndex((card) => card.order === order);

	if (card_index === undefined) {
		console.log('could not find such card index!');
		return;
	}

	// Remove the card from their hand
	hand.splice(card_index, 1);
}

module.exports = {
	ACTION, CLUE,
	find_possibilities, find_bad_touch,
	find_connecting,
	find_own_playables, find_known_trash,
	remove_card_from_hand
};
