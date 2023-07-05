// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, getRawInferences, expandShortCard } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('play clue', () => {
	it('can interpret a colour play clue touching one card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slot 2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [8], target: PLAYER.BOB });

		// Target card should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][1];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue touching multiple cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7, 8, 9], target: PLAYER.BOB });

		// Bob's slot 1 should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][0];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue touching chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		// Alice clues Bob red on slots 1, 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [5, 8, 9], target: PLAYER.BOB });

		// Bob's slot 5 (chop) should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][4];
		assert.deepEqual(getRawInferences(targetCard), ['r1'].map(expandShortCard));
	});

	it('can interpret a colour play clue on a partial stack', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx']
		]);

		state.play_stacks[COLOUR.RED] = 2;

		// Alice clues Bob red on slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7], target: PLAYER.BOB });

		// Bob's slot 3 should be inferred as r3.
		const targetCard = state.hands[PLAYER.BOB][2];
		assert.deepEqual(getRawInferences(targetCard), ['r3'].map(expandShortCard));
	});

	it('can interpret a colour play clue through someone\'s hand', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'r1', 'xx', 'xx', 'xx']
		]);

		// Cathy's r1 is clued and inferred.
		state.hands[PLAYER.CATHY][1].clued = true;
		state.hands[PLAYER.CATHY][1].intersect('possible', ['r1', 'r2', 'r3', 'r4', 'r5'].map(expandShortCard));
		state.hands[PLAYER.CATHY][1].intersect('inferred', ['r1'].map(expandShortCard));

		// Alice clues Bob red on slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [7], target: PLAYER.BOB });

		// Bob's slot 3 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][2];
		assert.deepEqual(getRawInferences(targetCard), ['r2'].map(expandShortCard));
	});

	it('can interpret a self-connecting colour play clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['xx', 'xx', 'xx', 'xx', 'xx'],
		]);

		// Bob has a 1 in slot 2.
		state.hands[PLAYER.BOB][1].clued = true;
		state.hands[PLAYER.BOB][1].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		state.hands[PLAYER.BOB][1].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		// Alice clues Bob red in slots 1 and 2 (filling in red 1).
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [8, 9], target: PLAYER.BOB });

		// Bob's slot 1 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][0];
		assert.deepEqual(getRawInferences(targetCard), ['r2'].map(expandShortCard));
	});
});
