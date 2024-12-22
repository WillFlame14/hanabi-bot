import * as readline from 'readline';
import { ACTION } from '../constants.js';
import { handle } from '../command-handler.js';
import * as Utils from './util.js';

import logger from './logger.js';
import { logHand, logLinks } from './log.js';

/**
 * Initializes the console interactivity with the game state.
 */
export function initConsole() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY)
		process.stdin.setRawMode(true);

	let command = [];

	process.stdin.on('keypress', (_, key) => {
		if (key.ctrl && key.name === 'c')
			process.exit();

		if (key.sequence === '\x7F')
			key.sequence = '\b';

		process.stdout.write(key.sequence);
		switch(key.sequence) {
			case '\r':
			case '\n': {
				logger.info();
				const parts = command.join('').split(' ');

				if (parts[0] !== 'spectate' && Utils.globals.game?.state === undefined && parts[0] !== 'rejoin') {
					logger.error('No game specified. Try loading a replay or joining a game first.');
					command = [];
					return;
				}

				/** @type {import('../basics/Game.js').Game} */
				const game = Utils.globals.game;

				/** @type {import('../basics/State.js').State} */
				const state = game?.state;

				switch(parts[0]) {
					case 'hand': {
						if (parts.length < 2 || parts.length > 3) {
							logger.warn('Correct usage is "hand <playerName> [<playerIndex>]"');
							break;
						}
						const playerName = parts[1];
						if (!game.state.playerNames.includes(playerName)) {
							logger.error('That player is not in this room.');
							console.log(state.playerNames, playerName);
							break;
						}
						const playerIndex = state.playerNames.indexOf(playerName);
						const player = !isNaN(Number(parts[2])) ? game.players[Number(parts[2])] : undefined;
						console.log('viewing from', player === undefined ? 'common' : state.playerNames[player.playerIndex]);
						console.log(logHand(state.hands[playerIndex], player), logLinks(game.players[playerIndex].links));
						break;
					}
					case 'state':
						console.log(state[parts[1]]);
						break;
					case 'navigate':
					case 'nav': {
						if (parts.length !== 2) {
							logger.warn('Correct usage is "navigate <turn>"');
							break;
						}

						if (game.in_progress) {
							logger.warn('Cannot navigate while game is in progress.');
							break;
						}

						const turn = parts[1] === '+' ? state.turn_count + 1 :
									parts[1] === '++' ? state.turn_count + state.numPlayers :
									parts[1] === '-' ? state.turn_count - 1 :
									parts[1] === '--' ? state.turn_count - state.numPlayers :
										Number(parts[1]);

						if (isNaN(turn)) {
							logger.warn('Please provide a valid turn number.');
							break;
						}

						const maxTurn = state.actionList.reduce((max, action) => Math.max(max, action.type === 'turn' ? action.num + 2 : -1), 0);

						if (turn < 1 || turn > maxTurn) {
							logger.error(`Turn ${turn} does not exist.`);
							break;
						}

						const new_game = game.navigate(turn);
						Object.assign(game, new_game);
						break;
					}
					case 'spectate':
						if (parts.length < 2) {
							logger.warn('Correct usage is "spectate <tableID> [shadowingPlayerIndex=-1]"');
							break;
						}

						if (parts.length === 3 && isNaN(Number(parts[2])))
							logger.warn('Please provide a valid shadowing player index.');

						Utils.sendCmd('tableSpectate', { tableID: Number(parts[1]), shadowingPlayerIndex: Number(parts[2] ?? -1) });
						break;
					case 'unattend':
						Utils.sendCmd('tableUnattend', { tableID: game.tableID });
						break;
					case 'chat':
						// @ts-ignore
						handle.chat({ msg: parts[1], who: Utils.globals.username });
						break;
					case 'play': {
						const slot = Number(parts[1]);

						if (state.ourHand[slot - 1] === undefined) {
							logger.warn('Invalid slot', slot - 1, 'provided');
							break;
						}

						Utils.sendCmd('action', { tableID: game.tableID, type: ACTION.PLAY, target: state.ourHand[slot - 1] });
						break;
					}
					case 'discard': {
						const slot = Number(parts[1]);

						if (state.ourHand[slot - 1] === undefined) {
							logger.warn('Invalid slot', slot - 1, 'provided');
							break;
						}

						Utils.sendCmd('action', { tableID: game.tableID, type: ACTION.DISCARD, target: state.ourHand[slot - 1] });
						break;
					}
					case 'clue': {
						const target = state.playerNames.findIndex(p => p === parts[1]);
						const type = parts[2] === 'rank' ? ACTION.RANK : ACTION.COLOUR;
						const value = Number(parts[3]);
						Utils.sendCmd('action', { tableID: game.tableID, type, target, value });
						break;
					}
					default:
						logger.warn('Command not recognized.');
				}
				command = [];
				break;
			}
			case '\b':
				command = command.slice(0, -1);
				break;
			default:
				command.push(key.sequence);
				break;
		}
	});
}
