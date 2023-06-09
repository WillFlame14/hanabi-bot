import * as https from 'https';

import { ACTION, CLUE, END_CONDITION } from './constants.js';
import { Card } from './basics/Card.js';
import { Hand } from './basics/Hand.js';

import HGroup from './conventions/h-group.js';
import { fetchVariants, getVariant } from './variants.js';
import * as Utils from './util.js';

/**
 * @typedef {import('./types.js').Action} Action
 * @typedef {import('./types.js').PerformAction} PerformAction
 * @typedef {import('./types.js').BasicCard} BasicCard
 * @typedef {import('./basics/State.js').State} State
 */

function fetchReplay(id) {
	return new Promise((resolve, reject) => {
		const req = https.request(`https://hanab.live/export/${id}`, (res) => {
			console.log(`Request status code: ${res.statusCode}`);
			let raw_data = '';

			res.on('data', (chunk) => raw_data += chunk);
			res.on('end', () => {
				try {
					const data = JSON.parse(raw_data);
					resolve(data);
				}
				catch (err) {
					reject(err);
				}
			});
		});

		req.on('error', (error) => {
			reject(`Request error: ${error}`);
			return;
		});

		req.end();
	});
}

const HAND_SIZE = [-1, -1, 5, 5, 4, 4, 3];

async function main() {
	const { id, level, index } = Utils.parse_args();
	fetchVariants();
	Utils.initConsole();

	let game_data;

	try {
		game_data = await fetchReplay(id);
	}
	catch (err) {
		console.error(err);
		return;
	}

	let order = 0;

	const { players, deck, actions, options } = game_data;
	const variant = await getVariant(options?.variant ?? 'No Variant');
	const state = new HGroup(Number(id), players, Number(index ?? 0), variant.suits, false, Number(level ?? 1));

	Utils.globalModify({state});

	// Draw cards in starting hands
	for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
		for (let i = 0; i < HAND_SIZE[state.numPlayers]; i++) {
			const { suitIndex, rank } = playerIndex !== state.ourPlayerIndex ? deck[order] : { suitIndex: -1, rank: -1 };
			state.handle_action({ type: 'draw', playerIndex, order, suitIndex, rank }, true);
			order++;
		}
	}

	let currentPlayerIndex = 0, turn = 0, final_turn;

	// Take actions
	for (const action of actions) {
		if (turn !== 0) {
			state.handle_action({ type: 'turn', num: turn, currentPlayerIndex }, true);
		}
		state.handle_action(parse_action(state, action, currentPlayerIndex, deck), true);

		if ((action.type === ACTION.PLAY || action.type === ACTION.DISCARD) && order < deck.length) {
			const { suitIndex, rank } = (currentPlayerIndex !== state.ourPlayerIndex) ? deck[order] : { suitIndex: -1, rank: -1 };
			state.handle_action({ type: 'draw', playerIndex: currentPlayerIndex, order, suitIndex, rank }, true);
			order++;

			if (order === deck.length) {
				final_turn = turn + state.numPlayers;
			}
		}

		if (action.type === ACTION.PLAY && state.strikes === 3) {
			state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.STRIKEOUT, votes: -1 });
		}
		currentPlayerIndex = (currentPlayerIndex + 1) % state.numPlayers;
		turn++;
	}

	const max_score_achieved = state.play_stacks.reduce((acc, stack) => acc += stack) === state.max_ranks.reduce((acc, stack) => acc += stack);
	if (turn === final_turn + 1 || max_score_achieved) {
		state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.NORMAL, votes: -1 });
	}
}

/**
 * [parse_action description]
 * @param  {State} state
 * @param  {PerformAction} action
 * @param  {number} playerIndex
 * @param  {BasicCard[]} deck
 * @return {Action}
 */
function parse_action(state, action, playerIndex, deck) {
	const { type, target, value } = action;

	switch(type) {
		case ACTION.PLAY: {
			const { suitIndex, rank } = deck[target];

			if (state.play_stacks[suitIndex] + 1 === rank) {
				return { type: 'play', playerIndex, order: target, suitIndex, rank };
			}
			else {
				return { type: 'discard', playerIndex, order: target, suitIndex, rank, failed: true };
			}
		}
		case ACTION.DISCARD: {
			const { suitIndex, rank } = deck[target];
			return { type: 'discard', playerIndex, order: target, suitIndex, rank, failed: false };
		}
		case ACTION.RANK: {
			const clue = { type: CLUE.RANK, value };
			const hand = target === state.ourPlayerIndex ?
				new Hand(...state.hands[target].map(c => new Card(deck[c.order].suitIndex, deck[c.order].rank, { order: c.order }))) :
				state.hands[target];
			const list = hand.clueTouched(state.suits, clue).map(c => c.order);

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.COLOUR: {
			const clue = { type: CLUE.COLOUR, value };
			const hand = target === state.ourPlayerIndex ?
				new Hand(...state.hands[target].map(c => new Card(deck[c.order].suitIndex, deck[c.order].rank, { order: c.order }))) :
				state.hands[target];
			const list = hand.clueTouched(state.suits, clue).map(c => c.order);

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.END_GAME: {
			return { type: 'gameOver', playerIndex: target, endCondition: value, votes: -1 };
		}
	}
}

main();
