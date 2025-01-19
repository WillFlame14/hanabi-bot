import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { COLOUR, PLAYER, preClue, setup, takeTurn } from '../test-utils.js';
import RefSieve from '../../src/conventions/ref-sieve.js';
import { CLUE_INTERP } from '../../src/conventions/ref-sieve/rs-constants.js';

import logger from '../../src/tools/logger.js';
import { CLUE } from '../../src/constants.js';


logger.setLevel(logger.LEVELS.ERROR);

describe('prompts', () => {
	it('recognizes a prompt via ref play', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'r1', 'y4', 'y4', 'g4'],
			['g1', 'b4', 'r2', 'p4', 'g4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Bob');		// getting b1. r1 clued
		takeTurn(game, 'Alice clues blue to Cathy');	// getting g1. b4 clued
		takeTurn(game, 'Bob plays b1', 'p3');

		takeTurn(game, 'Cathy plays g1', 'p3');
		takeTurn(game, 'Alice clues purple to Cathy');	// getting r2

		// Bob's r1 should be prompted.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1]], ['r1']);
	});

	it('recognizes a prompt via fill-in', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'r1', 'y4', 'y4', 'g4'],
			['g1', 'r2', 'b4', 'p4', 'g4']
		], {
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Bob');		// getting b1. r1 clued
		takeTurn(game, 'Alice clues red to Cathy');		// getting g1. r2 clued
		takeTurn(game, 'Bob plays b1', 'p3');

		takeTurn(game, 'Cathy plays g1', 'p3');
		takeTurn(game, 'Alice clues 2 to Cathy');	// getting r2

		// Bob's r1 should be prompted.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1]], ['r1']);
	});

	it('recognizes a double prompt via fill-in', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r2', 'r1', 'y4', 'g4'],
			['y4', 'r3', 'b4', 'p4', 'g4']
		], {
			init: (game) => {
				// Bob's slots 2 and 3 are clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][1], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
				preClue(game, game.state.hands[PLAYER.BOB][2], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);

				// Cathy's slot 2 is clued with red.
				preClue(game, game.state.hands[PLAYER.CATHY][1], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues 3 to Cathy');

		// Bob's r1 and r2 should be prompted.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][2]], ['r1']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1]], ['r2']);
	});

	it(`doesn't give double prompts without filling in`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r2', 'r1', 'y4', 'g4'],
			['y4', 'r3', 'b4', 'p4', 'g4']
		], {
			init: (game) => {
				// Bob's slots 2 and 3 are clued with red.
				preClue(game, game.state.hands[PLAYER.BOB][1], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
				preClue(game, game.state.hands[PLAYER.BOB][2], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE }]);
			}
		});

		takeTurn(game, 'Alice clues blue to Cathy');

		// This clue is nonsensical.
		assert.equal(game.lastMove, CLUE_INTERP.NONE);
	});

	it('plays into a prompt', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'r2', 'b4', 'p4', 'g4'],
			['y4', 'y4', 'g4', 'r4', 'p4']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Alice (slot 2)');	// getting b1. r1 clued
		takeTurn(game, 'Cathy clues red to Bob');			// getting g1. r2 clued
		takeTurn(game, 'Alice plays b1 (slot 1)');

		takeTurn(game, 'Bob plays g1', 'p3');
		takeTurn(game, 'Cathy clues 2 to Bob');		// getting r2

		// We should be prompted in slot 2 for r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r1']);
	});

	it(`doesn't play into a satisfied prompt`, () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y4', 'b4', 'p4', 'g4'],
			['r2', 'y4', 'g4', 'r4', 'p4'],
			['g5', 'b4', 'r3', 'y3', 'g3']
		], {
			starting: PLAYER.DONALD,
			init: (game) => {
				// Alice, Bob, and Cathy all have cards clued with red in slot 1.
				preClue(game, game.state.hands[PLAYER.ALICE][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.DONALD }]);
				preClue(game, game.state.hands[PLAYER.BOB][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.DONALD }]);
				preClue(game, game.state.hands[PLAYER.CATHY][0], [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.DONALD }]);
			}
		});

		takeTurn(game, 'Donald clues 2 to Cathy');		// prompting Bob's r2

		// We shouldn't be prompted in slot 1 for r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r3', 'r4', 'r5']);
	});
});
