// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../../src/constants.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';
import logger from '../../../src/tools/logger.js';
import * as Utils from '../../../src/tools/util.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('hidden finesse', () => {
	it('understands a hidden finesse (rank)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], 5);

		state.play_stacks = [1, 0, 1, 1, 0];
		state.hypo_stacks = [1, 0, 1, 1, 0];

		// Cathy's r2 was previously clued with 2.
		state.hands[PLAYER.CATHY][2].clued = true;
		state.hands[PLAYER.CATHY][2].intersect('possible', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].intersect('inferred', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].clues.push({ type: CLUE.RANK, value: 2 });

		// Bob clues Alice 3, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Alice's slot 3 should be [r3,g3].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r3', 'g3'].map(expandShortCard));

		// Cathy plays r2 thinking it is a prompt.
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'play', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 2 });

		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should still be [r3,g3] to allow for the possibility of a hidden finesse.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r3', 'g3'].map(expandShortCard));
	});

	it('understands a fake hidden finesse (rank)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], 5);

		state.play_stacks = [1, 0, 1, 1, 0];
		state.hypo_stacks = [1, 0, 1, 1, 0];

		// Cathy's r2 was previously clued with 2.
		state.hands[PLAYER.CATHY][2].clued = true;
		state.hands[PLAYER.CATHY][2].intersect('possible', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].intersect('inferred', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].clues.push({ type: CLUE.RANK, value: 2 });

		// Bob clues Alice 3, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Cathy plays r2 thinking it is a prompt.
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'play', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 2 });

		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice discards.
		state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob discards.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

		// Cathy discards.
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.update_turn(state, { type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should just be r3 now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r3'].map(expandShortCard));
	});

	it('plays into a hidden finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r2', 'r3', 'p1', 'b4'],
			['p2', 'g4', 'y2', 'b4', 'p5']
		], 5);

		// Cathy clues 1 to us, touching slots 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.CATHY, list: [2,3], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// We play slot 3 as y1.
		state.handle_action({ type: 'play', order: 2, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.YELLOW, rank: 1 });
		state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob clues 5 to Cathy.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.BOB, list: [10], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues red to Bob, touching r2 as a hidden finesse.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [7,8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.ALICE });

		// We play slot 3 as r1, but it turns out to be b1!
		state.handle_action({ type: 'play', order: 3, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });
		state.handle_action({ type: 'draw', order: 16, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.BOB });

		// Our slot 1 (now slot 2) should be r1.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['r1'].map(expandShortCard));
	});
});

