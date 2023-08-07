import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import * as Utils from '../../src/tools/util.js';
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

		// Bob clues Alice 1, touching slots 3 and 4.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

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

		// Bob clues Alice 1, touching slots 1 and 4.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 10], target: PLAYER.ALICE });

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

		// Bob clues Alice 1, touching slots 1, 2 and 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [0, 3, 10], target: PLAYER.ALICE });

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

		// Bob clues Alice 1, touching slots 2 and 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [2, 3], target: PLAYER.ALICE });

		// Cathy clues Bob red, touching r2 and r5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [6, 8], target: PLAYER.BOB });

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

		// Alice clues Bob 1, touching y1.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6], target: PLAYER.BOB });

		// Bob clues Alice yellow, touching slot 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [0], target: PLAYER.ALICE });

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

		// Bob clues Alice 1, touching slot 4.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1], target: PLAYER.ALICE });

		// Alice clues yellow to Bob, touching slots 4 and 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [5, 6], target: PLAYER.BOB });

		// Bob discards slot 5 as a Sarcastic Discard.
		takeTurn(state, { type: 'discard', playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 1, order: 5, failed: false }, 'r1');

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

		// Cathy clues Alice yellow, touching slot 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [0], target: PLAYER.ALICE });

		// Alice should play slot 5 instead of discarding for tempo.
		const action = state.take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 0 });
	});
});
