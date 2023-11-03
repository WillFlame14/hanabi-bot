import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('unknowing partner actions', () => {
	it('still takes permission to play when partner unknowingly plays a connecting card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'b4', 'r5', 'r3', 'g3']
		], {
			play_stacks: [0, 0, 1, 0, 5]
		});

		takeTurn(state, 'Alice clues 3 to Bob');
		takeTurn(state, 'Bob discards p1', 'p1');
		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob discards p1', 'b1');

		// Bob's slot 5 is known g3, and he just drew a playable b1. Alice bombs chop to give ptp, but she plays g2 (which connects)!
		takeTurn(state, 'Alice plays g2 (slot 1)');

		// Bob's slot 1 should still have ptp.
		assert.equal(state.hands[PLAYER.BOB][0].finessed, true);
	});

	it('still takes call to discard when partner unknowingly reveals a playable card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'b4', 'p1', 'g3', 'g5']
		], {
			play_stacks: [0, 0, 2, 0, 5],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Alice (slot 4)');
		takeTurn(state, 'Alice plays r1 (slot 5)');
		takeTurn(state, 'Bob clues 4 to Alice (slot 3)');

		// Alice's slot 5 is [g3,g5], but Bob unknowingly has g5 in his hand. Alice should still take ctd on slot 4.
		assert.equal(state.hands[PLAYER.ALICE][3].called_to_discard, true);
	});
});
