import { describe, it } from 'node:test';

import { PLAYER, VARIANTS, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('visible elim', () => {
	it('correctly visibly eliminates 5s', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'g5'],
			['g3', 'p1', 'b3', 'b5'],
			['r3', 'b2', 'r1', 'y5']
		], {
			level: { min: 1 },
			play_stacks: [5, 0, 0, 0, 0, 0],
			starting: PLAYER.DONALD,
			variant: VARIANTS.SIX_SUITS
		});

		takeTurn(game, 'Donald clues green to Alice (slot 1)');
		takeTurn(game, 'Alice clues 5 to Bob');
		takeTurn(game, 'Bob clues 5 to Cathy');
		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues 5 to Alice (slots 3,4)');

		const { common, state } = game;

		ExAsserts.cardHasPossibilities(common.thoughts[state.hands[PLAYER.ALICE][2]], ['p5', 't5']);
		ExAsserts.cardHasPossibilities(common.thoughts[state.hands[PLAYER.ALICE][3]], ['p5', 't5']);
		ExAsserts.cardHasPossibilities(common.thoughts[state.hands[PLAYER.BOB][3]], ['g5']);
		ExAsserts.cardHasPossibilities(common.thoughts[state.hands[PLAYER.CATHY][3]], ['b5']);
		ExAsserts.cardHasPossibilities(common.thoughts[state.hands[PLAYER.DONALD][3]], ['y5']);
	});

	it(`doesn't eliminate when the clue giver holds dupes`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'b1', 'g2', 'r2'],
			['g3', 'p1', 'b3', 'b5'],
			['r3', 'y5', 'r1', 'r2']
		], {
			level: { min: 1 },
			play_stacks: [0, 2, 0, 2, 0]
		});

		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob clues 2 to Donald');

		const { common, state } = game;

		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][2]], ['r2', 'g2', 'p2']);
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][3]], ['r2', 'g2', 'p2']);
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.DONALD][3]], ['r2', 'g2', 'p2']);
	});
});
