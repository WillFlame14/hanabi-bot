import * as readline from 'readline';
import logger from './logger.js';
import { logHand } from './log.js';
import * as Utils from './util.js';

/**
 * Initializes the console interactivity with the game state.
 */
export function initConsole() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	let command = [];

	process.stdin.on('keypress', (_, key) => {
		if (key.ctrl && key.name === 'c') {
			process.exit();
		}

		if (key.sequence === '\x7F') {
			key.sequence = '\b';
		}

		process.stdout.write(key.sequence);
		switch(key.sequence) {
			case '\r':
			case '\n': {
				logger.info();
				const parts = command.join('').split(' ');

				if (parts[0] !== 'spectate' && Utils.globals.state === undefined) {
					logger.error('No game specified. Try loading a replay or joining a game first.');
					command = [];
					return;
				}

				/** @type {import('../basics/State.js').State} */
				const state = Utils.globals.state;

				switch(parts[0]) {
					case 'hand': {
						if (parts.length !== 2) {
							logger.warn('Correct usage is "hand <playerName>"');
							break;
						}
						const playerName = parts[1];
						if (!state.playerNames.includes(playerName)) {
							logger.error('That player is not in this room.');
							console.log(state.playerNames, playerName);
							break;
						}
						const playerIndex = state.playerNames.indexOf(playerName);
						console.log(logHand(state.hands[playerIndex]));
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

						if (state.in_progress) {
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

						if (!state.actionList.some(action => action.type === 'turn' && action.num === turn)) {
							logger.error(`Turn ${turn} does not exist.`);
							break;
						}

						state.navigate(turn);
						break;
					}
					case 'spectate':
						if (parts.length < 2) {
							logger.warn('Correct usage is "spectate <tableID> [shadowingPlayerIndex=-1]"');
							break;
						}

						if (parts.length === 3 && isNaN(Number(parts[2]))) {
							logger.warn('Please provide a valid shadowing player index.');
						}

						Utils.sendCmd('tableSpectate', { tableID: Number(parts[1]), shadowingPlayerIndex: Number(parts[2] ?? -1) });
						break;
					case 'unattend':
						Utils.sendCmd('tableUnattend', { tableID: state.tableID });
						break;
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
