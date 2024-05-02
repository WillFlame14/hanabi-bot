import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { PLAYER, VARIANTS, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { isCluable } from '../../src/variants.js';

import logger from '../../src/tools/logger.js';
import { CLUE } from '../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

// TODO: Make this actually conventionless and not dependant on the HGroup conventions?

describe('prism cluing', () => {
	it('cannot clue prism', () => {
		assert.ok(!isCluable(VARIANTS.PRISM, { type: CLUE.COLOUR, value: 4 }));
	});

	it('understands prism touch', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			starting: PLAYER.BOB,
			variant: VARIANTS.PRISM
		});

		takeTurn(game, 'Bob clues red to Alice (slot 1)');
		ExAsserts.cardHasPossibilities(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r1', 'r2', 'r3', 'r4', 'r5', 'i1', 'i5']);

		takeTurn(game, 'Alice clues blue to Bob');
		takeTurn(game, 'Bob clues green to Alice (slot 2)');
		ExAsserts.cardHasPossibilities(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g1', 'g2', 'g3', 'g4', 'g5', 'i3']);
	});
});
