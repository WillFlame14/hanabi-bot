import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous finesse', () => {
	it('understands an ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'b4', 'y5', 'y2', 'p4'],
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues Bob green.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

		// Donald's g1 should be finessed
		assert.deepEqual(state.hands[PLAYER.DONALD][0].finessed, true);

		// Donald discards.
		takeTurn(state, { type: 'discard', order: 15, playerIndex: PLAYER.DONALD, suitIndex: COLOUR.PURPLE, rank: 4, failed: false }, 'r1');

		// Alice's slot 2 should be [g1].
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][0], ['g1']);
	});

	it('understands an ambiguous finesse with a self component', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob clues Alice 2, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Cathy discards.
		takeTurn(state, { type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false }, 'r1');

		// Alice's slot 1 should be finessed.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, true);
	});

	it('passes back a layered ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b1', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob clues Alice 3, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Cathy discards.
		takeTurn(state, { type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false }, 'b3');

		// Alice should pass back, making her slot 1 not finessed and Cathy's slot 2 (used to be slot 1) finessed.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
		assert.equal(state.hands[PLAYER.CATHY][1].finessed, true);
	});

	it('understands an ambigous finesse pass-back', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b5', 'r3', 'y5', 'p4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues Bob 3, touching r3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });

		// Alice discards and draws y1.
		takeTurn(state, { type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });

		// Bob discards and draws b2, passing back the ambiguous finesse.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 3, failed: false }, 'b2');

		// Cathy clues 5 to Bob as a 5 Save.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [6,8], target: PLAYER.BOB });

		// Alice's slot 1 has now moved to slot 2.
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][1], ['r1']);
	});

	it('prefers hidden prompt over ambiguous', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'b4', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g2', 'y2', 'g5', 'b2']
		], {
			level: 5,
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.BOB
		});

		// Bob clues 2 to Donald.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [12,14,15], target: PLAYER.DONALD });

		// Cathy clues 4 to Bob, connecting on g2 (Donald, prompt) and g3 (Bob, finesse).
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.CATHY, list: [5], target: PLAYER.BOB });

		// Bob's slot 1 can be either g3 or y3, since he doesn't know which 1 is connecting.
		ExAsserts.cardHasInferences(state.hands[PLAYER.BOB][0], ['y3', 'g3']);
	});
});
