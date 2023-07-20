import { ACTION } from '../constants.js';
import { Card } from '../basics/Card.js';
import { Hand } from '../basics/Hand.js';
import logger from './logger.js';

/**
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').PerformAction} PerformAction
 */

export const globals = {};

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
export function objClone(obj, depth = 0) {
	if (depth > 15) {
		throw new Error('Maximum recursion depth reached.');
	}
	if (typeof obj === 'object') {
		if (obj instanceof Card || obj instanceof Hand) {
			return /** @type {T} */ (obj.clone());
		}
		else if (Array.isArray(obj)) {
			return /** @type {T} */ (obj.map(elem => objClone(elem)));
		}
		else {
			const new_obj = {};
			for (const [name, value] of Object.entries(obj)) {
				new_obj[name] = objClone(value, depth + 1);
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
	if (typeof obj1 !== typeof obj2) {
		return false;
	}

	if (typeof obj1 !== 'object') {
		return false;
	}

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
		else if (val1 !== val2) {
			return false;
		}
	}
	return true;
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
