import * as readline from 'readline';
import { Card } from './basics/Card.js';
import { ACTION, CLUE } from './constants.js';
import logger from './logger.js';
import { shortForms } from './variants.js';

/**
 * @typedef {import('./basics/Hand.js').Hand} Hand
 * @typedef {import('./types.js').Clue} Clue
 * @typedef {import('./types.js').PerformAction} PerformAction
 */

const globals = {};

/**
 * Modifies the global object.
 * @param {any} obj
 */
export function globalModify(obj) {
	Object.assign(globals, obj);
}

/**
 *	Parses the command-line arguments into an object.
 */
export function parse_args() {
	const args = /** @type {Record<string, string>} */ ({}), arg_lines = process.argv.slice(2);

	for (const arg_line of arg_lines) {
		const parts = arg_line.split('=');
		if (parts.length === 2 && arg_line.length >= 3) {
			args[parts[0]] = parts[1];
		}
		else {
			args[parts[0]] = 'true';
		}
	}
	return args;
}


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

		if (globals.state === undefined) {
			return;
		}

		process.stdout.write(key.sequence);
		switch(key.sequence) {
			case '\r':
			case '\n': {
				console.log();
				const parts = command.join('').split(' ');
				const { state } = globals;

				switch(parts[0]) {
					case 'hand': {
						if (parts.length !== 2) {
							console.log('Correct usage is "hand <playerName>"');
							break;
						}
						const playerName = parts[1];
						if (!state.playerNames.includes(playerName)) {
							console.log('That player is not in this room.');
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

/**
 * Sends a private chat message in hanab.live to the recipient.
 * @param {string} recipient
 * @param {string} msg
 */
export function sendPM(recipient, msg) {
	sendCmd('chatPM', { msg, recipient, room: 'lobby' });
}

/**
 * Sends a chat message in hanab.live to the room.
 * @param {number} tableID
 * @param {string} msg
 */
export function sendChat(tableID, msg) {
	sendCmd('chat', { msg, room: `table${tableID}` });
}

/**
 * Sends a game command to hanab.live with an object as data.
 * @param {string} command
 * @param {any} arg
 */
export function sendCmd(command, arg) {
	const cmd = command + ' ' + JSON.stringify(arg);
	logger.debug('sending cmd ' + cmd);
	globals.ws.send(cmd);
}

/**
 * Deep clones an object. Does not create clones of functions.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function objClone(obj) {
	if (typeof obj === 'object') {
		if (obj instanceof Card) {
			return /** @type {T} */ (obj.clone());
		}
		else if (Array.isArray(obj)) {
			return /** @type {T} */ (obj.map(elem => objClone(elem)));
		}
		else {
			const new_obj = {};
			for (const [name, value] of Object.entries(obj)) {
					new_obj[name] = objClone(value);
			}
			return /** @type {T} */ (new_obj);
		}
	}
	else {
		return obj;
	}
}

/**
 * Returns a copy of the object, keeping only the attributes whose names were provided.
 * @template T
 * @template {keyof T} K
 * @param {T} 	obj 			The base object.
 * @param {K[]} attributes 		The keys of the base object that you want to keep.
 */
export function objPick(obj, attributes) {
	const new_obj = /** @type {Pick<T, K>} */ ({});
	for (const attr of attributes) {
		new_obj[attr] = obj[attr];
	}
	return new_obj;
}

/**
 * Returns the "maximum" object in an array based on a value function.
 * @template T
 * @param  {T[]} arr 						The array of objects.
 * @param  {(obj: T) => number} valueFunc	A function that takes in an object and returns its value.
 */
export function maxOn(arr, valueFunc) {
	if (arr.length === 0) {
		return undefined;
	}

	let max_value = valueFunc(arr[0]), max = arr[0];

	for (let i = 0; i < arr.length; i++) {
		const curr = valueFunc(arr[i]);

		if (curr > max_value) {
			max_value = curr;
			max = arr[i];
		}
	}

	return max;
}

/**
 * Checks if two objects look the same (i.e. have the same properties).
 */
export function objEquals(obj1, obj2) {
	const keys1 = Object.keys(obj1);

	// Different number of keys
	if (keys1.length !== Object.keys(obj2).length) {
		return false;
	}

	// Two literals
	if (keys1.length === 0) {
		return obj1 === obj2;
	}

	for (const key of keys1) {
		const val1 = obj1[key];
		const val2 = obj2[key];

		// Values have different types
		if (typeof val1 !== typeof obj2[key]) {
			return false;
		}

		if (typeof val1 === 'object') {
			// Nested objects aren't the same
			if (!objEquals(val1, val2)) {
				return false;
			}
		}
		else {
			return val1 === val2;
		}
	}
	return true;
}

/**
 * Returns a log-friendly representation of a card.
 * @param {{suitIndex: number, rank: number} & Partial<Card>} card
 */
export function logCard(card) {
	let suitIndex, rank, append;

	if (card.suitIndex !== -1) {
		({ suitIndex, rank } = card);
	}
	else if (card?.possible.length === 1) {
		({ suitIndex, rank } = card.possible[0]);
		append = '(known)';
	}
	else if (card?.inferred.length === 1) {
		({ suitIndex, rank } = card.inferred[0]);
		append = '(inferred)';
	}
	else {
		return '(unknown)';
	}
	return shortForms[globals.state.suits[suitIndex]] + rank + (append !== undefined ? ' ' + append : '');
}

/**
 * Returns a log-friendly representation of a hand.
 * @param {Card[]} hand
 */
export function logHand(hand) {
	const new_hand = [];

	for (const card of hand) {
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : logCard(card));
		new_card.order = card.order;

		/** @type {string[]} */
		new_card.flags = [];
		for (const flag of ['clued', 'newly_clued', 'prompted', 'finessed', 'chop_moved', 'rewinded']) {
			if (card[flag]) {
				new_card.flags.push(flag);
			}
		}

		new_card.possible = card.possible.map(c => logCard(c));
		new_card.inferred = card.inferred.map(c => logCard(c));
		new_card.reasoning = card.reasoning_turn;
		new_hand.push(new_card);
	}
	return new_hand;
}

/**
 * Returns a log-friendly representation of a clue.
 * @param {Clue | PerformAction} clue
 */
export function logClue(clue) {
	if (clue === undefined) {
		return;
	}
	const value = (clue.type === CLUE.COLOUR || clue.type === ACTION.COLOUR) ? globals.state.suits[clue.value].toLowerCase() : clue.value;

	return `(${value} to ${globals.state.playerNames[clue.target]})`;
}

/**
 * Writes the card's inferences on it as a note.
 * @param {number} turn
 * @param {Card} card
 * @param {number} tableID
 */
export function writeNote(turn, card, tableID) {
	let note;

	if (card.inferred.length === 0) {
		note = '??';
	}
	else if (card.inferred.length <= 3) {
		note = card.inferred.map(c => logCard(c)).join(',');
	}
	else {
		note = '...';
	}

	if (card.finessed) {
		note = `[f] [${note}]`;
	}

	if (card.chop_moved) {
		note = `[cm] [${note}]`;
	}

	// Only write a new note if it's different from the last note
	if (note !== card.last_note) {
		card.last_note = note;

		if (card.full_note === '') {
			card.full_note = `t${turn}: ${note}`;
		}
		else {
			card.full_note = `${card.full_note} | t${turn}: ${note}`;
		}

		setTimeout(() => sendCmd('note', { tableID, order: card.order, note: card.full_note }), Math.random() * 3000);
	}
}

/**
 * Transforms a CLUE into an ACTION.
 * @param  {Clue} clue
 * @param  {number} tableID
 * @return {PerformAction}
 */
export function clueToAction(clue, tableID) {
	const { type, value, target } = clue;
	return { tableID, type: /** @type {ACTION[keyof ACTION]} */ (type + 2), value, target };
}
