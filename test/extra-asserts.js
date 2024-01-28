import { strict as assert } from 'node:assert';
import { expandShortCard } from './test-utils.js';
import * as Utils from '../src/tools/util.js';
import { logCard } from '../src/tools/log.js';

/** 
 * @typedef {import('../src/basics/Card.js').Card} Card
 */

/**
 * Asserts that a card's inferences are exactly the set provided.
 * @param  {Card} card 				The card to check inferences of.
 * @param  {string[]} inferences 	The set of inferences to compare to.
 * @param  {string | Error} 		 [message]		The error message if the assertion fails.
 */
export function cardHasInferences(card, inferences, message) {
	const defaultMessage = `Differing inferences. Expected ${inferences}, got ${card.inferred.map(logCard)}`;

	assert.ok(card.inferred.length === inferences.length && inferences.every(inf => card.inferred.some(c => c.matches(expandShortCard(inf)))), message ?? defaultMessage);
}

/**
 * Asserts that the object as the provided properties (and possibly more).
 * @param  {Record<string, unknown>} obj 			The object to check properties of.
 * @param  {Record<string, unknown>} properties 	The properties to check.
 * @param  {string | Error} 		 [message]		The error message if the assertion fails.
 */
export function objHasProperties(obj, properties, message) {
	assert.ok(typeof obj === 'object', `Object (${JSON.stringify(obj)}) is not of type 'object'.`);
	assert.ok(typeof properties === 'object', `Properties (${JSON.stringify(properties)} is not of type 'object'.`);

	assert.deepEqual(Utils.objPick(obj, Object.keys(properties)), properties, message);
}
