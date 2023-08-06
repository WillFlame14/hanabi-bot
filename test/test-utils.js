import { strict as assert } from 'node:assert';
import * as Utils from '../src/tools/util.js';
import { logCard } from '../src/tools/log.js';

/**
 * @typedef {} Card
 */

export const COLOUR = /** @type {const} */ ({
	RED: 0,
	YELLOW: 1,
	GREEN: 2,
	BLUE: 3,
	PURPLE: 4
});

export const PLAYER = /** @type {const} */ ({
	ALICE: 0,
	BOB: 1,
	CATHY: 2,
	DONALD: 3,
	EMILY: 4
});

const names = ['Alice', 'Bob', 'Cathy', 'Donald', 'Emily'];
const suits = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'];

/**
 * @template {import ('../src/basics/State.js').State} A
 * @param {{new(...args: any[]): A}} StateClass
 * @param {string[][]} hands
 * @param {number} level
 * @returns {A}
 */
export function setup(StateClass, hands, level = 1) {
	const playerNames = names.slice(0, hands.length);

	const state = new StateClass(-1, playerNames, 0, suits, false, level);
	Utils.globalModify({state});

	let orderCounter = 0;

	// Draw all the hands
	for (let playerIndex = 0; playerIndex < hands.length; playerIndex++) {
		const hand = hands[playerIndex];
		for (const short of hand.reverse()) {
			const { suitIndex, rank } = expandShortCard(short);

			state.handle_action({ type: 'draw', order: orderCounter, playerIndex, suitIndex, rank });
			orderCounter++;
		}
	}

	return state;
}

/**
 * @param {string} short
 */
export function expandShortCard(short) {
	return {
		suitIndex: ['x', 'r', 'y', 'g', 'b', 'p'].indexOf(short[0]) - 1,
		rank: Number(short[1]) || -1
	};
}

/**
 * @param  {import('../src/basics/Card.js').Card} card 	The card to check inferences of.
 * @param  {string[]} inferences 						The set of inferences to compare to.
 */
export function assertCardHasInferences(card, inferences) {
	const message = `Differing inferences. Expected ${inferences}, got ${card.inferred.map(c => logCard(c))}`;

	assert.ok(card.inferred.length === inferences.length && inferences.every(inf => {
		const { suitIndex, rank } = expandShortCard(inf);

		return card.inferred.some(c => c.matches(suitIndex, rank));
	}), message);
}
