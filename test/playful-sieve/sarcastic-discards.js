import { describe, it } from 'node:test';
// import { strict as assert } from 'node:assert';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('sarcastic discards', () => {
	it('sarcastic discards to chop to prevent a bomb', () => {
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

	/*it('understands sarcastic discards to chop', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		], {
			play_stacks: [0, 0, 1, 0, 0]
		});

		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob plays b1', 'p5');
		takeTurn(state, 'Alice clues 2 to Bob');
		takeTurn(state, 'Bob discards g2', 'r1');

		// Alice should write [g1] on slot 1, in addition to being playable.
		const slot1 = state.common.thoughts[state.hands[PLAYER.ALICE][0].order];
		ExAsserts.cardHasInferences(slot1, ['g2']);
		assert.equal(slot1.finessed, true);
	});*/

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

/*describe('gentleman\'s discards', () => {
	it('performs gentleman\'s discards to rightmost when loaded on chop', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'r2', 'r3', 'g2']
		], {
			play_stacks: [0, 0, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Alice (slot 1)');
		takeTurn(state, 'Alice plays b1 (slot 2)');
		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');

		// Alice should discard g2 as a gentleman's discard.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.DISCARD, target: state.hands[PLAYER.ALICE][1].order });
	});

	it('understands gentleman\'s discards to rightmost', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		], {
			play_stacks: [0, 0, 1, 0, 0]
		});

		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob plays b1', 'p5');
		takeTurn(state, 'Alice clues 2 to Bob');
		takeTurn(state, 'Bob discards g2', 'r1');
		takeTurn(state, 'Alice plays p1 (slot 1)');

		// Alice should expect g2 in slot 5, as a Gentleman's Discard.
		const slot5 = state.common.thoughts[state.hands[PLAYER.ALICE][4].order];
		ExAsserts.cardHasInferences(slot5, ['g2']);
		assert.equal(slot5.finessed, true);
	});
});*/
