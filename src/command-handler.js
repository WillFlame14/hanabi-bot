import { getShortForms, getVariant } from './variants.js';
import logger from './tools/logger.js';
import * as Utils from './tools/util.js';

import HGroup from './conventions/h-group.js';
import PlayfulSieve from './conventions/playful-sieve.js';
import { BOT_VERSION, MAX_H_LEVEL } from './constants.js';
import { State } from './basics/State.js';

/**
 * @typedef {import('./basics/Game.js').Game} Game
 * @typedef {import('./types.js').Action} Action
 * @typedef {import('./types-live.js').ChatMessage} ChatMessage
 * @typedef {import('./types-live.js').InitData} InitData
 * @typedef {import('./types-live.js').Self} Self
 * @typedef {import('./types-live.js').Table} Table
 */

const conventions = { HGroup, PlayfulSieve };
const settings = {
	convention: 'HGroup',
	level: parseInt(process.env['HANABI_LEVEL'] ?? '1')
};

/** @type {Record<number, Table>} */
const tables = {};

/** @type {Self} */
let self;

let game = /** @type {Game} */ ({});

let gameStarted = false;

/** @type {string} 	The user who last sent us a PM. */
let last_sender;

export const handle = {
	/**
	 * @param {ChatMessage} data
	 * 
	 * Received when any message in chat is sent.
	 */
	chat: (data) => {
		const within_room = data.recipient === '' && data.room.startsWith('table');

		if (within_room) {
			if (data.msg.startsWith('/setall'))
				assignSettings(data, false);
			else if (data.msg.startsWith('/leaveall'))
				leaveRoom();

			return;
		}

		// We only care about private messages to us
		if (data.recipient !== self.username)
			return;


		last_sender = data.who;

		// Invites the bot to a lobby (format: /join [password])
		if (data.msg.startsWith('/join')) {
			const table = Utils.maxOn(Object.values(tables).filter(table =>
				(table.players.includes(data.who) && !table.sharedReplay) ||
				table.spectators.some(spec => spec.name === data.who)
			), (table) => table.id);

			if (!table) {
				Utils.sendPM(data.who, 'Could not join, as you are not in a room.');
				return;
			}

			if (table.passwordProtected) {
				const ind = data.msg.indexOf(' ');
				const password = ind != -1 ? data.msg.slice(ind + 1) : undefined;

				if (password === undefined) {
					Utils.sendPM(data.who, 'Room is password protected, please provide a password.');
					return;
				}
				Utils.sendCmd('tableJoin', { tableID: table.id, password });
				return;
			}
			Utils.sendCmd('tableJoin', { tableID: table.id });
			return;
		}
		// Readds the bot to a game (format: /rejoin)
		if (data.msg.startsWith('/rejoin')) {
			if (game?.tableID) {
				Utils.sendPM(data.who, 'Could not rejoin, as the bot is already in a game.');
				return;
			}

			const table = Utils.maxOn(Object.values(tables).filter(table => table.players.includes(self.username)), (table) => table.id);

			if (!table) {
				Utils.sendPM(data.who, 'Could not rejoin, as the bot is not a player in any currently open room.');
				return;
			}

			Utils.sendCmd('tableReattend', { tableID: table.id });
			return;
		}
		// Kicks the bot from a game (format: /leave)
		if (data.msg.startsWith('/leave')) {
			if (game?.tableID === undefined) {
				Utils.sendPM(data.who, 'Could not leave, as the bot is not currently in a room.');
				return;
			}

			leaveRoom();
			return;
		}
		// Creates a new table (format: /create <name> <maxPlayers> <password>)
		if (data.msg.startsWith('/create')) {
			const parts = data.msg.split(' ');
			Utils.sendCmd('tableCreate', { name: parts[1], maxPlayers: Number(parts[2]), password: parts[3] });
			return;
		}
		// Starts the game (format: /start)
		if (data.msg.startsWith('/start')) {
			Utils.sendCmd('tableStart', { tableID: game.tableID });
			return;
		}
		// Restarts a game (format: /restart)
		if (data.msg.startsWith('/restart')) {
			Utils.sendCmd('tableRestart', { tableID: game.tableID, hidePregame: true });
			return;
		}
		// Remakes a table (format: /remake)
		if (data.msg.startsWith('/remake')) {
			Utils.sendCmd('tableRestart', { tableID: game.tableID, hidePregame: false });
			return;
		}
		// Displays or modifies the current settings (format: /settings [convention = 'HGroup'] [level = 1])
		if (data.msg.startsWith('/settings')) {
			assignSettings(data, true);
			return;
		}
		if (data.msg.startsWith('/terminate')) {
			Utils.sendCmd('tableTerminate', { tableID: game.tableID });
			return;
		}
		if (data.msg.startsWith('/version')) {
			Utils.sendPM(data.who, `v${BOT_VERSION}`);
			return;
		}

		Utils.sendPM(data.who, 'Unrecognized command.');
	},
	/**
	 * @param {{tableID: number, action: Action}} data
	 * 
	 * Received when an action is taken in the current active game.
	 */
	gameAction: (data) => {
		const { action } = data;
		game.handle_action(action);
	},
	/**
	 * @param {{tableID: number, list: Action[]}} data
	 * 
	 * Received at the beginning of the game, as a list of all actions that have happened so far.
	 */
	gameActionList: (data) => {
		game.catchup = true;
		for (let i = 0; i < data.list.length - 10; i++)
			handle.gameAction({ action: data.list[i], tableID: data.tableID });

		game.catchup = false;

		for (let i = data.list.length - 10; i < data.list.length - 1; i++)
			handle.gameAction({ action: data.list[i], tableID: data.tableID });

		handle.gameAction({ action: data.list.at(-1), tableID: data.tableID });

		// Send "loaded" to let server know that we have "finished loading the UI"
		Utils.sendCmd('loaded', { tableID: data.tableID });

		// If we are going first, we need to take an action now
		if (game.state.ourPlayerIndex === 0 && game.state.turn_count === 1)
			setTimeout(() => Utils.sendCmd('action', game.take_action(game)), 3000);
	},
	/**
	 * @param {{tableID: number }} data
	 * 
	 * Received when successfully joining a table.
	 */
	joined: (data) => {
		const { tableID } = data;
		game.tableID = tableID;
		gameStarted = false;
	},
	/**
	 * @param {InitData} data
	 * 
	 * Received at the beginning of the game, with information about the game.
	 */
	init: async (data) => {
		const { tableID, playerNames, ourPlayerIndex, options } = data;
		const variant = await getVariant(options.variantName);

		await getShortForms(variant);

		const state = new State(playerNames, ourPlayerIndex, variant, options);

		// Initialize game state using convention set
		game = new conventions[/** @type {'HGroup' | 'PlayfulSieve'} */ (settings.convention)](tableID, state, true, settings.level);

		Utils.globalModify({ game, cache: new Map() });

		// Ask the server for more info
		Utils.sendCmd('getGameInfo2', { tableID: data.tableID });
	},
	/**
	 * Received when leaving a table.
	 */
	left: () => {
		game.tableID = undefined;
		gameStarted = false;
	},
	/**
	 * @param {Table} data
	 * 
	 * Received when a table updates its information.
	 */
	table: (data) => {
		tables[data.id] = data;

		// Only bots left in the replay
		if (data.id === game.tableID && data.sharedReplay && data.spectators.every(({name}) => name.startsWith('will-bot')))
			leaveRoom();
	},
	/**
	 * @param {Table} data
	 * 
	 * Received when a table is removed.
	 */
	tableGone: (data) => {
		delete tables[data.id];
	},
	/**
	 * @param {Table[]} data
	 * 
	 * Received once, with a list of the current tables and their information.
	 */
	tableList: (data) => {
		for (const table of data)
			tables[table.id] = table;
	},
	/**
	 * @param {{tableID: number, replay: boolean}} data
	 * 
	 * Received when the current table starts a game.
	 */
	tableStart: (data) => {
		Utils.sendCmd('getGameInfo1', { tableID: data.tableID });
		gameStarted = true;
	},
	/**
	 * @param {{warning: string}} data
	 * 
	 * Received when we send an invalid command.
	 */
	warning: (data) => {
		if (Utils.globals.manual || last_sender === undefined) {
			logger.error(data.warning);
		}
		else {
			Utils.sendPM(last_sender, data.warning);
			last_sender = undefined;
		}
	},
	/**
	 * @param {Self} data
	 * 
	 * Received when we first register a websocket.
	 */
	welcome: (data) => { self = data; },
};

