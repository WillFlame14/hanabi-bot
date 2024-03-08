import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands k2/5 save with black for multiple touches', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 21, 'name': 'Black (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Black']}
		});

		takeTurn(state, 'Bob clues black to Alice (slots 4,5)');

		assert.ok(state.common.thoughts[0].inferred.has({suitIndex: 4, rank: 2}));
		assert.ok(state.common.thoughts[0].inferred.has({suitIndex: 4, rank: 5}));
	});

	it('understands k2/5 save with black for filling in', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 21, 'name': 'Black (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Black']}
		});

		[1].forEach(index => state.hands[PLAYER.ALICE][index].clued = true);

		takeTurn(state, 'Bob clues black to Alice (slot 1,5)');

		assert.ok(state.common.thoughts[0].inferred.has({suitIndex: 4, rank: 2}));
		assert.ok(state.common.thoughts[0].inferred.has({suitIndex: 4, rank: 5}));
	});
});
