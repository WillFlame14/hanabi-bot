import { isBasicTrash, isCritical, playableAway, unknownIdentities, visibleFind } from './hanabi-util.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').MatchOptions} MatchOptions
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Link} Link
 */

/**
 * Returns whether the hand is locked (i.e. every card is clued, chop moved, or finessed AND not loaded).
 * @param {State} state
 * @param {number} playerIndex
 */
export function isLocked(state, playerIndex) {
	return state.hands[playerIndex].every(c => c.saved) && !isLoaded(state, playerIndex);
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
	const links = state.links[playerIndex];
	const linked_orders = new Set();

	for (const { cards, identities } of links) {
		// We aren't sure about the identities of these cards - at least one is bad touched
		if (cards.length > identities.reduce((sum, identity) => sum += unknownIdentities(state, playerIndex, identity), 0)) {
			cards.forEach(c => linked_orders.add(c.order));
		}
	}

	return Array.from(state.hands[playerIndex].filter(card => !linked_orders.has(card.order) && card.possibilities.every(p => playableAway(state, p) === 0)));
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

	/** @type {(identity: BasicCard, order: number) => boolean} */
	const visible_elsewhere = (identity, order) => {
		const symmetric = global_info ? state.playerNames.map((_, i) => i) : [playerIndex];

		const visible_other = visibleFind(state, playerIndex, identity, { ignore: [playerIndex], symmetric });
		const visible_same = state.hands[playerIndex].findCards(identity, { infer: true, symmetric: true });

		// Visible in someone else's hand or visible in the same hand (but not part of a link)
		return visible_other.some(c => (c.clued || c.finessed) && c.order !== order) ||
			visible_same.some(c => c.clued && c.order !== order && !state.links[playerIndex].some(link => link.cards.some(lc => lc.order === order)));
	};

	for (const card of state.hands[playerIndex]) {
		const possibilities = (card.inferred.length === 0 || playerIndex !== state.ourPlayerIndex) ? card.possible : card.inferred;

		// Every possibility is trash or known duplicated somewhere
		if (possibilities.every(c => isBasicTrash(state, c) || visible_elsewhere(c, card.order))) {
			logger.debug(`order ${card.order} is trash, possibilities ${possibilities.map(c => logCard(c)).join()}, results ${possibilities.map(c => isBasicTrash(state, c) + '|' + visible_elsewhere(c, card.order)).join()}`);
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
		const percent = card.possibilities.filter(p => isCritical(state, p)).length / card.possibilities.length;
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

	const { card: furthest_card } = Utils.maxOn(least_crits, ({ card }) =>
		card.possibilities.reduce((sum, p) => sum += distance(p, crit_percents[0].percent === 1), 0));

	return furthest_card;
}
