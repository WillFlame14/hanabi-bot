import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ref play', () => {
	it('understands a referential play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		]);

		takeTurn(state, 'Alice clues green to Bob');

		assert.equal(state.hands[PLAYER.BOB][1].finessed, true);
		ExAsserts.cardHasInferences(state.hands[PLAYER.BOB][1], ['r1', 'y1', 'b1', 'p1']);
	});

	it('understands a gapped referential play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b1', 'g4']
		]);

		takeTurn(state, 'Alice clues purple to Bob');

		assert.equal(state.hands[PLAYER.BOB][3].finessed, true);
		ExAsserts.cardHasInferences(state.hands[PLAYER.BOB][3], ['r1', 'y1', 'g1', 'b1']);
	});

	it('understands a rightmost biased referential play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b2', 'b1']
		]);

		takeTurn(state, 'Alice clues blue to Bob');

		assert.equal(state.hands[PLAYER.BOB][4].finessed, true);
		ExAsserts.cardHasInferences(state.hands[PLAYER.BOB][4], ['b1']);
	});
});

describe('ref discard', () => {
	it('understands a referential discard', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(state, 'Alice clues 3 to Bob');

		assert.equal(state.hands[PLAYER.BOB][1].called_to_discard, true);
	});

	it('understands a gapped referential discard', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b3', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(state, 'Alice clues 3 to Bob');

		assert.equal(state.hands[PLAYER.BOB][2].called_to_discard, true);
	});
});
