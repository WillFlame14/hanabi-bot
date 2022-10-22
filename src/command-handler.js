const { handle_action } = require('./action-handler.js');
const { Card } = require('./basics/Card.js');
const { Hand } = require('./basics/Hand.js');
const { cardCount, getVariant } = require('./variants.js');
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
			// Invites the bot to a lobby (format: /join [password])
			if (data.msg.startsWith('/join')) {
				// Find the table with the user that invited us
				for (const table of Object.values(tables)) {
					if (!table.sharedReplay && table.players.includes(data.who)) {
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
		handle_action(state, action, catchup);
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

		// Initialize global game state
		state = {
			tableID,
			turn_count: 0,
			clue_tokens: 8,
			playerNames,
			numPlayers: playerNames.length,
			ourPlayerIndex,
			hands: [],
			suits: variant.suits,
			play_stacks: [],
			hypo_stacks: [],
			discard_stacks: [],
			all_possible: [],
			max_ranks: [],
			actionList: [],
			waiting_connections: [],
			last_actions: [],
			early_game: true
		};

		state.cards_left = state.suits.reduce((acc, suit) => {
			let cards = 0;
			for (let rank = 1; rank <= 5; rank++) {
				cards += cardCount(suit, rank);
			}
			return acc + cards;
		}, 0);

		const all_possible = [];
		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			state.play_stacks.push(0);
			state.hypo_stacks.push(0);
			state.discard_stacks.push([0, 0, 0, 0, 0]);
			state.max_ranks.push(5);

			for (let rank = 1; rank <= 5; rank++) {
				all_possible.push(new Card(suitIndex, rank));
			}
		}

		for (let i = 0; i < state.numPlayers; i++) {
			state.hands.push(new Hand());
			state.all_possible.push(Utils.objClone(all_possible));
		}

		// Initialize convention set
		const convention = process.env.MODE || 'HGroup';
		Object.assign(state, conventions[convention]);

		state.rewind = rewind;
		state.simulate_clue = simulate_clue;

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
};

let rewind_depth = 0;

function rewind(state, action_index, playerIndex, order, suitIndex, rank, finessed) {
	if (rewind_depth > 2) {
		throw new Error('attempted to rewind too many times!');
	}
	else if (action_index === undefined) {
		logger.error('tried to rewind before any reasoning was done!');
		return false;
	}
	rewind_depth++;

	logger.info(`card actually ${Utils.logCard({suitIndex, rank})}, rewinding to action_index ${action_index}`);
	const new_state = Utils.objClone(state.blank);
	new_state.blank = Utils.objClone(new_state);
	const history = state.actionList.slice(0, action_index);

	logger.setLevel(logger.LEVELS.ERROR);

	// Get up to speed
	for (const action of history) {
		handle_action(new_state, action, true);
	}

	logger.setLevel(logger.LEVELS.INFO);

	// Rewrite and save as a rewind action
	const known_action = { type: 'rewind', order, playerIndex, suitIndex, rank };
	handle_action(new_state, known_action, true);
	logger.warn('Rewriting order', order, 'to', Utils.logCard({suitIndex, rank}));

	const pivotal_action = state.actionList[action_index];
	pivotal_action.mistake = finessed || rewind_depth > 1;
	logger.info('pivotal action', pivotal_action);
	handle_action(new_state, pivotal_action, true);

	logger.setLevel(logger.LEVELS.ERROR);

	// Redo all the following actions
	const future = state.actionList.slice(action_index + 1);
	for (const action of future) {
		handle_action(new_state, action, true);
	}

	logger.setLevel(logger.LEVELS.INFO);

	// Overwrite state
	Object.assign(state, new_state);
	rewind_depth = 0;
	return true;
}

function simulate_clue(state, action, options = {}) {
	const hypo_state = Utils.objClone(state);

	if (options.simulatePlayerIndex !== undefined) {
		hypo_state.ourPlayerIndex = options.simulatePlayerIndex;
	}

	if (!options.enableLogs) {
		logger.setLevel(logger.LEVELS.ERROR);
	}

	hypo_state.interpret_clue(hypo_state, action);
	logger.setLevel(logger.LEVELS.INFO);

	return hypo_state;
}

module.exports = { handle };
