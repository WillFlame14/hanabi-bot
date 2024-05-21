import { Hand } from './Hand.js';
import { isTrash } from './hanabi-util.js';

/**
 * @typedef {import('./Game.js').Game} Game
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
	const new_touched = [];
	let fill = 0, elim = 0;

	for (const { order } of hand) {
		const old_card = player.thoughts[order];
		const hypo_card = hypo_player.thoughts[order];

		if (hypo_card.clued && !hypo_card.called_to_discard && hypo_card.possible.length < old_card.possible.length && hypo_card.matches_inferences()) {
			if (hypo_card.newly_clued && !hypo_card.finessed)
				new_touched.push(hypo_card);
			else if (list.includes(order))
				fill++;
			else
				elim++;
		}
	}
	return { new_touched, fill, elim };
}

/**
 * @param  {Game} game
 * @param  {Game} hypo_game
 * @param  {Player} hypo_player
 * @param  {number} giver
 * @param  {number} target
 * @param  {number} focus_order
 */
export function bad_touch_result(game, hypo_game, hypo_player, giver, target, focus_order = -1) {
	const { me, state } = hypo_game;
	let bad_touch = 0, trash = 0, avoidable_dupe = 0;

	const dupe_scores = game.players.map((player, pi) => {
		if (pi == target)
			return Infinity;
		let possible_dupe = 0;
		// Check if the giver may have a touched duplicate card.
		// TODO: Should we consider chop moved cards?
		for (const card of state.hands[target]) {
			const identity = card.identity();
			// TODO: Should we cluing cards where receiver knows they are duplicated?
			if (!identity || !hypo_game.state.isPlayable(identity))
				continue;
			for (const giverCard of state.hands[pi]) {
				// Allow known duplication since we can discard to resolve it.
				if (hypo_player.thoughts[giverCard.order].clued &&
					game.players[pi].thoughts[giverCard.order].inferred.length > 1 &&
					game.players[pi].thoughts[giverCard.order].inferred.has(identity))
					possible_dupe++;
			}
		}
		return possible_dupe;
	});
	const min_dupe = Math.min(...dupe_scores);

	for (const card of state.hands[target]) {
		// Ignore cards that aren't newly clued
		if (!card.newly_clued)
			continue;

		avoidable_dupe = dupe_scores[giver] - min_dupe;

		// focused card can't be known bad touched.
		if (card.order === focus_order)
			continue;

		if (hypo_player.thoughts[card.order].possible.every(p => isTrash(state, hypo_player, p, card.order, { infer: true })))
			trash++;

		// TODO: Don't double count bad touch when cluing two of the same card
		else if (isTrash(state, me, me.thoughts[card.order], card.order))
			bad_touch++;
	}

	return { bad_touch, trash, avoidable_dupe };
}

/**
 * @param  {State} state
 * @param  {Player} player
 * @param  {Player} hypo_player
 */
export function playables_result(state, player, hypo_player) {
	const finesses = [];
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
			// Hypo stack increased from promised link, card won't be findable
			if (hypo_player.links.some(link => link.promised && link.identities[0].suitIndex === suitIndex && link.identities[0].rank === rank))
				continue;

			const { playerIndex, old_card, hypo_card } = find_card({ suitIndex, rank });

			if (hypo_card.finessed && !old_card.finessed)
				finesses.push({ playerIndex, card: hypo_card });

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
		if (state.deck[order].rank > player.hypo_stacks[state.deck[order].suitIndex]) {
			if (hypo_player.thoughts[order].finessed)
				finesses.push({ playerIndex, card: hypo_player.thoughts[order] });

			playables.push({ playerIndex, card: hypo_player.thoughts[order] });
		}
	}

	return { finesses, playables };
}

/**
 * @param  {Player} player
 * @param  {Player} hypo_player
 * @param  {Hand} hand
 */
export function cm_result(player, hypo_player, hand) {
	return hand.filter(c => hypo_player.thoughts[c.order].chop_moved && !player.thoughts[c.order].chop_moved);
}
