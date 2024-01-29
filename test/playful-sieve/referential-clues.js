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

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][1].order].finessed, true);
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][1].order], ['r1', 'y1', 'b1', 'p1']);
	});

	it('understands a gapped referential play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b1', 'g4']
		]);

		takeTurn(state, 'Alice clues purple to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][3].order].finessed, true);
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][3].order], ['r1', 'y1', 'g1', 'b1']);
	});

	it('understands a rightmost biased referential play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b2', 'b1']
		]);

		takeTurn(state, 'Alice clues blue to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][4].order].finessed, true);
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][4].order], ['b1']);
	});

	it('understands a loaded colour clue', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'b2']
		]);

		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob clues 1 to Alice (slot 5)');
		takeTurn(state, 'Alice clues red to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][4].order].finessed, true);

		takeTurn(state, 'Bob plays b1', 'p1');
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][4].order], ['y1', 'b2', 'p1']);
	});

	it('understands a playable colour clue is also referential', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'b2']
		], {
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues red to Alice (slot 2)');

		const slot3 = state.common.thoughts[state.hands[PLAYER.ALICE][2].order];
		assert.equal(slot3.finessed, true);
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

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][1].order].called_to_discard, true);
	});

	it('understands a gapped referential discard', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b3', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(state, 'Alice clues 3 to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][2].order].called_to_discard, true);
	});

	it('retains a call to discard after getting a play', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b2', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(state, 'Alice clues 2 to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 2)');
		takeTurn(state, 'Alice plays g1 (slot 3)');
		takeTurn(state, 'Bob plays b2', 'p1');

		// Bob's slot 3 should still be called to discard.
		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][2].order].called_to_discard, true);
	});

	it('retains a call to discard after a sarcastic discard', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b2', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(state, 'Alice clues 2 to Bob');
		takeTurn(state, 'Bob clues red to Alice (slot 2)');
		takeTurn(state, 'Alice plays g1 (slot 3)');
		takeTurn(state, 'Bob discards b2', 'p1');

		// Bob's slot 3 should still be called to discard.
		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][2].order].called_to_discard, true);
	});
});

describe('trash push', () => {
	it('understands a trash push with rank', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(state, 'Bob clues 1 to Alice (slot 3)');

		const slot4 = state.common.thoughts[state.hands[PLAYER.ALICE][3].order];
		const playables = state.common.thinksPlayables(state, PLAYER.ALICE);

		assert.equal(slot4.finessed, true);
		assert.ok(playables.some(p => p.order === slot4.order));
	});

	it('understands a trash push touching old cards', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(state, 'Alice plays p2 (slot 2)');
		takeTurn(state, 'Bob clues 2 to Alice (slots 1,3)');

		const slot2 = state.common.thoughts[state.hands[PLAYER.ALICE][1].order];
		const playables = state.common.thinksPlayables(state, PLAYER.ALICE);

		assert.equal(slot2.finessed, true);
		assert.ok(playables.some(p => p.order === slot2.order));
	});

	it('wraps around a loaded trash push', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(state, 'Alice plays p2 (slot 2)');
		takeTurn(state, 'Bob clues 1 to Alice (slot 5)');

		const slot1 = state.common.thoughts[state.hands[PLAYER.ALICE][0].order];
		const playables = state.common.thinksPlayables(state, PLAYER.ALICE);

		assert.equal(slot1.finessed, true);
		assert.ok(playables.some(p => p.order === slot1.order));
	});
});
