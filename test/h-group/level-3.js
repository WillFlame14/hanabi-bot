// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup } from '../test-utils.js';
import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

import { order_1s } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('playing 1s in the correct order', () => {
	it('plays 1s from right to left', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [1, 2]);
	});

    it('plays fresh 1s', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

        // Slot 1 is a new card
		state.hands[PLAYER.ALICE][0].order = 10;

		// Bob clues Alice 1, touching slots 1 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 10], target: PLAYER.ALICE });

        const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [10, 1]);
    });

    it('plays chop focus', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

        // Slot 1 is a new card
        state.hands[PLAYER.ALICE][0].order = 10;

		// Bob clues Alice 1, touching slots 1, 2 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [0, 3, 10], target: PLAYER.ALICE });

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [0, 10, 3]);
    });

	it ('does not prompt playable 1s', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'r2', 'g3', 'r5', 'b3'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Bob clues Alice 1, touching slots 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [2, 3], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues Bob red, touching r2 and r5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [6, 8], target: PLAYER.BOB });

		// Alice should continue playing slot 3 (not slot 2 as prompt).
		const action = state.take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 2 });
	});
});