import { ActualCard, Card } from './basics/Card.js';
import { cardCount, find_possibilities } from './variants.js';

import * as Utils from './tools/util.js';
import { produce } from './StateProxy.js';

/**
 * @typedef {import('./basics/Game.js').Game} Game
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * Impure!
 * @param {Game} game
 * @param {ClueAction} action
 */
export function onClue(game, action) {
	const { state } = game;
	const { target, clue, list, giver } = action;
	const new_possible = find_possibilities(clue, state.variant);

	/** @param {import('./types.js').Writable<ActualCard>} card */
	const update_func = (card) => {
		if (!card.clued) {
			card.newly_clued = true;
			card.clued = true;
		}
		card.clues.push(Object.assign({}, clue, { giver, turn: state.turn_count }));
	};

	for (const order of state.hands[target]) {
		const index = state.hands[target].findIndex(o => o === order);

		if (list.includes(order)) {
			state.deck[order] = produce(state.deck[order], update_func);
			state.hands[target] = state.hands[target].with(index, order);
		}

		for (const player of game.allPlayers) {
			const { possible, inferred } = player.thoughts[order];

			const operation = list.includes(order) ? 'intersect' : 'subtract';
			const new_inferred = inferred[operation](new_possible);

			player.updateThoughts(order, (draft) => {
				if (list.includes(order))
					update_func(draft);

				draft.possible = possible[operation](new_possible);
				draft.inferred = new_inferred;

				if (list.includes(order) && new_inferred.length < inferred.length) {
					draft.reasoning.push(state.actionList.length - 1);
					draft.reasoning_turn.push(state.turn_count);
				}
			});
		}
	}

	game.common.card_elim(state);
	game.common.refresh_links(state);

	if (state.endgameTurns !== -1)
		state.endgameTurns--;

	state.clue_tokens--;
}

/**
 * Impure!
 * @param {Game} game
 * @param {DiscardAction} action
 */
export function onDiscard(game, action) {
	const { state } = game;
	const { failed, order, playerIndex, rank, suitIndex } = action;
	const identity = { suitIndex, rank };

	state.hands[playerIndex] = state.hands[playerIndex].toSpliced(state.hands[playerIndex].indexOf(order), 1);

	if (suitIndex !== -1 && rank !== -1) {
		state.discard_stacks[suitIndex][rank - 1]++;
		state.deck[order] = produce(state.deck[order], Utils.assignId({ suitIndex, rank }));

		for (const player of game.allPlayers) {
			const { possible, inferred } = player.thoughts[order];
			player.updateThoughts(order, (draft) => {
				draft.suitIndex = suitIndex;
				draft.rank = rank;
				draft.old_possible = possible;
				draft.old_inferred = inferred;
				draft.possible = possible.intersect(identity);
				draft.inferred = inferred.intersect(identity);
			});
		}

		game.common.card_elim(state);
		game.common.refresh_links(state);

		// Discarded all copies of a card - the new max rank is (discarded rank - 1) if not already lower
		if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, { suitIndex, rank }))
			state.max_ranks[suitIndex] = Math.min(state.max_ranks[suitIndex], rank - 1);
	}

	if (state.endgameTurns !== -1)
		state.endgameTurns--;

	if (failed)
		state.strikes++;
	else
		state.clue_tokens = Math.min(state.clue_tokens + 1, 8);		// Bombs count as discards, but they don't give a clue token
}

/**
 * Impure!
 * @param {Game} game
 * @param {DrawAction} action
 */
export function onDraw(game, action) {
	const { state } = game;
	const { order, playerIndex, suitIndex, rank } = action;

	state.hands[playerIndex].unshift(order);
	state.deck[order] = Object.freeze(new ActualCard(suitIndex, rank, order, state.actionList.length));

	for (let i = 0; i < state.numPlayers; i++) {
		const player = game.players[i];

		player.thoughts[order] = Object.freeze(new Card(
			(i !== playerIndex || i === state.ourPlayerIndex) ? suitIndex : -1,
			(i !== playerIndex || i === state.ourPlayerIndex) ? rank : -1,
			player.all_possible,
			player.all_possible,
			order,
			state.actionList.length));
	}

	game.players.forEach(player => {
		player.card_elim(state);
		player.refresh_links(state);
	});

	game.common.thoughts[order] = Object.freeze(new Card(-1, -1, game.common.all_possible, game.common.all_possible, order, state.actionList.length));
	game.common.card_elim(state);
	game.common.refresh_links(state);

	state.cardOrder = order;
	state.cardsLeft--;

	if (state.cardsLeft === 0)
		state.endgameTurns = state.numPlayers;
}

/**
 * Impure!
 * @param {Game} game
 * @param {PlayAction} action
 */
export function onPlay(game, action) {
	const { state } = game;
	const { order, playerIndex, rank, suitIndex } = action;
	const identity = { suitIndex, rank };

	state.hands[playerIndex] = state.hands[playerIndex].toSpliced(state.hands[playerIndex].indexOf(order), 1);

	if (suitIndex !== undefined && rank !== undefined) {
		state.play_stacks[suitIndex] = rank;
		state.deck[order] = produce(state.deck[order], Utils.assignId({ suitIndex, rank }));

		for (const player of game.allPlayers) {
			const { possible, inferred } = player.thoughts[order];

			player.updateThoughts(order, (draft) => {
				draft.suitIndex = suitIndex;
				draft.rank = rank;
				draft.old_possible = possible;
				draft.old_inferred = inferred;
				draft.possible = possible.intersect(identity);
				draft.inferred = inferred.intersect(identity);
			});
		}

		game.common.card_elim(state);
		game.common.refresh_links(state);
	}

	if (state.endgameTurns !== -1)
		state.endgameTurns--;

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8)
		state.clue_tokens++;
}
