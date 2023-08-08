import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { clue_safe } from '../../src/conventions/h-group/clue-finder/clue-safe.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous clues', () => {
	it('understands a fake finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Alice (slot 2)');

		// Alice's slot 2 should be [g1,g2].
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][1], ['g1', 'g2']);
		assert.equal(state.hands[PLAYER.CATHY][0].reasoning.length, 1);

		takeTurn(state, 'Cathy discards p3', 'r1');

		// Alice's slot 2 should just be g1 now.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][1], ['g1']);
	});

	it('understands a self-connecting play clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g3', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slot 4)');
		takeTurn(state, 'Cathy clues 2 to Alice (slot 3)');
		takeTurn(state, 'Alice plays g1 (slot 4)');

		// Alice's slot 4 (used to be slot 3) should just be g2 now.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['g2']);
	});

	it('understands a delayed finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
			['r3', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0]
		});

		takeTurn(state, 'Alice clues 2 to Cathy');
		takeTurn(state, 'Bob clues red to Alice (slot 3)');

		// Alice's slot 3 should be [r3,r4].
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][2], ['r3', 'r4']);

		takeTurn(state, 'Cathy plays r2', 'y1');

		// Alice's slot 3 should still be [r3,r4] to allow for the possibility of a hidden finesse.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][2], ['r3', 'r4']);

		takeTurn(state, 'Alice discards b1 (slot 5)');
		takeTurn(state, 'Bob discards b4', 'r1');
		takeTurn(state, 'Cathy plays r3', 'g1');

		// Alice's slot 4 (used to be slot 3) should be just [r4] now.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['r4']);
	});

	it('understands a fake delayed finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
			['r2', 'b3', 'r1', 'y3', 'p3']
		], { level: 5 });

		takeTurn(state, 'Alice clues 1 to Cathy');
		takeTurn(state, 'Bob clues red to Alice (slot 3)');
		takeTurn(state, 'Cathy plays r1', 'y1');

		takeTurn(state, 'Alice discards b1 (slot 5)');
		takeTurn(state, 'Bob discards b4', 'r1');
		takeTurn(state, 'Cathy discards p3', 'g1');

		// Alice's slot 4 (used to be slot 3) should be just [r2] now.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['r2']);
	});
});

describe('guide principle', () => {
	it('does not give a finesse leaving a critical on chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['r4', 'r3', 'b3', 'y3', 'b5']
		], { level: 5 });

		// Giving 3 to Cathy should be unsafe since b5 will be discarded.
		assert.equal(clue_safe(state, { type: CLUE.RANK, value: 3, target: PLAYER.CATHY }), false);
	});
});
