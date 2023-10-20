import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('sarcastic discards', () => {
	it('sarcastic discards to chop', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b4', 'r2', 'r3', 'g5']
		], {
			play_stacks: [0, 0, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Alice (slot 1)');
		takeTurn(state, 'Alice plays b1 (slot 2)');
		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');

		// Alice should discard g2 as sarcastic.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.DISCARD, target: state.hands[PLAYER.ALICE][1].order });
	});

	it('sarcastic discards to a clued card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b4', 'g2', 'r1', 'g5']
		], {
			play_stacks: [0, 0, 1, 0, 0]
		});

		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob clues green to Alice (slot 1)');
		takeTurn(state, 'Alice plays b1 (slot 2)');
		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');

		// Alice should discard g2 as sarcastic.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.DISCARD, target: state.hands[PLAYER.ALICE][1].order });
	});
});
