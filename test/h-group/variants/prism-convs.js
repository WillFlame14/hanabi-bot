import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands prism save with colour', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			clue_tokens: 6,
			starting: PLAYER.BOB,
			variant: VARIANTS.PRISM,
			discarded: ['i3']
		});

		takeTurn(game, 'Bob clues green to Alice (slot 5)');

		assert.ok(game.common.thoughts[0].inferred.has(expandShortCard('i3')));
	});

	it('understands not all color is prism save', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 6,
			clue_tokens: 6,
			starting: PLAYER.BOB,
			variant: VARIANTS.PRISM,
			discarded: ['i3']
		});

		takeTurn(game, 'Bob clues blue to Alice (slot 5)');

		[1, 2, 3, 4, 5].forEach(rank => assert.ok(!game.common.thoughts[0].inferred.has({ suitIndex: 4, rank })));
	});
});
