const { cardTouched } = require('../variants.js');
const { isBasicTrash, visibleFind } = require('./hanabi-util.js');
const { logger } = require('../logger.js');

const Utils = require('../util.js');

function find_possibilities(clue, suits) {
	const new_possible = [];

	for (let suitIndex = 0; suitIndex < suits.length; suitIndex++) {
		for (let rank = 1; rank <= 5; rank++) {
			const card = {suitIndex, rank};
			if (cardTouched(card, suits, clue)) {
				new_possible.push(card);
			}
		}
	}
	return new_possible;
}

function bad_touch_possiblities(state, giver, target, prev_found = []) {
	const bad_touch = prev_found;

	if (prev_found.length === 0) {
		// Find useless cards
		for (let suitIndex = 0; suitIndex <= state.suits.length; suitIndex++) {
			for (let rank = 1; rank <= 5; rank++) {
				// Cards that have already been played on the stack or can never be played
				if (isBasicTrash(state, suitIndex, rank)) {
					bad_touch.push({suitIndex, rank});
				}
			}
		}
	}

	// Find cards clued in other hands (or inferred cards in our hand or giver's hand)
	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];
		for (let j = 0; j < hand.length; j++) {
			const card = hand[j];
			if (!card.clued) {
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
					if (!card.matches(suitIndex, rank, { infer: true })) {
						logger.warn(`tried to identify ${Utils.logCard(card.inferred[0])} as bad touch when card's identity is ${Utils.logCard(card)}`);
						continue;
					}
				}
				else {
					continue;
				}
			} else {
				({suitIndex, rank} = card);
				method = 'known';
			}

			if (rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
				if (!bad_touch.some(c => c.suitIndex === suitIndex && c.rank === rank)) {
					logger.debug(`adding ${Utils.logCard({suitIndex, rank})} to bad touch via ${method} (slot ${j + 1} in ${state.playerNames[i]}'s hand)`);
					bad_touch.push({suitIndex, rank});
				}
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

function find_known_trash(state, playerIndex) {
	const hand = state.hands[playerIndex];
	const trash = [];

	const visible_elsewhere = (suitIndex, rank, order) => {
		// Visible in someone else's hand or visible in the same hand (but only one is trash)
		return visibleFind(state, state.ourPlayerIndex, suitIndex, rank, { ignore: [playerIndex] }).some(c => c.clued && c.order !== order) ||
			visibleFind(state, state.ourPlayerIndex, suitIndex, rank).some(c => c.clued && c.order > order);
	};

	for (const card of hand) {
		const possibilities = (card.inferred.length === 0 || playerIndex !== state.ourPlayerIndex) ? card.possible : card.inferred;

		// Every possibility is trash or known duplicated somewhere
		if (possibilities.every(c => isBasicTrash(state, c.suitIndex, c.rank) || visible_elsewhere(c.suitIndex, c.rank, card.order))) {
			logger.debug(`order ${card.order} is trash, possibilities ${possibilities.map(c => Utils.logCard(c)).join()}, results ${possibilities.map(c => isBasicTrash(state, c.suitIndex, c.rank) + '|' + visible_elsewhere(c.suitIndex, c.rank, card.order)).join()}`);
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

		if ((card.clued || card.chop_moved) && (options.hard || card.inferred.length > 1)) {
			card.subtract('inferred', cards);

			if (card.inferred.length === 0) {
				card.reset = true;
			}
		}
	}
}

function update_hypo_stacks(state) {
	// Fix hypo stacks if below play stacks
	for (let i = 0; i < state.suits.length; i++) {
		// TODO: Eventually, this should be added back. Need to maintain a better idea of the connections being made/broken.
		// if (state.hypo_stacks[i] < state.play_stacks[i]) {
			state.hypo_stacks[i] = state.play_stacks[i];
		// }
	}

	let found_new_playable = true;
	const good_touch_elim = [];

	// Attempt to play all playable cards
	while (found_new_playable) {
		found_new_playable = false;

		for (const hand of state.hands) {
			for (const card of hand) {
				if (!(card.clued || card.finessed || card.chop_moved) || good_touch_elim.some(e => e.matches(card.suitIndex, card.rank))) {
					continue;
				}

				// Delayed playable if all possibilities have been either eliminated by good touch or are playable (but not all eliminated)
				const delayed_playable = (poss) => {
					let all_trash = true;
					for (const c of poss) {
						if (good_touch_elim.some(e => e.matches(c.suitIndex, c.rank))) {
							continue;
						}

						if (state.hypo_stacks[c.suitIndex] + 1 === c.rank) {
							all_trash = false;
						}
						else {
							return false;
						}
					}
					return !all_trash;
				};

				if (card.matches_inferences() && (delayed_playable(card.possible) || delayed_playable(card.inferred))) {
					let suitIndex2, rank2;
					if (card.suitIndex !== -1) {
						({suitIndex: suitIndex2, rank: rank2} = card);
					}
					else if (card.possible.length === 1) {
						({suitIndex: suitIndex2, rank: rank2} = card.possible[0]);
					}
					else if (card.inferred.length === 1) {
						({suitIndex: suitIndex2, rank: rank2} = card.inferred[0]);
					}
					else {
						// Playable, but we don't know what card it is so we can't update hypo stacks
						continue;
					}

					// Extra check just to be sure
					if (rank2 === state.hypo_stacks[suitIndex2] + 1) {
						state.hypo_stacks[suitIndex2] = rank2;
					}
					else {
						logger.error(`tried to add new playable card ${Utils.logCard(card)} but didn't match hypo stacks`);
						continue;
					}

					good_touch_elim.push(card);
					found_new_playable = true;
					logger.debug(`found new playable ${Utils.logCard(card)}`);
				}
			}
		}
	}
}

module.exports = {
	find_possibilities, bad_touch_possiblities,
	find_playables, find_known_trash,
	good_touch_elim,
	update_hypo_stacks
};
