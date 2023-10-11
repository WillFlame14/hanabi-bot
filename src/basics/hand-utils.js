import { isBasicTrash, isCritical, unknownIdentities, visibleFind } from './hanabi-util.js';

import logger from '../tools/logger.js';
import { logCard, logHand } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Link} Link
 */

/**
 * Returns whether the hand is locked (i.e. every card is clued, chop moved, or an unplayable finesse AND not loaded).
 * @param {State} state
 * @param {number} playerIndex
 */
export function isLocked(state, playerIndex) {
	return state.hands[playerIndex].every(c => c.clued || c.chop_moved || (c.finessed && state.play_stacks[c.suitIndex] < c.rank)) &&
		!isLoaded(state, playerIndex);
}

/**
 * Returns whether the hand is loaded (i.e. has a known playable or trash).
 * @param {State} state
 * @param {number} playerIndex
 */
export function isLoaded(state, playerIndex) {
	return find_playables(state, playerIndex).length > 0 || find_known_trash(state, playerIndex).length > 0;
}

/**
 * Finds known playables in the hand.
 * @param {State} state
 * @param {number} playerIndex
 */
export function find_playables(state, playerIndex) {
	const hand = state.hands[playerIndex];
	const links = state.links[playerIndex];

	const playables = [];
	const linked_orders = new Set();

	for (const { cards, identities } of links) {
		// We aren't sure about the identities of these cards - at least one is bad touched
		if (cards.length > identities.reduce((sum, { suitIndex, rank }) => sum += unknownIdentities(state, playerIndex, suitIndex, rank), 0)) {
			cards.forEach(c => linked_orders.add(c.order));
		}
	}

	for (const card of hand) {
		if (linked_orders.has(card.order)) {
			continue;
		}

		let playable = true;

		// Card is probably trash
		if (card.inferred.length === 0) {
			// Still, double check if all possibilities are playable
			for (const possible of card.possible) {
				if (state.play_stacks[possible.suitIndex] + 1 !== possible.rank) {
					playable = false;
					break;
				}
			}
		}
		else {
			for (const inferred of card.inferred) {
				// Note: Do NOT use hypo stacks
				if (state.play_stacks[inferred.suitIndex] + 1 !== inferred.rank) {
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

/**
 * Finds known trash in the hand.
 * Uses asymmetric information (from the owning player's perspective) in other people's hands by default.
 * @param {State} state
 * @param {number} playerIndex
 * @param {boolean} global_info 	Whether to only find globally known trash or not.
 */
export function find_known_trash(state, playerIndex, global_info = false) {
	const trash = [];

	/** @type {(suitIndex: number, rank: number, order: number) => boolean} */
	const visible_elsewhere = (suitIndex, rank, order) => {
		const symmetric = global_info ? state.playerNames.map((_, i) => i) : [playerIndex];

		const visible_other = visibleFind(state, playerIndex, suitIndex, rank, { ignore: [playerIndex], symmetric });
		const visible_same = state.hands[playerIndex].findCards(suitIndex, rank, { infer: true, symmetric: true });

		// Visible in someone else's hand or visible in the same hand (but not part of a link)
		return visible_other.some(c => (c.clued || c.finessed) && c.order !== order) ||
			visible_same.some(c => c.clued && c.order !== order && !state.links[playerIndex].some(link => link.cards.some(lc => lc.order === order)));
	};

	for (const card of state.hands[playerIndex]) {
		const possibilities = (card.inferred.length === 0 || playerIndex !== state.ourPlayerIndex) ? card.possible : card.inferred;

		// Every possibility is trash or known duplicated somewhere
		if (possibilities.every(c => isBasicTrash(state, c.suitIndex, c.rank) || visible_elsewhere(c.suitIndex, c.rank, card.order))) {
			logger.debug(`order ${card.order} is trash, possibilities ${possibilities.map(c => logCard(c)).join()}, results ${possibilities.map(c => isBasicTrash(state, c.suitIndex, c.rank) + '|' + visible_elsewhere(c.suitIndex, c.rank, card.order)).join()}`);
			trash.push(card);
		}
	}
	return trash;
}

/**
 * Finds the best discard in a locked hand.
 * Breaks ties using the leftmost card.
 * @param {State} state
 * @param {number} playerIndex
 */
export function locked_discard(state, playerIndex) {
	// If any card's crit% is 0
	const crit_percents = Array.from(state.hands[playerIndex].map(card => {
		const possibilities = card.inferred.length === 0 ? card.possible : card.inferred;
		const percent = possibilities.filter(p => isCritical(state, p.suitIndex, p.rank)).length / possibilities.length;

		return { card, percent };
	})).sort((a, b) => a.percent - b.percent);

	const least_crits = crit_percents.filter(({ percent }) => percent === crit_percents[0].percent);

	/**
	 * @param {{suitIndex: number, rank: number}} possibility
	 * @param {boolean} all_crit
	 */
	const distance = ({ suitIndex, rank }, all_crit) => {
		const crit_distance = (all_crit ? rank * 5 : 0) + rank - state.hypo_stacks[playerIndex][suitIndex];
		return crit_distance < 0 ? 5 : crit_distance;
	};

	let max_dist = -1;

	/** @type Card */
	let furthest_card;

	for (const { card } of least_crits) {
		const possibilities = card.inferred.length === 0 ? card.possible : card.inferred;
		const curr_distance = possibilities.reduce((sum, p) => sum += distance(p, crit_percents[0].percent === 1), 0);

		if (curr_distance > max_dist) {
			max_dist = curr_distance;
			furthest_card = card;
		}
	}
	return furthest_card;
}
