import { ActualCard, Card } from './basics/Card.js';
import { cardCount, find_possibilities } from './variants.js';

/**
 * @typedef {import('./basics/Game.js').Game} Game
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * @param {Game} game
 * @param {ClueAction} action
 */
export function onClue(game, action) {
	const { state } = game;
	const { target, clue, list, giver } = action;
	const new_possible = find_possibilities(clue, state.variant);

	for (const { order } of state.hands[target]) {
		const c = state.hands[target].findOrder(order);

		if (list.includes(order)) {
			if (!c.clued) {
				c.newly_clued = true;
				c.clued = true;
			}
			c.clues.push(Object.assign({}, clue, { giver }));
		}

		for (const player of game.allPlayers) {
			const card = player.thoughts[order];
			const inferences_before = card.inferred.length;

			const operation = list.includes(order) ? 'intersect' : 'subtract';
			card.possible = card.possible[operation](new_possible);
			card.inferred = card.inferred[operation](new_possible);

			if (list.includes(order) && card.inferred.length < inferences_before) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}
		}
	}

	for (const player of game.allPlayers) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	state.clue_tokens--;
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 */
export function onDiscard(game, action) {
	const { state } = game;
	const { failed, order, playerIndex, rank, suitIndex } = action;

	state.hands[playerIndex] = state.hands[playerIndex].removeOrder(order);
	state.discard_stacks[suitIndex][rank - 1]++;
	Object.assign(state.deck[order], { suitIndex, rank });

	for (const player of game.allPlayers) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Discarded all copies of a card - the new max rank is (discarded rank - 1) if not already lower
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, { suitIndex, rank }))
		state.max_ranks[suitIndex] = Math.min(state.max_ranks[suitIndex], rank - 1);

	if (failed)
		state.strikes++;
	else
		state.clue_tokens = Math.min(state.clue_tokens + 1, 8);		// Bombs count as discards, but they don't give a clue token
}

/**
 * @param {Game} game
 * @param {DrawAction} action
 */
export function onDraw(game, action) {
	const { state } = game;
	const { order, playerIndex, suitIndex, rank } = action;

	const card = new ActualCard(suitIndex, rank, order, state.actionList.length);
	state.hands[playerIndex].unshift(card);
	state.deck[order] = card;

	for (let i = 0; i < state.numPlayers; i++) {
		const player = game.players[i];

		player.thoughts[order] = new Card(card, {
			suitIndex: (i !== playerIndex || i === state.ourPlayerIndex) ? suitIndex : -1,
			rank: (i !== playerIndex || i === state.ourPlayerIndex) ? rank : -1,
			order,
			possible: player.all_possible,
			inferred: player.all_possible,
			drawn_index: state.actionList.length
		});
	}

	game.players.forEach(player => {
		player.card_elim(state);
		player.refresh_links(state);
	});

	game.common.thoughts[order] = new Card(card, {
		suitIndex: -1,
		rank: -1,
		order,
		possible: game.common.all_possible,
		inferred: game.common.all_possible,
		drawn_index: state.actionList.length
	});

	state.cardOrder = order;
	state.cardsLeft--;
}

/**
 * @param {Game} game
 * @param {PlayAction} action
 */
export function onPlay(game, action) {
	const { state } = game;
	const { order, playerIndex, rank, suitIndex } = action;

	state.hands[playerIndex] = state.hands[playerIndex].removeOrder(order);
	state.play_stacks[suitIndex] = rank;
	Object.assign(state.deck[order], { suitIndex, rank });

	for (const player of game.allPlayers) {
		player.card_elim(state);
		player.refresh_links(state);
	}

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8)
		state.clue_tokens++;
}