/**
 * Leaves a room/shared replay.
 */
function leaveRoom() {
	Utils.sendCmd(gameStarted ? 'tableUnattend' : 'tableLeave', { tableID: game.tableID });
	game.tableID = undefined;
	game.in_progress = false;
	gameStarted = false;
}

/**
 * @param {ChatMessage} data
 * @param {boolean} priv 		Whether the message was sent in a PM or not.
 */
function assignSettings(data, priv) {
	const parts = data.msg.split(' ');

	/** @type {(msg: string) => void} msg */
	const reply = priv ? (msg) => Utils.sendPM(data.who, msg) : (msg) => Utils.sendChat(game.tableID, msg);

	const settingsString = () => settings.convention + (settings.convention === 'HGroup' ? ` ${settings.level}` : '');

	// Viewing settings
	if (parts.length === 1) {
		reply(`Currently playing with ${settingsString()} conventions.`);
		return;
	}

	if (game.in_progress) {
		reply('Settings cannot be modified in the middle of a game.');
		return;
	}

	/** @type {number} */
	let level;

	// Allow setting H-Group conventions by only providing level
	if (!isNaN(Number(parts[1]))) {
		settings.convention = 'HGroup';
		level = Number(parts[1]);
	}
	else {
		if (!conventions[parts[1]]) {
			reply(`Format is ${priv ? '/settings' : '/setall'} [convention=HGroup] [level=1]. For example, try '${priv ? '/settings' : '/setall'} HGroup 1'.`);
			return;
		}
		settings.convention = parts[1];
	}

	if (settings.convention === 'HGroup') {
		level = level ?? (Number(parts[2]) || 1);

		if (level < 1 || level > MAX_H_LEVEL) {
			reply(`This bot can currently only play between levels 1 and ${MAX_H_LEVEL}. Currently set to level ${settings.level}.`);
			return;
		}

		if (level > 9) {
			reply(`This bot can currently only play up to level 9 (+ level 11). There is no support for level 10.`);

			if (level < 11)
				level = 9;
		}

		settings.level = Math.max(Math.min(level, MAX_H_LEVEL), 1);
	}

	reply(`Currently playing with ${settingsString()} conventions.`);
}
