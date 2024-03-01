import { BasicCard, ActualCard } from '../basics/Card.js';
import { Hand } from '../basics/Hand.js';
import { Player } from '../basics/Player.js';
import { ACTION, CLUE } from '../constants.js';
import logger from './logger.js';

/**
 * @typedef {typeof import('../constants.js').ACTION} ACTION
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Identity} Identity
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

		if (parts.length === 2 && arg_line.length >= 3)
			args[parts[0]] = parts[1];
		else
			args[parts[0]] = 'true';
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

const cmdQueue = [];
let queueTimer;

/**
 * Sends a game command to hanab.live with an object as data.
 * @param {string} command
 * @param {any} arg
 */
export function sendCmd(command, arg) {
	cmdQueue.push(command + ' ' + JSON.stringify(arg));

	if (queueTimer === undefined)
		emptyCmdQueue();
}

function emptyCmdQueue() {
	if (cmdQueue.length === 0) {
		queueTimer = undefined;
		return;
	}

	const cmd = cmdQueue.shift();
	globals.ws.send(cmd);
	logger.debug('sending cmd', cmd);

	queueTimer = setTimeout(emptyCmdQueue, 500);
}

/**
 * Creates an array of numbers from start to end, not including end.
 * @param {number} start
 * @param {number} end
 */
export function range(start, end) {
	return [...new Array(end - start).keys()].map(num => num + start);
}

/**
 * Deep clones an object. Does not create clones of functions.
 * @template T
 * @param {T} obj
 * @param {number} depth 	The current nesting depth. Throws an error if this is above 15.
 * @returns {T}
 */
