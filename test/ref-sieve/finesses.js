import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { COLOUR, PLAYER, preClue, setup, takeTurn } from '../test-utils.js';
import { CLUE } from '../../src/constants.js';
import { CLUE_INTERP } from '../../src/conventions/ref-sieve/rs-constants.js';
import RefSieve from '../../src/conventions/ref-sieve.js';

import logger from '../../src/tools/logger.js';


logger.setLevel(logger.LEVELS.ERROR);

describe('finesses', () => {
	it('recognizes a finesse via ref play', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'r4', 'y4', 'y4', 'g4'],
			['b2', 'b4', 'r2', 'p4', 'g4']
		]);

		takeTurn(game, 'Alice clues blue to Cathy');

		// Bob's b1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['b1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].finessed, true);
	});

	it('recognizes a finesse via fill-in', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'b4', 'y4', 'g4'],
			['b2', 'r4', 'y4', 'p4', 'g4']
		], {
			init: (game) => {
				preClue(game, game.state.hands[PLAYER.CATHY][0], [{ type: CLUE.COLOUR, value: COLOUR.BLUE, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues 2 to Cathy');

		// Bob's b1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['b1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].finessed, true);
	});

	it('plays into a finesse', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'r4', 'g4', 'p4', 'g4'],
			['y4', 'y4', 'b4', 'r4', 'p4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Bob');

		// We should be finessed in slot 1 for r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it(`doesn't play into a satisfied finesse`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y4', 'b4', 'p4', 'g4'],
			['r2', 'y4', 'g4', 'r4', 'p4'],
			['g5', 'b4', 'r3', 'y3', 'g3']
		], {
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues yellow to Cathy');		// finessing Bob's r1

		// We shouldn't be finessed in slot 1 for r1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, false);
	});

	it('writes the correct notes on potential finesses', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'r4', 'g4', 'p4', 'g4'],
			['r1', 'y4', 'b4', 'r4', 'p4']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Alice (slot 2)');

		// Alice's slot 1 could be any non-green 1, or r2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r1', 'r2', 'y1', 'b1', 'p1']);

		takeTurn(game, 'Cathy discards r1', 'g5');

		// Alice's slot 1 can be any non-green 1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r1', 'y1', 'b1', 'p1']);
	});

	it('recognizes a finesse via fill-in', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r4', 'r4', 'p4', 'g4'],
			['r2', 'y4', 'b4', 'g4', 'p4']
		], {
			init: (game) => {
				// Cathy's slot 1 is clued with red.
				preClue(game, game.state.hands[PLAYER.CATHY][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues 2 to Cathy');

		// Bob's slot 1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].finessed, true);
	});

	it('plays into a finesse via fill-in', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'r4', 'r4', 'p4', 'g4'],
			['y4', 'y4', 'b4', 'g4', 'p4']
		], {
			starting: PLAYER.CATHY,
			init: (game) => {
				// Bob's slot 1 is clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Cathy clues 2 to Bob');

		// Alice's slot 1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it('understands a prompt + finesse', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y4', 'b4', 'p4', 'g4'],
			['r2', 'y4', 'g4', 'r4', 'p4'],
			['g5', 'b4', 'r3', 'y3', 'g3']
		], {
			init: (game) => {
				// Bob's slot 1 is clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues yellow to Donald');

		// Bob's slot 1 should become known r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r1']);

		// Cathy's slot 1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0]], ['r2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0]].finessed, true);
	});

	it('understands a prompt + finesse', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y4', 'b4', 'p4', 'g4'],
			['r2', 'y4', 'g4', 'r4', 'p4'],
			['g5', 'b4', 'r3', 'y3', 'g3']
		], {
			init: (game) => {
				// Bob's slot 1 is clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues yellow to Donald');

		// Bob's slot 1 should become known r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r1']);

		// Cathy's slot 1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0]], ['r2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0]].finessed, true);
	});
});

describe('self-finesses', () => {
	it('understands a self-finesse', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'b4', 'g4', 'p4']
		], {
			init: (game) => {
				// Bob's slot 2 is clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][1], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues 2 to Bob');

		// Bob's slot 1 should be finessed.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].finessed, true);
	});

	it(`doesn't give self-finesses that look direct`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'b4', 'g4', 'p4']
		]);

		takeTurn(game, 'Alice clues blue to Bob');

		// This clue is nonsensical.
		assert.equal(game.lastMove, CLUE_INTERP.NONE);
	});

	it(`doesn't give self-finesses that look direct 2`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y4', 'b4', 'p4', 'g4'],
			['r2', 'r3', 'g4', 'r4', 'p4']
		]);

		takeTurn(game, 'Alice clues green to Cathy');

		// This clue is nonsensical.
		assert.equal(game.lastMove, CLUE_INTERP.NONE);
	});
});
