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
 */
export function cardHasInferences(card, inferences) {
	const message = `Differing inferences. Expected ${inferences}, got ${card.inferred.map(c => logCard(c))}`;

	assert.ok(card.inferred.length === inferences.length && inferences.every(inf => {
		const { suitIndex, rank } = expandShortCard(inf);

		return card.inferred.some(c => c.matches(suitIndex, rank));
	}), message);
}

/**
 * Asserts that the object as the provided properties (and possibly more).
 * @param  {Record<string, unknown>} obj 			The object to check properties of.
 * @param  {Recrod<string, unknown>} properties 	The properties to check.
 */
export function objHasProperties(obj, properties) {
	assert.ok(typeof obj === 'object', `Object (${JSON.stringify(obj)}) is not of type 'object'.`);
	assert.ok(typeof properties === 'object', `Properties (${JSON.stringify(properties)} is not of type 'object'.`);

	assert.deepEqual(Utils.objPick(obj, Object.keys(properties)), properties);
}