export function objClone(obj, depth = 0) {
	if (depth > 15)
		throw new Error('Maximum recursion depth reached.');

	if (typeof obj === 'object') {
		if (obj instanceof BasicCard || obj instanceof Hand || obj instanceof Player) {
			return /** @type {T} */ (obj.clone());
		}
		else if (Array.isArray(obj)) {
			return /** @type {T} */ (obj.map(elem => objClone(elem)));
		}
		else {
			const new_obj = {};
			for (const [name, value] of Object.entries(obj))
				new_obj[name] = objClone(value, depth + 1);

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
 * @param {T} 	obj 						The base object.
 * @param {K[]} attributes 					The keys of the base object that you want to keep.
 * @param {{ default?: T[K] }} options 	The default value to set if the base object doesn't contain the attribute.
 */
export function objPick(obj, attributes, options = {}) {
	const new_obj = /** @type {Pick<T, K>} */ ({});

	for (const attr of attributes)
		new_obj[attr] = obj[attr] ?? options.default;

	return new_obj;
}

/**
 * Returns the "maximum" object in an array based on a value function.
 * @template T
 * @param  {T[]} arr 						The array of objects.
 * @param  {(obj: T) => number} valueFunc	A function that takes in an object and returns its value.
 * @param  {number} minValue 				The minimum value that the maximum object must satisfy.
 */
export function maxOn(arr, valueFunc, minValue = -Infinity) {
	if (arr.length === 0)
		return undefined;

	let max_value = minValue, max;

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
 * @param {unknown} obj1
 * @param {unknown} obj2
 */
export function objEquals(obj1, obj2) {
	if (typeof obj1 !== typeof obj2)
		return false;

	if (typeof obj1 !== 'object')
		return false;

	const keys1 = Object.keys(obj1);

	// Different number of keys
	if (keys1.length !== Object.keys(obj2).length)
		return false;

	// Two literals
	if (keys1.length === 0)
		return obj1 === obj2;

	for (const key of keys1) {
		const val1 = obj1[key];
		const val2 = obj2[key];

		// Values have different types
		if (typeof val1 !== typeof obj2[key])
			return false;


		if (typeof val1 === 'object') {
			// Nested objects aren't the same
			if (!objEquals(val1, val2))
				return false;
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
 * @returns {PerformAction}
 */
export function clueToAction(clue, tableID) {
	const { type, value, target } = clue;
	return { tableID, type: /** @type {ACTION[keyof ACTION]} */ (type + 2), value, target };
}

/**
 * Returns the visible hand of the owning player (since it is typically unknown).
 * @param  {State} state
 * @param  {Identity[]} deck
 */
function get_own_hand(state, deck) {
	const ind = state.ourPlayerIndex;
	return new Hand(...state.hands[ind].map(c => new ActualCard(deck[c.order].suitIndex, deck[c.order].rank, c.order)));
}

/**
 * Converts a PerformAction to an Action.
 * @param  {State} state
 * @param  {PerformAction} action
 * @param  {number} playerIndex
 * @param  {Identity[]} deck
 * @returns {Action}
 */
export function performToAction(state, action, playerIndex, deck) {
	const { type, target, value } = action;

	switch(type) {
		case ACTION.PLAY: {
			const { suitIndex, rank } = deck[target];

			if (state.play_stacks[suitIndex] + 1 === rank)
				return { type: 'play', playerIndex, order: target, suitIndex, rank };
			else
				return { type: 'discard', playerIndex, order: target, suitIndex, rank, failed: true };
		}
		case ACTION.DISCARD: {
			const { suitIndex, rank } = deck[target];
			return { type: 'discard', playerIndex, order: target, suitIndex, rank, failed: false };
		}
		case ACTION.RANK: {
			const clue = { type: CLUE.RANK, value };
			const hand = target === state.ourPlayerIndex ? get_own_hand(state, deck) : state.hands[target];
			const list = hand.clueTouched(clue, state.variant).map(c => c.order);

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.COLOUR: {
			const clue = { type: CLUE.COLOUR, value };
			const hand = target === state.ourPlayerIndex ? get_own_hand(state, deck) : state.hands[target];
			const list = hand.clueTouched(clue, state.variant).map(c => c.order);

			return { type: 'clue', giver: playerIndex, target, clue, list };
		}
		case ACTION.END_GAME: {
			return { type: 'gameOver', playerIndex: target, endCondition: value, votes: -1 };
		}
	}
}

/**
 * Returns all indices of an array that satisfy the provided function.
 * @template T
 * @param  {T[]} arr 						The array of objects.
 * @param  {(obj: T) => boolean} testFunc	A function that takes in an object and tests whether it satisfies the condition.
 */
export function findIndices(arr, testFunc) {
	const indices = [];

	for (let i = 0; i < arr.length; i++) {
		if (testFunc(arr[i]))
			indices.push(i);
	}
	return indices;
}

/**
 * Returns the next index of the array (with wraparound) that satisfies the provided function.
 * (If wraparound isn't desired, use Array.findIndex() with a starting index.)
 * Returns startIndex if no other element satsifies the function, or -1 if no element satisfies it.
 * @template T
 * @param  {T[]} arr 						The array of objects.
 * @param  {(obj: T) => boolean} testFunc	A function that takes in an object and tests whether it satisfies the condition.
 * @param  {number} startIndex 				The index for which the next is desired (i.e. doesn't check itself).
 */
export function nextIndex(arr, testFunc, startIndex) {
	for (let offset = 1; offset <= arr.length; offset++) {
		const index = (startIndex + offset) % arr.length;

		if (testFunc(arr[index]))
			return index;
	}
	return -1;
}

/**
 * Combines multiple regular expressions into one.
 * @param  {...RegExp} regexes 
 * @returns {RegExp}
 */
export function combineRegex(...regexes) {
	return new RegExp(regexes.map(re => re.source).join('|'));
}

/**
 * Checks if two sets are equal.
 * @template T
 * @param {Set<T>} set1
 * @param {Set<T>} set2
 */
export function setEquals(set1, set2) {
	if (set1.size !== set2.size)
		return false;

	for (const item of set1) {
		if (!set2.has(item))
			return false;
	}

	return true;
}

/**
 * Returns the intersection of two sets.
 * @template T
 * @param {Set<T>} set1
 * @param {Set<T>} set2
 */
export function setIntersect(set1, set2) {
	const [smallerSet, largerSet] = set1.size < set2.size ? [set1, set2] : [set2, set1];

	const result = new Set();

	for (const item of smallerSet) {
		if (largerSet.has(item))
			result.add(item);
	}
}

/**
 * Returns (set1 \diff set2).
 * @template T
 * @param {Set<T>} set1
 * @param {Set<T>} set2
 */
export function setDifference(set1, set2) {
	const result = new Set();

	for (const item of set1) {
		if (!set2.has(item))
			result.add(item);
	}
}

/**
 * Returns the union of two sets.
 * @template T
 * @param {Set<T>} set1
 * @param {Set<T>} set2
 */
export function setUnion(set1, set2) {
	const [smallerSet, largerSet] = set1.size < set2.size ? [set1, set2] : [set2, set1];

	const result = new Set(largerSet);

	for (const item of smallerSet)
		result.add(item);
}
