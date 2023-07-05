// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { ACTION, CLUE } from '../../src/constants.js';
import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import * as Utils from '../../src/tools/util.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue', () => {
	it('prefers play over save with >1 clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
			['g3', 'p1', 'b3', 'b2', 'b5']
		], 1);

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
		], 1);

		// g4 is discarded.
		state.discard_stacks[COLOUR.GREEN] = [0, 0, 0, 1, 0];

		// Bob's p2 is clued.
		state.hands[PLAYER.BOB][2].clued = true;

		const action = take_action(state);

		// Alice should give green to Bob instead of 4
		assert.deepEqual(Utils.objPick(action, ['type', 'target', 'value']), { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN });
	});

	it('generates correct inferences for a 2 Save', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'b2', 'y4'],
			['g5', 'b2', 'g2', 'y2'],
			['y3', 'g2', 'y1', 'b3']
		], 1);

		// Bob clues 2 to Cathy.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, list: [8,9,10], target: PLAYER.CATHY, giver: PLAYER.BOB });

		// g2 is visible in Donald's hand. Other than that, the saved 2 can be any 2.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.CATHY][3]), ['r2', 'y2', 'b2', 'p2'].map(expandShortCard));
	});

	it('does not finesse from a 2 Save', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2'],
			['g5', 'b4', 'g1', 'y2', 'b3']
		], 1);

		// Cathy clues 2 to Bob.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, list: [5,7], target: PLAYER.BOB, giver: PLAYER.CATHY });

		// Our slot 1 should not only be y1.
		assert.equal(state.hands[PLAYER.ALICE][0].inferred.length > 1, true);
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
	});
});

describe('early game', () => {
	it('will not 5 stall on a trash 5', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r5', 'r4', 'y4', 'b3'],
		], 1);

		// Discarded both r4's
		state.max_ranks[0] = 3;
		state.clue_tokens = 7;

		const action = state.take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.DISCARD, target: 0 });
	});
});
