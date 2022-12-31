// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import * as Utils from '../../src/util.js';

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

function expandShortCard(short) {
	return {
		suitIndex: ['x', 'r', 'y', 'g', 'b', 'p'].indexOf(short[0]) - 1,
		rank: Number(short[1]) || -1
	};
}

describe('play clue', () => {
	it('can interpret a colour play clue touching one card', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slot 2.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: 0 }, giver: 0, list: [8], target: 1, turn: 0 };
		state.handle_action(action);

		// Target card should be inferred as r1
		const targetCard = state.hands[1][1];
		assert.equal(targetCard.inferred.length, 1);
		assert(targetCard.inferred[0].matches(0, 1));
	});

	it('can interpret a colour play clue touching multiple cards', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: 0 }, giver: 0, list: [7, 8, 9], target: 1, turn: 0 };
		state.handle_action(action);

		// Bob's slot 1 should be inferred as r1
		const targetCard = state.hands[1][0];
		assert.equal(targetCard.inferred.length, 1);
		assert(targetCard.inferred[0].matches(0, 1));
	});

	it('can interpret a colour play clue touching chop', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: 0 }, giver: 0, list: [5, 8, 9], target: 1, turn: 0 };
		state.handle_action(action);

		// Bob's slot 5 (chop) should be inferred as r1
		const targetCard = state.hands[1][4];
		assert.equal(targetCard.inferred.length, 1);
		assert(targetCard.inferred[0].matches(0, 1));
	});

	it('can interpret a colour play clue on a partial stack', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		state.play_stacks[0] = 2;

		// Alice clues Bob red on slot 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: 0 }, giver: 0, list: [7], target: 1, turn: 0 };
		state.handle_action(action);

		// Bob's slot 3 should be inferred as r3
		const targetCard = state.hands[1][2];
		assert.equal(targetCard.inferred.length, 1);
		assert(targetCard.inferred[0].matches(0, 3));
	});

	it('can interpret a colour play clue through someone\'s hand', () => {
		const state = setup([
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'r1', 'xx', 'xx', 'xx']
		]);

		// Cathy's r1 is clued and inferred.
		state.hands[2][1].clued = true;
		state.hands[2][1].intersect('inferred', [{ suitIndex: 0, rank: 1 }, { suitIndex: 0, rank: 2 }]);
		console.log(Utils.logHand(state.hands[2]));

		// Alice clues Bob red on slot 3.
		const action = { type: 'clue', clue: { type: CLUE.COLOUR, value: 0 }, giver: 0, list: [7], target: 1, turn: 0 };
		state.handle_action(action);

		// Bob's slot 3 should be inferred as r2
		const targetCard = state.hands[1][2];
		assert.equal(targetCard.inferred.length, 1);
		assert(targetCard.inferred[0].matches(0, 2));
	});
});