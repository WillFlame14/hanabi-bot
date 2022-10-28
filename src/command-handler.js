import { getVariant } from './variants.js';
import logger from './logger.js';
import * as Utils from './util.js';

import HGroup from './conventions/h-group.js';

/**
 * @typedef {import('./basics/State.js').State} State
 */

const conventions = { HGroup };

let self;
const tables = {};

/** @type {State} */
let state;

export const handle = {
	// Received when any message in chat is sent
	chat: (data) => {
		// We only care about private messages to us
		if (data.recipient === self.username) {
			// Invites the bot to a lobby (format: /join [password])
			if (data.msg.startsWith('/join')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (!table.sharedReplay && table.players.includes(data.who)) {
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
				Utils.sendChat(data.who, 'Could not join. Check that the room is not full and the game has not started.');
			}
			// Readds the bot to a game (format: /rejoin)
			else if (data.msg.startsWith('/rejoin')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (!table.sharedReplay && table.players.includes(data.who)) {
						if (!table.players.includes(self.username)) {
							Utils.sendChat(data.who, 'Could not join, as the bot was never a player in this room.');
							return;
						}

						logger.info(table);
						Utils.sendCmd('tableReattend', { tableID: table.id });
						return;
					}
				}

				// Table not found
				Utils.sendChat(data.who, 'Could not rejoin, as you are not in a room.');
			}
			// Kicks the bot from a game (format: /leave)
			else if (data.msg.startsWith('/leave')) {
				Utils.sendCmd('tableUnattend', { tableID: state.tableID });
			}
			// Creates a new table (format: /create <name> <maxPlayers> <password>)
			else if (data.msg.startsWith('/create')) {
				const parts = data.msg.split(' ');
				Utils.sendCmd('tableCreate', { name: parts[1], maxPlayers: Number(parts[2]), password: parts[3] });
			}
			// Starts the game (format: /start <tableId>)
			else if (data.msg.startsWith('/start')) {
				Utils.sendCmd('tableStart', { tableID: Number(data.msg.slice(data.msg.indexOf(' ') + 1)) });
			}
		}
	},
	// Received when an action is taken in the current active game
	gameAction: (data, catchup = false) => {
		const { action } = data;
		state.handle_action(action, catchup);
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
		if (state.ourPlayerIndex === 0 && state.turn_count === 0) {
			setTimeout(() => state.take_action(state), 3000);
		}
	},
	// Received at the beginning of the game, with information about the game
	init: async (data) => {
		const { tableID, playerNames, ourPlayerIndex, options } = data;
		const variant = await getVariant(options.variantName);

		// Initialize game state using convention set
		const convention = process.env.MODE || 'HGroup';
		state = new conventions[convention](tableID, playerNames, ourPlayerIndex, variant.suits);

		Utils.globalModify({state});

		// Ask the server for more info
		Utils.sendCmd('getGameInfo2', { tableID: data.tableID });
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
	tableStart: (data) => Utils.sendCmd('getGameInfo1', { tableID: data.tableID }),
	// Received when we send an invalid command
	warning: (warn) => logger.error(warn),
	// Received when we first register a websocket
	welcome: (data) => { self = data; },
};
