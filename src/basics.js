import { ActualCard, Card } from './basics/Card.js';
import { cardCount } from './variants.js';
import { find_possibilities } from './basics/helper.js';
import logger from './tools/logger.js';
import { logCard } from './tools/log.js';

/**
 * @typedef {import('./basics/State.js').State} State
 * @typedef {import('./basics/Player.js').Player} Player
 * @typedef {import('./types.js').Identity} Identity
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * @param {State} state
 * @param {ClueAction} action
 */
export function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.suits);

	for (const { order } of state.hands[target]) {
		const c = state.hands[target].findOrder(order);

		if (list.includes(order) && !c.clued) {
			c.newly_clued = true;
			c.clued = true;
			c.clues.push(clue);
		}

		for (const player of state.players.concat([state.common])) {
			const card = player.thoughts[order];
			const previously_unknown = card.possible.length > 1;

			if (list.includes(order)) {
				card.intersect('possible', new_possible);
				card.intersect('inferred', new_possible);
			}
			else {
				card.subtract('possible', new_possible);
				card.subtract('inferred', new_possible);
			}

			// If card is now known to everyone and wasn't previously - eliminate
			if (previously_unknown && card.possible.length === 1) {
				player.card_elim(state);
				player.refresh_links(state);
			}
		}
	}

	state.clue_tokens--;
}

/**
 * @param {State} state
 * @param {DiscardAction} action
 */
export function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.discard_stacks[suitIndex][rank - 1]++;

	// Card is now definitely known to everyone - eliminate
	for (const player of state.players.concat([state.common])) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits, { suitIndex, rank }) && state.max_ranks[suitIndex] > rank - 1) {
		state.max_ranks[suitIndex] = rank - 1;
	}

	if (failed) {
		state.strikes++;
	}

	// Bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {DrawAction} action
 */
export function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new ActualCard(
		suitIndex,
		rank,
		order,
		state.actionList.length
	);
	state.hands[playerIndex].unshift(card);

	for (let i = 0; i < state.numPlayers; i++) {
		const player = state.players[i];

		player.thoughts[order] = new Card(card, {
			suitIndex: (i !== playerIndex) ? suitIndex : -1,
			rank: (i !== playerIndex) ? rank : -1,
			order,
			possible: player.all_possible.slice(),
			inferred: player.all_inferred.slice(),
			drawn_index: state.actionList.length
		});

		// If we know what the card is, everyone (except player that drew) can eliminate
		if (playerIndex !== state.ourPlayerIndex && i !== playerIndex) {
			player.card_elim(state);
			player.refresh_links(state);
		}
	}

	state.common.thoughts[order] = new Card(card, {
		suitIndex: -1,
		rank: -1,
		order,
		possible: state.common.all_possible.slice(),
		inferred: state.common.all_inferred.slice(),
		drawn_index: state.actionList.length
	});

	state.cardOrder = order;
	state.cardsLeft--;
}

/**
 * @param {State} state
 * @param {PlayAction} action
 */
export function onPlay(state, action) {
	const { order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.play_stacks[suitIndex] = rank;

	// Card is now definitely known to everyone - eliminate
	for (const player of state.players.concat([state.common])) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}
