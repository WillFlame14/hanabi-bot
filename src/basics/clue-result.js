import { Hand } from './Hand.js';
import { isTrash } from './hanabi-util.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').ActualCard} ActualCard
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').Clue} Clue
 */

/**
 * @param  {Player} player
 * @param  {Player} hypo_player
 * @param  {Hand} hand
 * @param  {number[]} list
 */
export function elim_result(player, hypo_player, hand, list) {
	let new_touched = 0, fill = 0, elim = 0;

	for (const { order } of hand) {
		const old_card = player.thoughts[order];
		const hypo_card = hypo_player.thoughts[order];

		if (hypo_card.clued && !hypo_card.called_to_discard && hypo_card.possible.length < old_card.possible.length && hypo_card.matches_inferences()) {
			if (hypo_card.newly_clued && !hypo_card.finessed)
				new_touched++;
			else if (list.includes(order))
				fill++;
			else
				elim++;
		}
	}
	return { new_touched, fill, elim };
}

/**
 * @param  {State} state
 * @param  {Player} hypo_player
 * @param  {number} target
 * @param  {number} focus_order
 */
export function bad_touch_result(state, hypo_player, target, focus_order = -1) {
	let bad_touch = 0, trash = 0;

	for (const card of state.hands[target]) {
		// Ignore cards that aren't newly clued, focused card can't be bad touched
		if (!card.newly_clued || card.order === focus_order)
			continue;

		if (hypo_player.thoughts[card.order].possible.every(p => isTrash(state, hypo_player, p, card.order, { infer: true })))
			trash++;

		// TODO: Don't double count bad touch when cluing two of the same card
		else if (isTrash(state, state.me, state.me.thoughts[card.order], card.order))
			bad_touch++;
	}

	return { bad_touch, trash };
}

/**
 * @param  {State} state
 * @param  {Player} player
 * @param  {Player} hypo_player
 */
export function playables_result(state, player, hypo_player) {
	let finesses = 0;
	const playables = [];

	/**
	 * TODO: This might not find the right card if it was duplicated...
	 * @param  {Identity} identity
	 */
	function find_card(identity) {
		for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
			const hand = state.hands[playerIndex];

			for (const { order } of hand) {
				const old_card = player.thoughts[order];
				const hypo_card = hypo_player.thoughts[order];

				if (hypo_card.saved && hypo_card.matches(identity, { infer: true }))
					return { playerIndex, old_card, hypo_card };
			}
		}
	}

	// Count the number of finesses and newly known playable cards
	for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
		for (let rank = player.hypo_stacks[suitIndex] + 1; rank <= hypo_player.hypo_stacks[suitIndex]; rank++) {
			const { playerIndex, old_card, hypo_card } = find_card({ suitIndex, rank });

			if (hypo_card.finessed && !old_card.finessed)
				finesses++;

			// Only counts as a playable if it wasn't already playing
			if (!player.unknown_plays.has(hypo_card.order))
				playables.push({ playerIndex, card: hypo_card });
		}
	}

	for (const order of hypo_player.unknown_plays) {
		if (player.unknown_plays.has(order))
			continue;

		const playerIndex = state.hands.findIndex(hand => hand.findOrder(order));

		// Only count unknown playables if they actually go on top of the stacks
		if (state.me.thoughts[order].rank > player.hypo_stacks[state.me.thoughts[order].suitIndex])
			playables.push({ playerIndex, card: hypo_player.thoughts[order] });
	}

	return { finesses, playables };
}
