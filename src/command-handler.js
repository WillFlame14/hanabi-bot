import { getVariant } from './variants.js';
import logger from './tools/logger.js';
import * as Utils from './tools/util.js';

import HGroup from './conventions/h-group.js';

/**
 * @typedef {import('./basics/State.js').State} State
 */

const conventions = { HGroup };

let self;
const tables = {};

let state = /** @type {State} */ ({});

/** @type {boolean} */
let gameStarted = false;

const settings = {
	convention: 'HGroup',
	level: 1
};

export const handle = {
	// Received when any message in chat is sent
	chat: (data) => {
		// Sent in room
		if (data.recipient === '' && data.room.startsWith('table')) {
			if (data.msg.startsWith('/setall')) {
				assignSettings(data, false);
			}
			else if (data.msg.startsWith('/leaveall')) {
				Utils.sendCmd(gameStarted ? 'tableUnattend' : 'tableLeave', { tableID: state.tableID });
				gameStarted = false;
			}
		}
		// Private messages to us
		else if (data.recipient === self.username) {
			// Invites the bot to a lobby (format: /join [password])
			if (data.msg.startsWith('/join')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (!table.sharedReplay && (table.players.includes(data.who) || table.spectators.some(spec => spec.name === data.who))) {
						if (table.running || table.players.length === 6) {
							continue;
						}

						const ind = data.msg.indexOf(' ');
						const password = ind != -1 ? data.msg.slice(ind + 1) : undefined;
						Utils.sendCmd('tableJoin', { tableID: table.id, password });
						return;
					}
				}

				// Table not found
				Utils.sendPM(data.who, 'Could not join. Check that the room is not full and the game has not started.');
			}
			// Readds the bot to a game (format: /rejoin)
			else if (data.msg.startsWith('/rejoin')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (table && !table.sharedReplay && (table.players.includes(data.who) || table.spectators.some(spec => spec.name === data.who))) {
						if (!table.players.includes(self.username)) {
							Utils.sendPM(data.who, 'Could not join, as the bot was never a player in this room.');
							return;
						}

						logger.info(table);
						Utils.sendCmd('tableReattend', { tableID: table.id });
						return;
					}
				}

				// Table not found
				Utils.sendPM(data.who, 'Could not rejoin, as you are not in a room.');
			}
			// Kicks the bot from a game (format: /leave)
			else if (data.msg.startsWith('/leave')) {
				Utils.sendCmd(gameStarted ? 'tableUnattend' : 'tableLeave', { tableID: state.tableID });
				gameStarted = false;
			}
			// Creates a new table (format: /create <name> <maxPlayers> <password>)
			else if (data.msg.startsWith('/create')) {
				const parts = data.msg.split(' ');
				Utils.sendCmd('tableCreate', { name: parts[1], maxPlayers: Number(parts[2]), password: parts[3] });
			}
			// Starts the game (format: /start)
			else if (data.msg.startsWith('/start')) {
				Utils.sendCmd('tableStart', { tableID: state.tableID });
			}
			// Restarts a game (format: /restart)
			else if (data.msg.startsWith('/restart')) {
				Utils.sendCmd('tableRestart', { tableID: state.tableID, hidePregame: true });
			}
			// Remakes a table (format: /remake)
			else if (data.msg.startsWith('/remake')) {
				Utils.sendCmd('tableRestart', { tableID: state.tableID, hidePregame: false });
			}
			// Displays or modifies the current settings (format: /settings [convention = 'HGroup'] [level = 1])
			else if (data.msg.startsWith('/settings')) {
				assignSettings(data, true);
			}
		}
	},
	// Received when an action is taken in the current active game
	gameAction: (data, catchup = false) => {
		const { action } = data;
		state.handle_action(action, catchup);

		if (action.type === 'gameOver') {
			gameStarted = false;
		}
	},
	// Received at the beginning of the game, as a list of all actions that have happened so far
	gameActionList: (data) => {
		for (let i = 0; i < data.list.length - 10; i++) {
			handle.gameAction({ action: data.list[i], tableID: data.tableID }, true);
		}
		for (let i = data.list.length - 10; i < data.list.length - 1; i++) {
			handle.gameAction({ action: data.list[i], tableID: data.tableID });
		}
		handle.gameAction({ action: data.list.at(-1), tableID: data.tableID });

		// Send "loaded" to let server know that we have "finished loading the UI"
		Utils.sendCmd('loaded', { tableID: data.tableID });

		// If we are going first, we need to take an action now
		if (state.ourPlayerIndex === 0 && state.turn_count === 1) {
			setTimeout(() => Utils.sendCmd('action', state.take_action(state)), 3000);
		}
	},
	joined: (data) => {
		const { tableID } = data;
		state.tableID = tableID;
	},
	// Received at the beginning of the game, with information about the game
	init: async (data) => {
		const { tableID, playerNames, ourPlayerIndex, options } = data;
		const variant = await getVariant(options.variantName);

		// Initialize game state using convention set
		state = new conventions[settings.convention](tableID, playerNames, ourPlayerIndex, variant.suits, true, settings.level);

		Utils.globalModify({state});

		// Ask the server for more info
		Utils.sendCmd('getGameInfo2', { tableID: data.tableID });
	},
	left: () => {
		state.tableID = undefined;
		gameStarted = false;
	},
	// Received when a table updates its information
	table: (data) => {
		tables[data.id] = data;
	},
	// Received when a table is removed
	tableGone: (data) => {
		tables[data.id] = undefined;
	},
	// Received once, with a list of the current tables and their information
	tableList: (data) => {
		for (const table of data) {
			tables[table.id] = table;
		}
	},
	// Received when the current table starts a game
	tableStart: (data) => {
		Utils.sendCmd('getGameInfo1', { tableID: data.tableID });
		gameStarted = true;
	},
	// Received when we send an invalid command
	warning: (warn) => logger.error(warn),
	// Received when we first register a websocket
	welcome: (data) => { self = data; },
};

function assignSettings(data, priv) {
	const parts = data.msg.split(' ');

	const reply = priv ? (msg) => Utils.sendPM(data.who, msg) : (msg) => Utils.sendChat(state.tableID, msg);

	if (parts.length > 1) {
		if (gameStarted) {
			reply('Settings cannot be modified in the middle of a game.');
		}
		else {
			if (conventions[parts[1]]) {
				settings.convention = parts[1];

				if (settings.convention === 'HGroup' && (parts.length === 2 || !isNaN(Number(parts[2])))) {
					const level = Number(parts[2]) || 1;

					if (level <= 0 || level > 5) {
						Utils.sendPM(data.who, 'This bot can currently only play between levels 1 and 5.');
					}
					settings.level = Math.max(Math.min(level, 5), 1);
				}
			}
			else {
				reply(`Format is ${priv ? '/settings' : '/setall'} [convention=HGroup] [level=1]. For example, try '${priv ? '/settings' : '/setall'} HGroup 1'.`);
			}
		}
	}
	const settingsString = (settings.convention === 'HGroup') ? `H-Group level ${settings.level}` : 'Referential Sieve';
	reply(`Currently playing with ${settingsString} conventions.`);
}
