// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import HGroup from '../../src/conventions/h-group.js';
import { Card } from '../../src/basics/Card.js';
import { CLUE } from '../../src/constants.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

const COLOUR = Object.freeze({
	RED: 0,
	YELLOW: 1,
	GREEN: 2,
	BLUE: 3,
	PURPLE: 4
});

const PLAYER = Object.freeze({
	ALICE: 0,
	BOB: 1,
	CATHY: 2,
	DONALD: 3,
	EMILY: 4
});

/**
 * @param {string[][]} hands
 */
function setup(hands) {
	const playerNames = ['Alice', 'Bob', 'Cathy', 'Donald', 'Emily'].slice(0, hands.length);
	const suits = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'];

	const state = new HGroup(-1, playerNames, 1, suits);
	Utils.globalModify({state});

	let orderCounter = 0;

	// Draw all the hands
	for (let playerIndex = 0; playerIndex < hands.length; playerIndex++) {
		const hand = hands[playerIndex];
		for (const short of hand.reverse()) {
			const card = expandShortCard(short);
			if (card.suitIndex !== -1) {
				console.log('EEEEE');
			}
			const action = { type: 'draw', order: orderCounter, playerIndex, suitIndex: card.suitIndex, rank: card.rank };
			orderCounter++;

			state.handle_action(action);
		}
	}

	return state;
}

/**
 * @param {string} short
 */
function expandShortCard(short) {
	return {
		suitIndex: ['x', 'r', 'y', 'g', 'b', 'p'].indexOf(short[0]) - 1,
		rank: Number(short[1]) || -1
	};
}

/**
 * @param  {Card} card [description]
 */
function getRawInferences(card) {
	return card.inferred.map(c => Utils.objPick(c, ['suitIndex', 'rank']));
}

logger.setLevel(logger.LEVELS.ERROR);

describe('play clue', () => {
	it('can interpret a colour play clue touching one card', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slot 2.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [8], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Target card should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][1];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue touching multiple cards', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7, 8, 9], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Bob's slot 1 should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][0];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue touching chop', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [5, 8, 9], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Bob's slot 5 (chop) should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][4];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue on a partial stack', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		state.play_stacks[COLOUR.RED] = 2;

		// Alice clues Bob red on slot 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Bob's slot 3 should be inferred as r3.
		const targetCard = state.hands[PLAYER.BOB][2];
		assert.deepEqual(getRawInferences(targetCard), ['r3'].map(expandShortCard));
	});

	it('can interpret a colour play clue through someone\'s hand', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'r1', 'xx', 'xx', 'xx']
		]);

		// Cathy's r1 is clued and inferred.
		state.hands[PLAYER.CATHY][1].clued = true;
		state.hands[PLAYER.CATHY][1].intersect('possible', ['r1', 'r2', 'r3', 'r4', 'r5'].map(expandShortCard));
		state.hands[PLAYER.CATHY][1].intersect('inferred', ['r1'].map(expandShortCard));
		console.log(Utils.logHand(state.hands[PLAYER.CATHY]));

		// Alice clues Bob red on slot 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Bob's slot 3 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][2];
		assert.deepEqual(getRawInferences(targetCard), ['r2'].map(expandShortCard));
	});

	it('can interpret a self-connecting colour play clue', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx'],
		]);

		// Bob has a 1 in slot 2.
		state.hands[PLAYER.BOB][1].clued = true;
		state.hands[PLAYER.BOB][1].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		state.hands[PLAYER.BOB][1].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		// Alice clues Bob red in slots 1 and 2 (filling in red 1).
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [8, 9], target: PLAYER.BOB, turn: 0 };
		state.handle_action(action);

		// Bob's slot 1 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][0];
		assert.deepEqual(getRawInferences(targetCard), ['r2'].map(expandShortCard));
	});
});
