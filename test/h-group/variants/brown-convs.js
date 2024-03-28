import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ACTION } from '../../../src/constants.js';
import { COLOUR, PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands n2/5 save with brown', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			starting: PLAYER.BOB,
			variant: VARIANTS.BROWN
		});

		takeTurn(state, 'Bob clues brown to Alice (slot 5)');

		assert.ok(state.common.thoughts[0].inferred.has(expandShortCard('n2')));
		assert.ok(state.common.thoughts[0].inferred.has(expandShortCard('n5')));
	});

	it('will save n5 with brown', () => {
		// TODO: When expandShortForms and others works with variants, switch these to not fake brown as purple.
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b2', 'r2', 'r3', 'n5'],
		], {
			level: 1,
			clue_tokens: 5,
			variant: VARIANTS.BROWN
		});

		const action = take_action(state);

		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.PURPLE });
	});
});
