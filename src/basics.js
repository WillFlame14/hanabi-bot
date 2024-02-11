import { ActualCard, Card } from './basics/Card.js';
import { cardCount } from './variants.js';
import { find_possibilities } from './basics/helper.js';

/**
 * @typedef {import('./basics/State.js').State} State
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
	const new_possible = find_possibilities(clue, state.variant);

	for (const { order } of state.hands[target]) {
		const c = state.hands[target].findOrder(order);

		if (list.includes(order)) {
			if (!c.clued) {
				c.newly_clued = true;
				c.clued = true;
			}
			c.clues.push(clue);
		}

		for (const player of state.allPlayers) {
			const card = player.thoughts[order];
			const inferences_before = card.inferred.length;

			const operation = list.includes(order) ? 'intersect' : 'subtract';
			card[operation]('possible', new_possible);
			card[operation]('inferred', new_possible);

			if (list.includes(order) && card.inferred.length < inferences_before) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}

			player.card_elim(state);
			player.refresh_links(state);
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

	for (const player of state.allPlayers) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Discarded all copies of a card - the new max rank is (discarded rank - 1) if not already lower
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits, state.variant, { suitIndex, rank }))
		state.max_ranks[suitIndex] = Math.min(state.max_ranks[suitIndex], rank - 1);

	if (failed)
		state.strikes++;
	else
		state.clue_tokens = Math.min(state.clue_tokens + 1, 8);		// Bombs count as discards, but they don't give a clue token
}

/**
 * @param {State} state
 * @param {DrawAction} action
 */
export function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;

	const card = new ActualCard(suitIndex, rank, order, state.actionList.length);
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
	}

	state.players.forEach(player => {
		player.card_elim(state);
		player.refresh_links(state);
	});

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

	for (const player of state.allPlayers) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8)
		state.clue_tokens++;
}
