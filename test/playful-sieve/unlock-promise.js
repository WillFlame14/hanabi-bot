import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('giving clues while locked', () => {
	it('gives colour clues to playable slot 1', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'b4', 'r5', 'r3', 'r3']
		]);

		takeTurn(state, 'Alice clues 5 to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 5)');

		// Alice should clue purple to Bob to tell him about p1.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.COLOUR, value: COLOUR.PURPLE, target: PLAYER.BOB });

		takeTurn(state, 'Alice clues purple to Bob');

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][0].order], ['p1']);
	});

	it('gives referential discards', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p5', 'b4', 'r5', 'r3', 'r1']
		]);

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 5)');

		// Alice should clue 5 to prevent Bob from discarding slot 1.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.RANK, value: 5, target: PLAYER.BOB });

		takeTurn(state, 'Alice clues 5 to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][1].order].called_to_discard, true);
	});

	it('understands colour stalls', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p3', 'b4', 'y1', 'r3', 'g4']
		], {
			play_stacks: [0, 0, 0, 0, 5],
			discarded: ['r3']
		});

		takeTurn(state, 'Alice clues blue to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 5)');
		takeTurn(state, 'Alice clues red to Bob');

		// Bob should not be called to play slot 5.
		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][4].order].finessed, false);
	});
});

describe('unlock promise', () => {
	it('unlocks from a directly connecting card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b4', 'r5', 'g3', 'r3']
		]);

		takeTurn(state, 'Alice clues 5 to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 5)');
		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'p1');

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][4].order], ['r2']);
	});

	it('unlocks from an unknown card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b4', 'r5', 'g3', 'r3']
		]);

		takeTurn(state, 'Alice clues 5 to Bob');
		takeTurn(state, 'Bob clues purple to Alice (slot 5)');
		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'p1');

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][3].order], ['r2']);
	});

	it('unlocks from a shifted directly connecting card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b4', 'r5', 'g3', 'r3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 3,4)');
		takeTurn(state, 'Alice discards y4 (slot 5)');
		takeTurn(state, 'Bob clues purple to Alice (slot 3)');		// Lock, Alice's hand is [xx, xx, p, 2, 2]

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob discards b4', 'b1');
		takeTurn(state, 'Alice clues blue to Bob');
		takeTurn(state, 'Bob plays r1', 'p1');			// Bob plays r1 after shifting once

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][3].order], ['r2']);
	});

	it('unlocks from a new directly connecting card after a shift', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b4', 'r5', 'g3', 'r3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 3,4)');
		takeTurn(state, 'Alice discards y4 (slot 5)');
		takeTurn(state, 'Bob clues purple to Alice (slot 3)');		// Lock, Alice's hand is [xx, xx, p, 2, 2]

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob discards b4', 'b1');
		takeTurn(state, 'Alice clues blue to Bob');
		takeTurn(state, 'Bob plays b1', 'p1');			// Bob plays b1 (after shifting once for r1)

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][4].order], ['b2']);
	});

	it('unlocks from a shift past all directly connecting cards', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b4', 'r5', 'g3', 'r3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slot 4)');
		takeTurn(state, 'Alice discards y4 (slot 5)');
		takeTurn(state, 'Bob clues 5 to Alice (slots 2,3)');
		takeTurn(state, 'Alice discards b4 (slot 4)');
		takeTurn(state, 'Bob clues purple to Alice (slot 2)');		// Lock, Alice's hand is [xx, p, 5, 5, 2]

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob discards b4', 'b1');
		takeTurn(state, 'Alice clues blue to Bob');
		takeTurn(state, 'Bob plays r1', 'p1');			// Bob plays r1 after shifting once

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][0].order], ['r2']);
	});

	it('prefers unlocking over discarding trash', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'p2', 'r2', 'g4', 'r5']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');
		takeTurn(state, 'Alice clues 2 to Bob');
		takeTurn(state, 'Bob discards g4', 'p5');
		takeTurn(state, 'Alice clues red to Bob');				// Bob's hand is [xx, xx, 2, [r2], [r]5]
		takeTurn(state, 'Bob clues red to Alice (slots 3,4)');	// Alice's hand is [xx, xx, r1, r1, xx]

		const action = take_action(state);

		// Alice should play r1 instead of discarding.
		assert.equal(action.type, ACTION.PLAY, `Actual action was (${logPerformAction(action)})`);
		assert.ok([2,3].map(index => state.hands[PLAYER.ALICE][index].order).includes(action.target));
	});
});
