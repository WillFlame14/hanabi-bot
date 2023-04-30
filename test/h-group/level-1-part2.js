// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';
import { ACTION } from '../../src/constants.js';

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

		// Bob's last 3 cards are clued
		[2,3,4].forEach(index => state.hands[PLAYER.BOB][index].clued = true);

		// Cathy's last 2 cards are clued
		[3,4].forEach(index => state.hands[PLAYER.CATHY][index].clued = true);

		const action = take_action(state);

		// Alice should give green to Cathy to finesse over save
		assert.deepEqual(Utils.objPick(action, ['type', 'target', 'value']), { type: ACTION.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN });
	});

});
