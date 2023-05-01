import { Card } from '../src/basics/Card.js';
import { State } from '../src/basics/State.js';
import * as Utils from '../src/util.js';

/** @type {Readonly<{RED: 0, YELLOW: 1, GREEN: 2, BLUE: 3, PURPLE: 4}>} */
export const COLOUR = Object.freeze({
	RED: 0,
	YELLOW: 1,
	GREEN: 2,
	BLUE: 3,
	PURPLE: 4
});

/** @type {Readonly<{ALICE: 0, BOB: 1, CATHY: 2, DONALD: 3, EMILY: 4}>} */
export const PLAYER = Object.freeze({
	ALICE: 0,
	BOB: 1,
	CATHY: 2,
	DONALD: 3,
	EMILY: 4
});

/**
 * @template {State} A
 * @param {{new(...args: any[]): A}} StateClass
 * @param {string[][]} hands
 * @return {A}
 */
export function setup(StateClass, hands, level) {
	const playerNames = ['Alice', 'Bob', 'Cathy', 'Donald', 'Emily'].slice(0, hands.length);
	const suits = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'];

	const state = new StateClass(-1, playerNames, 0, suits, level);
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
 * @param  {Card} card [description]
 */
export function getRawInferences(card) {
	return card.inferred.map(c => Utils.objPick(c, ['suitIndex', 'rank']));
}
