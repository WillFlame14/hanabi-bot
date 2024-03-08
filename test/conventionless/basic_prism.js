import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { isCluable } from '../../src/variants.js';

import logger from '../../src/tools/logger.js';
import { CLUE } from '../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

// TODO: Make this actually conventionless and not dependant on the HGroup conventions?

describe('prism cluing', () => {
	it('cannot clue prism', () => {
		assert.ok(!isCluable(
			{'id': 1465, 'name': 'Prism (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Prism']},
			{
				type: CLUE.COLOUR,
				value: 4,
			}
		));
	});

	it('understands prism touch', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 1465, 'name': 'Prism (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Prism']}
		},
		);

		takeTurn(state, 'Bob clues red to Alice (slot 1)');
		[1, 5].forEach(r =>
			assert.ok(state.common.thoughts[4].possible.has({suitIndex: 4, rank: r}))
		);
		[2, 3, 4].forEach(r =>
			assert.ok(!state.common.thoughts[4].possible.has({suitIndex: 4, rank: r}))
		);

		takeTurn(state, 'Alice clues blue to Bob');

		takeTurn(state, 'Bob clues green to Alice (slot 2)');
		assert.ok(state.common.thoughts[3].possible.has({suitIndex: 4, rank: 3}));
		[1, 2, 4, 5].forEach(r =>
			assert.ok(!state.common.thoughts[3].possible.has({suitIndex: 4, rank: r}))
		);
	});
});
