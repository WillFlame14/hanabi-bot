// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { PLAYER, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION } from '../../src/constants.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { find_urgent_actions } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		logger.setLevel(logger.LEVELS.ERROR);

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === ACTION.RANK && bob_save.value === 1);
	});

	it('will give a rank tcm touching multiple trash cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === ACTION.RANK && bob_save.value === 1);
	});

	it('will not give a tcm if chop is trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop is a duplicated card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'g4', 'g4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop can be saved directly (critical)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'g5']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: ACTION.RANK, value: 5 });
	});

	it('will not give a tcm if chop can be saved directly (2 save)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], 4);

		state.play_stacks = [5, 0, 0, 2, 2];

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: ACTION.RANK, value: 2 });
	});

	it('will not give a tcm if a play can be given instead', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], 4);

		state.play_stacks = [5, 1, 0, 2, 2];

		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues);
		assert.equal(urgent_actions[1], undefined);
		assert.deepEqual(Utils.objPick(urgent_actions[2][0], ['type', 'value']), { type: ACTION.COLOUR, value: 1 });
	});
});
