import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands k2/5 save with black for multiple touches', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues black to Alice (slots 4,5)');

		assert.ok(['k2', 'k5'].every(id =>
			game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});

	it('understands k2/5 save with black for filling in', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			play_stacks: [2, 0, 0, 0, 0],
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues 3 to Alice (slots 1,3)');
		takeTurn(game, 'Alice plays r3 (slot 1)');
		takeTurn(game, 'Bob clues black to Alice (slots 3,5)');

		assert.ok(['k2', 'k5'].every(id =>
			game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});
});
