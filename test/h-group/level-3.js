import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import logger from '../../src/tools/logger.js';

import { order_1s } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('playing 1s in the correct order', () => {
	it('plays 1s from right to left', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: 3,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [1, 2]);
	});

	it('plays fresh 1s', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: 3,
			starting: PLAYER.BOB
		});

		// Slot 1 is a new card
		state.hands[PLAYER.ALICE][0].order = 10;

		takeTurn(state, 'Bob clues 1 to Alice (slots 1,4)');

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [10, 1]);
	});

	it('plays chop focus', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: 3,
			starting: PLAYER.BOB
		});

		// Slot 1 is a new card
		state.hands[PLAYER.ALICE][0].order = 10;

		takeTurn(state, 'Bob clues 1 to Alice (slots 1,2,5)');

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [0, 10, 3]);
	});

	it('does not prompt playable 1s', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'r2', 'g3', 'r5', 'b3'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: 3,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 2,3)');
		takeTurn(state, 'Cathy clues red to Bob');				// getting r2

		// Alice's slot 2 should still be any 1 (not prompted to be r1).
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][1], ['r1', 'y1', 'g1', 'b1', 'p1']);
	});
});

describe('sarcastic discard', () => {
	it('prefers sarcastic discard over playing', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y1', 'p4']
		], { level: 3 });

		takeTurn(state, 'Alice clues 1 to Bob');
		takeTurn(state, 'Bob clues yellow to Alice (slot 5)');

		// Alice should discard slot 5 as a Sarcastic Discard.
		const action = state.take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});

	it('understands a sarcastic discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'y1']
		], {
			level: 3,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slot 4)');
		takeTurn(state, 'Alice clues yellow to Bob');		// getting y1
		takeTurn(state, 'Bob discards y1', 'r1');			// sarcastic discard

		// Alice's slot 4 should be y1 now.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['y1']);
	});

	it('prefers playing if that would reveal duplicate is trash in endgame', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'y5', 'y4', 'p4'],
			['g4', 'b2', 'y1', 'y2', 'p1']
		], {
			level: 3,
			play_stacks: [0, 3, 0, 0, 1],
			starting: PLAYER.CATHY
		});

		// pace = currScore (4) + state.cardsLeft (19) + state.numPlayers (2) - maxScore (25) = 0
		state.cardsLeft = 19;

		// Bob's y4 is clued yellow.
		state.hands[PLAYER.BOB][3].intersect('inferred', ['y4'].map(expandShortCard));
		state.hands[PLAYER.BOB][3].intersect('possible', ['y1', 'y2', 'y3', 'y4'].map(expandShortCard));
		state.hands[PLAYER.BOB][3].clued = true;

		// Bob's y5 is known.
		state.hands[PLAYER.BOB][2].intersect('inferred', ['y5'].map(expandShortCard));
		state.hands[PLAYER.BOB][2].intersect('possible', ['y5'].map(expandShortCard));
		state.hands[PLAYER.BOB][2].clued = true;

		takeTurn(state, 'Cathy clues yellow to Alice (slot 5)');

		// Alice should play slot 5 instead of discarding for tempo.
		const action = state.take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 0 });
	});
});