describe('layered finesse', () => {
	it('understands a layered finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'y1', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Alice yellow, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Alice's slot 3 should be [y1,y2].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['y1', 'y2'].map(expandShortCard));

		// Cathy plays g1 thinking it is y1.
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 });

		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice discards.
		state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
		state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob discards.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

		// Cathy plays y1.
		state.handle_action({ type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.YELLOW, rank: 1 });
		state.update_turn(state, { type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 4 (used to be slot 3) should be y2 now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['y2'].map(expandShortCard));
	});

	it('understands playing into a layered finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3', 'r3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], 5);

		// Cathy clues Bob yellow, touching y2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });

		// Alice's slot 1 should be [y1].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][0]), ['y1'].map(expandShortCard));

		// Alice plays slot 1, but it is actually g1!
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.GREEN, rank: 1 });
		state.handle_action({ type: 'draw', order: 16, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });

		// Alice's slot 2 should be [y1] now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['y1'].map(expandShortCard));
	});

	it('does not try giving layered finesses on the same card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'y1', 'p1', 'r5', 'b4'],
			['r2', 'y4', 'p2', 'g3', 'r3']
		], 5);

		const { play_clues } = find_clues(state);

		// Purple does not work as a layered finesse
		assert.equal(play_clues[PLAYER.CATHY].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.PURPLE), false);
	});

	it('gracefully handles clues that reveal layered finesses (non-matching)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'r2', 'y1', 'p4', 'y4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], 5);

		// Bob bombs y4 and draws g3.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 4, failed: true });
		state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.GREEN, rank: 3, playerIndex: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues Bob red, touching r2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 1, which is revealed to be b1! Alice then draws y1.
		state.handle_action({ type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });
		state.handle_action({ type: 'draw', order: 16, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob clues yellow to Alice, touching slots 2 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [0,3], target: PLAYER.ALICE });

		// Alice's slot 2 (the yellow card) should be finessed as y1.
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['y1'].map(expandShortCard));

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r1'].map(expandShortCard));
	});

	it('gracefully handles clues that reveal layered finesses (matching)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'r2', 'y1', 'p4', 'r4'],
			['y4', 'g2', 'g4', 'r5', 'b4']
		], 5);

		// Bob bombs r4 and draws g3.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 4, failed: true });
		state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.GREEN, rank: 3, playerIndex: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues Bob red, touching r2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 1, which is revealed to be b1! Alice then draws y1.
		state.handle_action({ type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });
		state.handle_action({ type: 'draw', order: 16, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob clues red to Alice, touching slots 3 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [0,2], target: PLAYER.ALICE });

		// Alice's slot 2 should be finessed as [y1, g1, b2, p1].
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['y1', 'g1', 'b2', 'p1'].map(expandShortCard));

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r1'].map(expandShortCard));
	});

	it('plays correctly into layered finesses with self-connecting cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y2', 'r5', 'r4'],
			['g1', 'r1', 'b5', 'g4', 'b4']
		], 5);

		// Cathy clues yellow to Bob, touching y2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// We play slot 1, but it turns out to be p1! We draw y4.
		state.handle_action({ type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 1 });
		state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob discards and draws b2.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 4, failed: false });
		state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.BLUE, rank: 2, playerIndex: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.CATHY });

		// Cathy discards and draws b3.
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
		state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.BLUE, rank: 3, playerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.ALICE });

		// We play slot 2, but it turns out to be p2! We draw p3.
		state.handle_action({ type: 'play', order: 3, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 2 });
		state.handle_action({ type: 'draw', order: 17, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });

		// y1 should be in slot 3 now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['y1'].map(expandShortCard));
	});

	it('understands a clandestine finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], 5);

		// Bob clues Alice 2, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Alice's slot 3 should be [g2,r2].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2', 'g2'].map(expandShortCard));

		// Cathy plays g1 thinking it is r1.
		state.handle_action({ type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 });
		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2', 'g2'].map(expandShortCard));

		// Alice discards.
		state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
		state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob discards and draws g5.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
		state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.GREEN, rank: 5, playerIndex: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

		// Cathy plays r1.
		state.handle_action({ type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 1 });
		state.update_turn(state, { type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 4 (used to be 3) should just be r2 now.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['r2'].map(expandShortCard));
	});

	it('understands a queued finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Cathy green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Alice's slot 1 should be [g1].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][0]), ['g1'].map(expandShortCard));

		// Cathy clues 2 to Bob.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [8], target: PLAYER.BOB });
		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 2 should be [r1].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['r1'].map(expandShortCard));

		// Alice should play slot 1 first.
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: state.hands[PLAYER.ALICE][0].order });
	});

	it('waits for a queued finesse to resolve', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'r1', 'r4', 'g4', 'b4']
		], 5);

		// Alice clues Bob green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.ALICE, list: [9], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues red to Alice, touching slot 2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [3], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

		// Cathy plays g1.
		state.handle_action({ type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 });
		state.update_turn(state, { type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 2 should still be [r1, r2].
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['r1', 'r2'].map(expandShortCard));
	});

	it('plays queued finesses in the right order', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Cathy clues 2 to Bob.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Alice plays slot 1, but it is revealed to be b1! Alice then draws a card.
		state.handle_action({ type: 'play', order: 4, suitIndex: COLOUR.BLUE, rank: 1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob clues Cathy green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.CATHY });

		// Cathy discards and draws y1.
		state.handle_action({ type: 'discard', order: 10, suitIndex: COLOUR.PURPLE, rank: 3, playerIndex: PLAYER.CATHY, failed: false });
		state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.YELLOW, rank: 1, playerIndex: PLAYER.CATHY });
		state.update_turn(state, { type: 'turn', num: 4, currentPlayerIndex: PLAYER.ALICE });

		// Alice should play slot 2 first (continue digging for r1).
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: state.hands[PLAYER.ALICE][1].order });
	});
});
