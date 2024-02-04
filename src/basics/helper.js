import { CLUE } from '../constants.js';
import { unknownIdentities } from './hanabi-util.js';
import { cardTouched } from '../variants.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Player.js').Player} Player
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
 * @param {number} target
 */
export function all_valid_clues(state, target) {
	const hand = state.hands[target];
	const clues = /** @type {Clue[]} */ ([]);

	for (let rank = 1; rank <= 5; rank++)
		clues.push({ type: CLUE.RANK, value: rank, target });

	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++)
		clues.push({ type: CLUE.COLOUR, value: suitIndex, target });

	return clues.filter(clue => hand.clueTouched(clue, state.suits).length > 0);
}


/**
 * @param {State} state
 * @param {Player} player
 * 
 * Updates the hypo stacks for all players.
 */
export function update_hypo_stacks(state, player) {
	// Reset hypo stacks to play stacks
	const hypo_stacks = state.play_stacks.slice();
	const unknown_plays = [];

	let found_new_playable = true;
	const good_touch_elim = /** @type {Card[]}*/ ([]);

	const linked_orders = new Set();

	for (const { cards, identities } of player.links) {
		// We aren't sure about the identities of these cards - at least one is bad touched
		if (cards.length > identities.reduce((sum, identity) => sum += unknownIdentities(state, player, identity), 0)) {
			cards.forEach(c => linked_orders.add(c.order));
		}
	}

	// Attempt to play all playable cards
	while (found_new_playable) {
		found_new_playable = false;

		for (const { order } of state.hands.flat()) {
			const card = player.thoughts[order];

			if (!card.saved || good_touch_elim.some(e => e.matches(card)) || linked_orders.has(order)) {
				continue;
			}

			// Delayed playable if all possibilities have been either eliminated by good touch or are playable (but not all eliminated)
			/** @param {BasicCard[]} poss */
			const delayed_playable = (poss) => {
				let all_trash = true;
				for (const c of poss) {
					if (good_touch_elim.some(e => e.matches(c))) {
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

			const fake_wcs = player.waiting_connections.filter(wc => {
				const { fake, focused_card, inference } = wc;
				return focused_card.order === order && (fake || !state.me.thoughts[focused_card.order].matches(inference, { assume: true }));
			});

			// Ignore all waiting connections that will be proven wrong
			const diff = card.clone();
			diff.subtract('inferred', fake_wcs.flatMap(wc => wc.inference));

			if (diff.matches_inferences() && (delayed_playable(diff.possible) || delayed_playable(diff.inferred) || (diff.finessed && delayed_playable([card])))) {
				const id = card.identity({ infer: true });
				const actual_id = state.me.thoughts[order].identity();

				// Do not allow false updating of hypo stacks
				if (player.playerIndex === -1 && (
					(id && actual_id && !id.matches(actual_id)) ||		// Identity doesn't match
					(actual_id && unknown_plays.some(o => state.hands.flat().find(c => c.order === o).matches(actual_id)))		// Duping playable
				)) {
					continue;
				}

				if (id === undefined) {
					// Playable, but the player doesn't know what card it is so hypo stacks aren't updated
					unknown_plays.push(order);
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

/**
 * Updates all players with info from common knowledge.
 * @param {State} state
 */
export function team_elim(state) {
	for (const player of state.players) {
		for (let i = 0; i < state.common.thoughts.length; i++) {
			const card = player.thoughts[i];
			const ccard = state.common.thoughts[i];

			card.intersect('possible', ccard.possible);

			card.inferred = ccard.inferred.slice();
			card.intersect('inferred', card.possible);

			card.old_inferred = ccard.old_inferred?.slice();

			for (const property of ['focused', 'finessed', 'chop_moved', 'reset', 'chop_when_first_clued', 'hidden', 'called_to_discard', 'finesse_index', 'rewinded']) {
				card[property] = ccard[property];
			}
			card.reasoning = ccard.reasoning.slice();
			card.reasoning_turn = ccard.reasoning_turn.slice();
		}

		player.waiting_connections = state.common.waiting_connections.slice();
		player.good_touch_elim(state, state.numPlayers === 2);
		player.refresh_links(state);
		update_hypo_stacks(state, player);
	}
}
