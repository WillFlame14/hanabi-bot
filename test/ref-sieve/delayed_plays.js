import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import { CLUE_INTERP } from '../../src/conventions/ref-sieve/rs-constants.js';
import RefSieve from '../../src/conventions/ref-sieve.js';

import logger from '../../src/tools/logger.js';


logger.setLevel(logger.LEVELS.ERROR);

describe('delayed plays', () => {
	it('gives a delayed play clue through a playable card', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y4', 'y4', 'g4'],
			['b2', 'b4', 'p4', 'p4', 'g4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Bob');
		takeTurn(game, 'Alice clues blue to Cathy');

		assert.equal(game.lastMove, CLUE_INTERP.REF_PLAY);
	});

	it('gives a delayed play clue through the leftmost playable card', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'r1', 'y4', 'y4', 'g4'],
			['b2', 'b4', 'p4', 'p4', 'g4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Bob');
		takeTurn(game, 'Alice clues blue to Cathy');

		assert.equal(game.lastMove, CLUE_INTERP.REF_PLAY);
	});

	it(`doesn't give a delayed play clue through a non-leftmost playable card`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'r1', 'y4', 'y4', 'g4'],
			['r2', 'b4', 'p4', 'p4', 'g4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Bob');
		takeTurn(game, 'Alice clues blue to Cathy');

		// This clue doesn't work.
		assert.equal(game.lastMove, CLUE_INTERP.NONE);
	});
});
