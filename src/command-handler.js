const { handle_action } = require('./action-handler.js');
const { Card } = require('./basics/Card.js')
const { logger } = require('./logger.js');
const Utils = require('./util.js');

const HGroup = require('./conventions/h-group.js');

const conventions = {
	HGroup
};

let self, tables = {}, state;

const handle = {
	// Received when any message in chat is sent
	chat: (data) => {
		// We only care about private messages to us
		if (data.recipient === self.username) {
			// Invites the bot to a lobby
			// Format: /join [password]
			if (data.msg.startsWith('/join')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (table.players.includes(data.who)) {
						if (table.running || table.players.length === 6) {
							continue;
						}

						let ind = data.msg.indexOf(' '), password;
						if (ind != -1) {
							password = data.msg.slice(ind + 1);
						}
						Utils.sendCmd('tableJoin', { tableID: table.id, password });
						return;
					}
				}

				// Table not found
				Utils.sendChat(data.who, 'Could not join. Check that the room is not full and the game has not started.');
			}
			// Readds the bot to a game
			// Format: /rejoin <tableId> [password]
			else if (data.msg.startsWith('/rejoin')) {
				const parts = data.msg.split(' ');
				Utils.sendCmd('tableReattend', { tableID: Number(parts[1]), password: parts[2] });
			}
			// Kicks the bot from a game
			// Format: /leave <tableId>
			else if (data.msg.startsWith('/leave')) {
				Utils.sendCmd('tableUnattend', { tableID: Number(data.msg.slice(data.msg.indexOf(' ') + 1)) });
			}
		}
	},
	// Received when an action is taken in the current active game
	gameAction: (data, catchup = false) => {
		const { action, tableID } = data;
		handle_action(state, action, tableID, catchup);
	},
	// Received at the beginning of the game, as a list of all actions that have happened so far
	gameActionList: (data) => {
		for (let i = 0; i < data.list.length - 1; i++) {
			//handle_action(state, data.list[i], data.tableID, true);
			handle.gameAction({ action: data.list[i], tableID: data.tableID }, true);
		}
		handle.gameAction({ action: data.list.at(-1), tableID: data.tableID });
		//handle_action(state, data.list.at(-1), data.tableID);

		// Send "loaded" to let server know that we have "finished loading the UI"
		Utils.sendCmd('loaded', { tableID: data.tableID });

		// If we are going first, we need to take an action now
		if (state.ourPlayerIndex === 0 && state.turn_count === 0) {
			setTimeout(() => state.take_action(state, data.tableID), 3000);
		}
	},
	// Received at the beginning of the game, with information about the game
	init: (data) => {
		const { playerNames, ourPlayerIndex } = data;

		// Initialize global game state
		state = {
			turn_count: 0,
			clue_tokens: 8,
			playerNames,
			numPlayers: playerNames.length,
			ourPlayerIndex,
			hands: [],
			num_suits: 5,
			play_stacks: [],
			hypo_stacks: [],
			discard_stacks: [],
			all_possible: [],
			max_ranks: [],
			actionList: []
		}

		const HAND_SIZES = [-1, -1, 5, 5, 4, 3, 3];
		state.cards_left = state.num_suits * 5 - state.numPlayers * HAND_SIZES[state.numPlayers];

		for (let i = 0; i < state.numPlayers; i++) {
			state.hands.push([]);
		}

		for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
			state.play_stacks.push(0);
			state.hypo_stacks.push(0);
			state.discard_stacks.push([0, 0, 0, 0, 0]);
			state.max_ranks.push(5);

			for (let rank = 1; rank <= 5; rank++) {
				state.all_possible.push(new Card(suitIndex, rank));
			}
		}

		// Initialize convention set
		const convention = process.env.MODE || 'HGroup';
		Object.assign(state, conventions[convention]);

		// Save blank state
		state.blank = Utils.objClone(state);
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
}

module.exports = { handle };
