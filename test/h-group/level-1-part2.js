// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';
import { ACTION, CLUE } from '../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue', () => {
	it('prefers play over save with >1 clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
			['g3', 'p1', 'b3', 'b2', 'b5']
		]);

		state.play_stacks = [1, 5, 1, 0, 5];
		state.clue_tokens = 2;

		// Bob's last 3 cards are clued.
		[2,3,4].forEach(index => state.hands[PLAYER.BOB][index].clued = true);

		// Cathy's last 2 cards are clued.
		[3,4].forEach(index => state.hands[PLAYER.CATHY][index].clued = true);

		const action = take_action(state);

		// Alice should give green to Cathy to finesse over save
		assert.deepEqual(Utils.objPick(action, ['type', 'target', 'value']), { type: ACTION.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN });
	});

	it('prefers touching less cards to save critical cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'g5', 'p2', 'p4', 'g4']
		]);

		// g4 is discarded.
		state.discard_stacks[COLOUR.GREEN] = [0, 0, 0, 1, 0];

		// Bob's p2 is clued.
		state.hands[PLAYER.BOB][2].clued = true;

		const action = take_action(state);

		// Alice should give green to Bob instead of 4
		assert.deepEqual(Utils.objPick(action, ['type', 'target', 'value']), { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN });
	});

	/*it('understands that a save clue cannot be a finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'y4', 'p4', 'b5', 'p3'],
			['g1', 'b4', 'r5', 'y4', 'g4']
		]);

		// Blue stack is at 1.
		state.play_stacks[COLOUR.BLUE] = 1;

		// b3 is both discarded.
		state.discard_stacks[COLOUR.BLUE] = [0, 0, 0, 0, 0];

		// Cathy clues Alice's slot 5 with blue.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.BLUE }, giver: PLAYER.CATHY, list: [0], target: PLAYER.ALICE });

		console.log(JSON.stringify(getRawInferences(state.hands[PLAYER.ALICE][4])));
		// assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['b2', 'b3'].map(expandShortCard));
		// assert.equal(state.hands[PLAYER.BOB][0].finessed, false);
		assert.equal(state.waiting_connections.length, 0);

		// We discard slot 4.
		state.handle_action({ type: 'discard', order: 1, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 4, failed: false });

		// Bob discards slot 5.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });

		console.log(JSON.stringify(getRawInferences(state.hands[PLAYER.ALICE][3])));
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['b2', 'b3'].map(expandShortCard));
	});*/
});
