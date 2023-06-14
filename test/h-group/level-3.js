// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

import { order_1s } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('playing 1s in the correct order', () => {
	it('plays 1s from right to left', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [1, 2]);
	});

	it('plays fresh 1s', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Slot 1 is a new card
		state.hands[PLAYER.ALICE][0].order = 10;

		// Bob clues Alice 1, touching slots 1 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 10], target: PLAYER.ALICE });

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [10, 1]);
	});

	it('plays chop focus', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Slot 1 is a new card
		state.hands[PLAYER.ALICE][0].order = 10;

		// Bob clues Alice 1, touching slots 1, 2 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [0, 3, 10], target: PLAYER.ALICE });

		const ordered_1s = order_1s(state, state.hands[PLAYER.ALICE]).map(c => c.order);
		assert.deepEqual(Array.from(ordered_1s), [0, 10, 3]);
	});

	it ('does not prompt playable 1s', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'r2', 'g3', 'r5', 'b3'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

		// Bob clues Alice 1, touching slots 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [2, 3], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues Bob red, touching r2 and r5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [6, 8], target: PLAYER.BOB });

		// Alice should continue playing slot 3 (not slot 2 as prompt).
		const action = state.take_action(state);
		console.log(Utils.logAction(action));
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 2 });
	});
});

describe('sarcastic discard', () => {
	it('prefers sarcastic discard over playing', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y1', 'p4']
		], 3);

		// Alice clues Bob 1, touching y1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues Alice yellow, touching slot 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [0], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice should discard slot 5 as a Sarcastic Discard.
		const action = state.take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.DISCARD, target: 0 });
	});

	it('understands a sarcastic discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'y1']
		], 3);

		// Bob clues Alice 1, touching slot 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice clues yellow to Bob, touching slots 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [5, 6], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob discards slot 5 as a Sarcastic Discard.
		state.handle_action({ type: 'discard', playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 1, order: 5, failed: false });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 4 should be y1 now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['y1'].map(expandShortCard));
	});

	it('prefers playing if that would reveal duplicate is trash in endgame', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'y5', 'y4', 'p4'],
			['g4', 'b2', 'y1', 'y2', 'p1']
		], 3);

		state.play_stacks = [0, 3, 0, 0, 1];
		state.hypo_stacks = [0, 3, 0, 0, 1];

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
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [0], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice should play slot 5 instead of discarding for tempo.
		const action = state.take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 0 });
	});
});
