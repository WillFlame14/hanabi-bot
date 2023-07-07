import { cardTouched } from '../variants.js';
import { isBasicTrash } from './hanabi-util.js';
import * as Basics from '../basics.js';
import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Hand.js').Hand} Hand
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').BasicCard} BasicCard
 */

/**
 * @param {BaseClue} clue
 * @param {string[]} suits
 */
export function find_possibilities(clue, suits) {
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

/**
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {BasicCard[]} prev_found	All previously found bad touch possibiltiies.
 */
export function bad_touch_possibilities(state, giver, target, prev_found = []) {
	const bad_touch = prev_found;

	if (bad_touch.length === 0) {
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
			if (!(card.clued || card.finessed)) {
				continue;
			}

			let suitIndex, rank, method;
			// Cards in our hand and the giver's hand are not known
			if ([state.ourPlayerIndex, giver, target].includes(i)) {
				if (card.possible.length === 1) {
					({suitIndex, rank} = card.possible[0]);
					method = 'elim';
				}
				else if (card.inferred.length === 1 && card.matches(card.inferred[0].suitIndex, card.inferred[0].rank, { infer: true })) {
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

			if (rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
				if (!bad_touch.some(c => c.suitIndex === suitIndex && c.rank === rank)) {
					logger.debug(`adding ${logCard({suitIndex, rank})} to bad touch via ${method} (slot ${j + 1} in ${state.playerNames[i]}'s hand)`);
					bad_touch.push({suitIndex, rank});
				}
			}
		}
	}

	return bad_touch;
}

/**
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 * @param {{ignore?: number[], hard?: boolean}} options
 */
export function recursive_elim(state, playerIndex, suitIndex, rank, options = {}) {
	let additional_elims = good_touch_elim(state, playerIndex, suitIndex, rank, options);
	let elim_index = 0;

	while (elim_index < additional_elims.length) {
		const { suitIndex, rank } = additional_elims[elim_index];

		for (let i = 0; i < state.numPlayers; i++) {
			const extra_card_elims = Basics.card_elim(state, playerIndex, suitIndex, rank);
			const extra_gtp_elims = good_touch_elim(state, playerIndex, suitIndex, rank);		// No ignoring or hard elims when recursing

			additional_elims = additional_elims.concat(extra_card_elims.concat(extra_gtp_elims));
		}
		elim_index++;
	}
}

/**
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 * @param {{ignore?: number[], hard?: boolean}} options
 */
export function good_touch_elim(state, playerIndex, suitIndex, rank, options = {}) {
	const new_elims = [];

	for (const card of state.hands[playerIndex]) {
		if (options.ignore?.includes(card.order)) {
			continue;
		}

		if ((card.clued || card.chop_moved || card.finessed) && (options.hard || card.inferred.length > 1)) {
			const pre_inferences = card.inferred.length;

			card.subtract('inferred', [{suitIndex, rank}]);

			if (card.inferred.length === 0) {
				card.reset = true;
			}
			// Newly eliminated
			else if (card.inferred.length === 1 && pre_inferences > 1) {
				new_elims.push(card.inferred[0]);
			}
		}
	}

	return new_elims;
}

/**
 * @param {State} state
 */
export function update_hypo_stacks(state) {
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
				/** @param {Card[]} poss */
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

				if (card.matches_inferences() && (delayed_playable(card.possible) || delayed_playable(card.inferred) || (card.finessed && delayed_playable([card])))) {
					const id = card.identity({ infer: true });
					if (id === undefined) {
						// Playable, but we don't know what card it is so we can't update hypo stacks
						continue;
					}

					const { suitIndex, rank } = id;

					// Extra check just to be sure
					if (rank === state.hypo_stacks[suitIndex] + 1) {
						state.hypo_stacks[suitIndex] = rank;
					}
					else {
						logger.error(`tried to add new playable card ${logCard(card)} but didn't match hypo stacks`);
						continue;
					}

					good_touch_elim.push(card);
					found_new_playable = true;
				}
			}
		}
	}
}
