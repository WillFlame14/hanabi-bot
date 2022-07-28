const { logger } = require('../logger.js');
const Utils = require('../util.js');

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
		for (let rank = 1; rank <= 5; rank++) {
			new_possible.push({ suitIndex: clue.value, rank });
		}
	}
	else {
		for (let suitIndex = 0; suitIndex < num_suits; suitIndex++) {
			new_possible.push({ suitIndex, rank: clue.value });
		}
	}
	return new_possible;
}

function find_bad_touch(state, giver, target) {
	const bad_touch = [];

	// Find useless cards
	for (let suitIndex = 0; suitIndex <= state.num_suits; suitIndex++) {
		// Cards that have already been played on the stack
		for (let rank = 1; rank <= state.play_stacks[suitIndex]; rank++) {
			bad_touch.push({suitIndex, rank});
		}

		// Cards that can never be played on the stack
		for (let rank = state.max_ranks[suitIndex] + 1; rank <= 5; rank++) {
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
				logger.debug(`adding ${Utils.logCard(suitIndex, rank)} to bad touch via ${method}`);
				bad_touch.push({suitIndex, rank});
			}
		}
	}

	return bad_touch;
}

function find_playables(stacks, hand) {
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
			for (const inferred of card.inferred) {
				// Note: Do NOT use hypo stacks
				if (stacks[inferred.suitIndex] + 1 !== inferred.rank) {
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

function find_known_trash(state, hand) {
	const trash = [];

	const not_trash = (suitIndex, rank) => rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex];

	for (const card of hand) {
		// No inference and every possibility is trash
		if (card.inferred.length === 0) {
			if (!card.possible.some(c => not_trash(c.suitIndex, c.rank))) {
				trash.push(card);
			}
			continue;
		}

		let can_discard = true;
		for (const possible of (card.suitIndex !== -1 ? card.possible : card.inferred)) {
			const { suitIndex, rank } = possible;

			// Card is not trash
			if (not_trash(suitIndex, rank)) {
				// Card is not known duplicated somewhere
				const duplicates = Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).filter(c => c.order !== card.order);
				if (duplicates.length === 0 || !duplicates.some(c => c.clued)) {
					can_discard = false;
					break;
				}
			}
		}
		if (can_discard) {
			trash.push(card);
		}
	}
	return trash;
}

function good_touch_elim(hand, cards, options = {}) {
	for (const card of hand) {
		if (options.ignore?.includes(card.order)) {
			continue;
		}

		if (card.clued && (options.hard || card.inferred.length > 1)) {
			card.subtract('inferred', cards);
		}
	}
}

function remove_card_from_hand(hand, order) {
	const card_index = hand.findIndex((card) => card.order === order);

	if (card_index === undefined) {
		logger.error('could not find such card index!');
		return;
	}

	// Remove the card from their hand
	hand.splice(card_index, 1);
}

function update_hypo_stacks(state, target, suitIndex, rank) {
	if (state.hypo_stacks[suitIndex] < rank) {
		state.hypo_stacks[suitIndex] = rank;

		/*let final_hypo_rank = rank + 1;

		// FIX: Not all of these cards can necessarily be prompted
		// FIX: Unsure if only 'target' is enough
		while (Utils.visibleFind(state, target, suitIndex, final_hypo_rank).filter(c => c.clued && c.inferred.length === 1).length !== 0) {
			logger.info('found connecting hypo card with rank', final_hypo_rank);
			final_hypo_rank++;
		}
		state.hypo_stacks[suitIndex] = final_hypo_rank - 1;
		logger.info('final hypo stack of', suitIndex, 'is', final_hypo_rank - 1);*/
	}
}

module.exports = {
	ACTION, CLUE,
	find_possibilities, find_bad_touch,
	find_playables, find_known_trash,
	good_touch_elim,
	remove_card_from_hand,
	update_hypo_stacks
};
