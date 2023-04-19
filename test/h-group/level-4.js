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

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

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

	it ('will not give a tcm if chop is trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert(save_clues[PLAYER.BOB] === undefined);
	});
});
