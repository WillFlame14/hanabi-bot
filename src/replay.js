import * as https from 'https';
import * as fs from 'fs';

import { ACTION, END_CONDITION } from './constants.js';

import { getHandSize } from './basics/helper.js';
import HGroup from './conventions/h-group.js';
import PlayfulSieve from './conventions/playful-sieve.js';
import { getShortForms, getVariant } from './variants.js';
import { initConsole } from './tools/console.js';
import * as Utils from './tools/util.js';

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


	if (conventions[convention] === undefined)
		throw new Error(`Convention ${convention} is not supported.`);

	await getShortForms(variant);

	const state = new conventions[convention](Number(id), players, ourPlayerIndex, variant, options, false, Number(level ?? 1));

	Utils.globalModify({state});

	const handSize = getHandSize(state);

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
		if (turn !== 0)
			state.handle_action({ type: 'turn', num: turn, currentPlayerIndex }, true);

		state.handle_action(Utils.performToAction(state, action, currentPlayerIndex, deck), true);

		if ((action.type === ACTION.PLAY || action.type === ACTION.DISCARD) && order < deck.length) {
			const { suitIndex, rank } = (currentPlayerIndex !== state.ourPlayerIndex) ? deck[order] : { suitIndex: -1, rank: -1 };
			state.handle_action({ type: 'draw', playerIndex: currentPlayerIndex, order, suitIndex, rank }, true);
			order++;
		}

		if (action.type === ACTION.PLAY && state.strikes === 3)
			state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.STRIKEOUT, votes: -1 });

		currentPlayerIndex = (currentPlayerIndex + 1) % state.numPlayers;
		turn++;
	}

	if (actions.at(-1).type !== 'gameOver')
		state.handle_action({ type: 'gameOver', playerIndex: currentPlayerIndex, endCondition: END_CONDITION.NORMAL, votes: -1 });

}

main();
