import * as https from 'https';
import * as fs from 'fs';

import HGroup from './conventions/h-group.js';
import PlayfulSieve from './conventions/playful-sieve.js';

import { ACTION, END_CONDITION } from './constants.js';
import { getShortForms, getVariant } from './variants.js';

import { initConsole } from './tools/console.js';
import * as Utils from './tools/util.js';
import { State } from './basics/State.js';
import { HANABI_HOSTNAME } from './constants.js';

const conventions = {
	HGroup,
	PlayfulSieve
};

/**
 * Fetches a replay from hanab.live, given its id.
 * @param {string} id
 */
function fetchReplay(id) {
	return new Promise((resolve, reject) => {
		const req = https.request(`https://${HANABI_HOSTNAME}/export/${id}`, (res) => {
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
	const { id, file, level, index, convention = 'HGroup' } = Utils.parse_args();
	initConsole();

	let game_data;

	if (id !== undefined && file !== undefined)
		throw new Error('Both id and file provided, only provide one.');

	try {
		game_data = id !== undefined ? await fetchReplay(id) : JSON.parse(fs.readFileSync(file, 'utf8'));
	}
	catch (err) {
		throw new Error(err);
	}

	let order = 0;

	const { players, deck, actions, options = {} } = game_data;
	const variant = await getVariant(options?.variant ?? 'No Variant');
	const ourPlayerIndex = Number(index ?? 0);

	if (ourPlayerIndex < 0 || ourPlayerIndex >= players.length)
		throw new Error(`Replay only has ${players.length} players!`);

	if (!(convention in conventions))
		throw new Error(`Convention ${convention} is not supported.`);

	await getShortForms(variant);

	const state = new State(players, ourPlayerIndex, variant, options);
	const game = new conventions[/** @type {keyof typeof conventions} */(convention)](Number(id), state, false, Number(level ?? 1));
	game.catchup = true;

	Utils.globalModify({ game, cache: new Map() });

	// Draw cards in starting hands
	for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
		for (let i = 0; i < state.handSize; i++) {
			const { suitIndex, rank } = playerIndex !== state.ourPlayerIndex ? deck[order] : { suitIndex: -1, rank: -1 };
			game.handle_action({ type: 'draw', playerIndex, order, suitIndex, rank });
			order++;
		}
	}

	let currentPlayerIndex = 0, turn = 0;

	// Take actions
	for (const action of actions) {
		if (turn !== 0)
			game.handle_action({ type: 'turn', num: turn, currentPlayerIndex });

		game.handle_action(Utils.performToAction(game.state, action, currentPlayerIndex, deck));

		if ((action.type === ACTION.PLAY || action.type === ACTION.DISCARD) && order < deck.length) {
			const { suitIndex, rank } = currentPlayerIndex !== state.ourPlayerIndex ? deck[order] : { suitIndex: -1, rank: -1 };
			game.handle_action({ type: 'draw', playerIndex: currentPlayerIndex, order, suitIndex, rank });
			order++;
		}

		if (action.type === ACTION.PLAY && game.state.strikes === 3)
			game.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.STRIKEOUT, votes: -1 });

		currentPlayerIndex = state.nextPlayerIndex(currentPlayerIndex);
		turn++;
	}

	if (actions.at(-1).type !== 'gameOver')
		game.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.NORMAL, votes: -1 });

	game.catchup = false;
}

main();
