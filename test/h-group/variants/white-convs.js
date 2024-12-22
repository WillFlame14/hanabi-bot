import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../../extra-asserts.js';

import { PLAYER, VARIANTS, setup, takeTurn } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('loaded play clues', () => {
	it('interprets 3 loaded', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 2 },
			discarded: ['w3'],
			starting: PLAYER.BOB,
			variant: VARIANTS.WHITE
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 2)');
		takeTurn(game, 'Alice clues 5 to Bob');
		takeTurn(game, 'Bob clues 3 to Alice (slot 5)');

		// Since Alice is loaded, this finesses slot 1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);

		takeTurn(game, 'Alice plays r1 (slot 2)');

		// SLot 2 (used to be slot 1) should now be r2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r2']);
	});
});
