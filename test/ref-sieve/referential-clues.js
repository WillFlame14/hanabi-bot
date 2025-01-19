import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import RefSieve from '../../src/conventions/ref-sieve.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ref play', () => {
	it('understands a simple referential play', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'g2', 'r2', 'r3', 'g5']
		]);

		takeTurn(game, 'Alice clues green to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].called_to_play, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r1', 'y1', 'b1', 'p1']);
	});

	it('understands a gapped referential play', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'b1', 'p2', 'g5', 'g4']
		]);

		takeTurn(game, 'Alice clues purple to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1]].called_to_play, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1]], ['r1', 'y1', 'g1', 'b1']);
	});

	it('understands a referential play on chop', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b2', 'p2', 'b4', 'g5']
		]);

		takeTurn(game, 'Alice clues blue to Bob');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['b1']);
	});

	it('understands a loaded colour clue', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'g2', 'r1', 'b2', 'r3']
		]);

		takeTurn(game, 'Alice clues green to Bob');
		takeTurn(game, 'Bob clues 1 to Alice (slot 5)');
		takeTurn(game, 'Alice clues red to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][3]].called_to_play, true);

		takeTurn(game, 'Bob plays b1', 'p1');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3]], ['y1', 'b2', 'p1']);
	});

	it('understands a playable colour clue is also referential', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'b2']
		], {
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Alice (slot 2)');

		const slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0]];
		assert.equal(slot1.called_to_play, true);
	});
});

describe('ref discard', () => {
	it('understands a referential discard', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Alice clues 3 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1]].called_to_discard, true);
	});

	it('understands a gapped referential discard', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b3', 'r1', 'r3', 'r5']
		], {
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Alice clues 3 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2]].called_to_discard, true);
	});

	it('retains a call to discard after getting a play', () => {
		const game = setup(RefSieve, [
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
		const game = setup(RefSieve, [
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

	it('understands a lock', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'b2', 'r1', 'r5', 'r5']
		], {
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Alice clues 5 to Bob');

		assert.ok([0, 1, 2].every(i => game.common.thoughts[game.state.hands[PLAYER.BOB][i]].chop_moved));
	});
});

describe('trash push', () => {
	it('understands a trash push with rank', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 1, 1, 1, 1]
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 3)');

		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot2.called_to_play, true);
		assert.ok(playables.includes(slot2.order));
	});

	it('understands a trash push touching old cards', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays p2 (slot 2)');
		takeTurn(game, 'Bob clues 2 to Alice (slots 1,3)');

		const slot5 = game.common.thoughts[game.state.hands[PLAYER.ALICE][4]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot5.called_to_play, true);
		assert.ok(playables.includes(slot5.order));
	});

	it('wraps around a loaded trash push', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b1', 'r2', 'r4', 'g5']
		], {
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 2, 1]
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays p2 (slot 2)');
		takeTurn(game, 'Bob clues 1 to Alice (slot 1)');

		const slot5 = game.common.thoughts[game.state.hands[PLAYER.ALICE][4]];
		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);

		assert.equal(slot5.called_to_play, true);
		assert.ok(playables.includes(slot5.order));
	});
});
