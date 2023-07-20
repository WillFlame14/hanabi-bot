import * as https from 'https';

import { ACTION, CLUE, END_CONDITION, HAND_SIZE } from './constants.js';
import { Card } from './basics/Card.js';
import { Hand } from './basics/Hand.js';

import HGroup from './conventions/h-group.js';
import { fetchVariants, getVariant } from './variants.js';
import { initConsole } from './tools/console.js';
import * as Utils from './tools/util.js';

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

async function main() {
	const { id, level, index } = Utils.parse_args();
	fetchVariants();
	initConsole();

	let game_data;

	try {
		game_data = await fetchReplay(id);
	}
	catch (err) {
		throw new Error(err);
	}

	let order = 0;

	const { players, deck, actions, options } = game_data;
	const variant = await getVariant(options?.variant ?? 'No Variant');
	const ourPlayerIndex = Number(index ?? 0);

	if (ourPlayerIndex < 0 || ourPlayerIndex >= players.length) {
		throw new Error(`Replay only has ${players.length} players!`);
	}

	const state = new HGroup(Number(id), players, ourPlayerIndex, variant.suits, false, Number(level ?? 1));

	Utils.globalModify({state});

	const handSize = HAND_SIZE[state.numPlayers] + (options?.oneLessCard ? -1 : options?.oneMoreCard ? 1 : 0);

	// Draw cards in starting hands
	for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
		for (let i = 0; i < handSize; i++) {
			const { suitIndex, rank } = playerIndex !== state.ourPlayerIndex ? deck[order] : { suitIndex: -1, rank: -1 };
			state.handle_action({ type: 'draw', playerIndex, order, suitIndex, rank }, true);
			order++;
		}
	}

	let currentPlayerIndex = 0, turn = 0;

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
		}

		if (action.type === ACTION.PLAY && state.strikes === 3) {
			state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.STRIKEOUT, votes: -1 });
		}
		currentPlayerIndex = (currentPlayerIndex + 1) % state.numPlayers;
		turn++;
	}

	if (actions.at(-1).type !== 'gameOver') {
		state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.NORMAL, votes: -1 });
	}
}

/**
 * [get_own_hand description]
 * @param  {State} state
 * @param  {BasicCard[]} deck
 */
function get_own_hand(state, deck) {
	const ind = state.ourPlayerIndex;
	return new Hand(state, ind, ...state.hands[ind].map(c => new Card(deck[c.order].suitIndex, deck[c.order].rank, { order: c.order })));
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
			const hand = target === state.ourPlayerIndex ? get_own_hand(state, deck) : state.hands[target];
			const list = Array.from(hand.clueTouched(clue).map(c => c.order));

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.COLOUR: {
			const clue = { type: CLUE.COLOUR, value };
			const hand = target === state.ourPlayerIndex ? get_own_hand(state, deck) : state.hands[target];
			const list = Array.from(hand.clueTouched(clue).map(c => c.order));

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.END_GAME: {
			return { type: 'gameOver', playerIndex: target, endCondition: value, votes: -1 };
		}
	}
}

main();
