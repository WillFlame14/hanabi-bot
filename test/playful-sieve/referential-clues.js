import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ref play', () => {
	it('understands a referential play', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		]);

		takeTurn(game, 'Alice clues green to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1]], ['r1', 'y1', 'b1', 'p1']);
	});

	it('understands a gapped referential play', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b1', 'g4']
		]);

		takeTurn(game, 'Alice clues purple to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][3]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3]], ['r1', 'y1', 'g1', 'b1']);
	});

	it('understands a rightmost biased referential play', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g5', 'p2', 'b2', 'b1']
		]);

		takeTurn(game, 'Alice clues blue to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][4]], ['b1']);
	});

	it('understands a loaded colour clue', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'b2']
		]);

		takeTurn(game, 'Alice clues green to Bob');
		takeTurn(game, 'Bob clues 1 to Alice (slot 5)');
		takeTurn(game, 'Alice clues red to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].finessed, true);

		takeTurn(game, 'Bob plays b1', 'p1');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][4]], ['y1', 'b2', 'p1']);
	});

	it('understands a playable colour clue is also referential', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'b2']
		], {
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Alice (slot 2)');

		const slot3 = game.common.thoughts[game.state.hands[PLAYER.ALICE][2]];
		assert.equal(slot3.finessed, true);
	});
});

describe('ref discard', () => {
	it('understands a referential discard', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Alice clues 3 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1]].called_to_discard, true);
	});

	it('understands a gapped referential discard', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b3', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Alice clues 3 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2]].called_to_discard, true);
	});

	it('retains a call to discard after getting a play', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b2', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob clues red to Alice (slot 2)');
		takeTurn(game, 'Alice plays g1 (slot 3)');
		takeTurn(game, 'Bob plays b2', 'p1');

		// Bob's slot 3 should still be called to discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2]].called_to_discard, true);
	});

	it('retains a call to discard after a sarcastic discard', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b2', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob clues red to Alice (slot 2)');
		takeTurn(game, 'Alice plays g1 (slot 3)');
		takeTurn(game, 'Bob discards b2', 'p1');

		// Bob's slot 3 should still be called to discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2]].called_to_discard, true);
	});
});

describe('trash push', () => {
	it('understands a trash push with rank', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 3)');

		const slot4 = game.common.thoughts[game.state.hands[PLAYER.ALICE][3]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot4.finessed, true);
		assert.ok(playables.includes(slot4.order));
	});

	it('understands a trash push touching old cards', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays p2 (slot 2)');
		takeTurn(game, 'Bob clues 2 to Alice (slots 1,3)');

		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot2.finessed, true);
		assert.ok(playables.includes(slot2.order));
	});

	it('wraps around a loaded trash push', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays p2 (slot 2)');
		takeTurn(game, 'Bob clues 1 to Alice (slot 5)');

		const slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot1.finessed, true);
		assert.ok(playables.includes(slot1.order));
	});
});
