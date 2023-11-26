import { cardTouched } from '../variants.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Hand.js').Hand} Hand
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Identity} Identity
 */

/**
 * @param {string[]} suits
 */
export function all_identities(suits) {
	const identities = [];

	for (let suitIndex = 0; suitIndex < suits.length; suitIndex++) {
		for (let rank = 1; rank <= 5; rank++) {
			identities.push({ suitIndex, rank });
		}
	}
	return identities;
}

/**
 * @param {BaseClue} clue
 * @param {string[]} suits
 */
export function find_possibilities(clue, suits) {
	return all_identities(suits).filter(id => cardTouched(id, suits, clue));
}

/**
 * @param {State} state
 * 
 * Updates the hypo stacks for all players.
 */
export function update_hypo_stacks(state) {
	for (let i = 0; i < state.numPlayers; i++) {
		const player = state.players[i];

		// Reset hypo stacks to play stacks
		const hypo_stacks = state.play_stacks.slice();
		const unknown_plays = [];

		let found_new_playable = true;
		const good_touch_elim = [];

		// Attempt to play all playable cards
		while (found_new_playable) {
			found_new_playable = false;

			for (const { order } of state.hands.flat()) {
				const card = state.players[i].thoughts[order];

				if (!card.saved || good_touch_elim.some(e => e.matches(card))) {
					continue;
				}

				// Delayed playable if all possibilities have been either eliminated by good touch or are playable (but not all eliminated)
				/** @param {BasicCard[]} poss */
				const delayed_playable = (poss) => {
					let all_trash = true;
					for (const c of poss) {
						if (good_touch_elim.some(e => e.matches(c.suitIndex, c.rank))) {
							continue;
						}

						if (hypo_stacks[c.suitIndex] + 1 === c.rank) {
							all_trash = false;
						}
						else {
							return false;
						}
					}
					return !all_trash;
				};

				const fake_wcs = state.waiting_connections.filter(wc => {
					const { fake, focused_card, inference } = wc;
					return focused_card.order === card.order && (fake || !focused_card.matches(inference));
				});

				// Ignore all waiting connections that will be proven wrong
				const diff = card.clone();
				diff.subtract('inferred', fake_wcs.flatMap(wc => wc.inference));

				if (diff.matches_inferences() && (delayed_playable(diff.possible) || delayed_playable(diff.inferred) || (diff.finessed && delayed_playable([card])))) {
					const id = card.identity({ infer: true });
					if (id === undefined) {
						// Playable, but the player doesn't know what card it is so hypo stacks aren't updated
						unknown_plays.push(card.order);
						continue;
					}

					const { suitIndex, rank } = id;

					// Extra check just to be sure
					if (rank === hypo_stacks[suitIndex] + 1) {
						hypo_stacks[suitIndex] = rank;
					}
					else {
						// e.g. a duplicated 1 before any 1s have played will have all bad possibilities eliminated by good touch
						logger.debug(`tried to add new playable card ${logCard(card)} but was duplicated`);
						continue;
					}

					good_touch_elim.push(card);
					found_new_playable = true;
				}
			}
		}
		player.hypo_stacks = hypo_stacks;
		player.unknown_plays = unknown_plays;
	}
}

/**
 * Updates all players with info from common knowledge.
 * @param {State} state
 */
export function team_elim(state) {
	for (const player of state.players) {
		for (let i = 0; i < state.common.thoughts.length; i++) {
			player.thoughts[i].intersect('inferred', state.common.thoughts[i].inferred);
			player.thoughts[i].intersect('possible', state.common.thoughts[i].possible);
		}

		player.infer_elim(state);
		player.good_touch_elim(state);
	}
}
