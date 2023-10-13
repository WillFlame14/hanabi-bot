import { Hand } from './Hand.js';
import { isTrash } from './hanabi-util.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('../types.js').BasicCard} BasicCard
 * @typedef {import('../types.js').Clue} Clue
 */

/**
 * @param  {State} state
 * @param  {State} hypo_state
 * @param  {number} playerIndex
 * @param  {number[]} list
 */
export function elim_result(state, hypo_state, playerIndex, list) {
	let new_touched = 0, fill = 0, elim = 0;

	// Count the number of cards that have increased elimination (i.e. cards that were "filled in")
	for (let i = 0; i < state.hands[playerIndex].length; i++) {
		const old_card = state.hands[playerIndex][i];
		const hypo_card = hypo_state.hands[playerIndex][i];

		if (hypo_card.clued && !hypo_card.called_to_discard && hypo_card.possible.length < old_card.possible.length && hypo_card.matches_inferences()) {
			if (hypo_card.newly_clued && !hypo_card.finessed) {
				new_touched++;
			}
			else if (list.includes(hypo_card.order)) {
				fill++;
			}
			else {
				elim++;
			}
		}
	}
	return { new_touched, fill, elim };
}

/**
 * @param  {State} state
 * @param  {number} playerIndex
 * @param  {Card[]} bad_touch_cards
 * @param  {number[]} [ignoreOrders]
 */
export function bad_touch_result(state, playerIndex, bad_touch_cards, ignoreOrders = []) {
	let bad_touch = 0, trash = 0;

	for (const card of state.hands[playerIndex]) {
		if (bad_touch_cards.some(c => c.order === card.order)) {
			// Known trash
			if (card.possible.every(p => isTrash(state, playerIndex, p, card.order))) {
				trash++;
			}
			else {
				// Don't double count bad touch when cluing two of the same card
				// Focused card should not be bad touched?
				if (bad_touch_cards.some(c => c.matches(card) && c.order > card.order) || ignoreOrders.includes(card.order)) {
					continue;
				}
				bad_touch++;
			}
		}
	}

	return { bad_touch, trash };
}

/**
 * @param  {State} state
 * @param  {State} hypo_state
 * @param  {number} giver
 */
export function playables_result(state, hypo_state, giver) {
	let finesses = 0;
	const playables = [], safe_playables = [];

	/**
	 * TODO: This might not find the right card if it was duplicated...
	 * @param  {BasicCard} identity
	 */
	function find_card(identity) {
		for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
			const hand = state.hands[playerIndex];

			for (let j = 0; j < hand.length; j++) {
				const old_card = hand[j];
				const hypo_card = hypo_state.hands[playerIndex][j];
				const { clued, finessed, chop_moved } = hypo_card;

				if ((clued || finessed || chop_moved) && hypo_card.matches(identity, { infer: true })) {
					return { playerIndex, old_card, hypo_card };
				}
			}
		}
	}

	// Count the number of finesses and newly known playable cards
	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		for (let rank = state.hypo_stacks[giver][suitIndex] + 1; rank <= hypo_state.hypo_stacks[giver][suitIndex]; rank++) {
			const { playerIndex, old_card, hypo_card } = find_card({ suitIndex, rank });

			if (hypo_card.finessed && !old_card.finessed) {
				finesses++;
			}

			// Only counts as a playable if it wasn't already playing
			if (!state.unknown_plays[state.ourPlayerIndex].some(order => order === old_card.order)) {
				playables.push({ playerIndex, card: old_card });

				if (Hand.isLoaded(hypo_state, playerIndex)) {
					safe_playables.push({ playerIndex, card: old_card });
				}
			}
		}
	}

	return { finesses, playables, safe_playables };
}
