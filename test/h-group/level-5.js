// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';
import { clue_safe } from '../../src/conventions/h-group/clue-finder/clue-safe.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous clues', () => {
	it('understands a fake finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
            ['g1', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Alice green, touching slot 2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [3], target: PLAYER.ALICE });

        // Alice's slot 2 should be [g1,g2].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['g1', 'g2'].map(expandShortCard));
        assert.equal(state.hands[PLAYER.CATHY][0].reasoning.length, 1);

        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 2 should just be g1 now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['g1'].map(expandShortCard));
	});

    it('understands a self-connecting play clue', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
            ['g1', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Alice 1, touching slot 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1], target: PLAYER.ALICE });

        // Cathy clues Alice 2, touching slot 3.
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.CATHY, list: [2], target: PLAYER.ALICE });

        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice plays the unknown 1 as g1.
        state.handle_action({ type: 'play', order: 1, suitIndex: COLOUR.GREEN, rank: 1, playerIndex: PLAYER.ALICE });
        state.handle_action({ type: 'draw', order: 15, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
        state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

        // Alice's slot 4 (used to be slot 3) should just be g2 now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['g2'].map(expandShortCard));
    });

    it('understands a delayed finesse', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
            ['r3', 'b3', 'r2', 'y3', 'p3']
		], 5);

		state.play_stacks = [1, 0, 1, 1, 0];

        // Alice clues 2 to Cathy.
        state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.ALICE, list: [12], target: PLAYER.CATHY });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues Alice red, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
        state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

        // Alice's slot 3 should be [r3,r4].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r3', 'r4'].map(expandShortCard));

        // Cathy plays r2.
        state.handle_action({ type: 'play', order: 12, suitIndex: COLOUR.RED, rank: 2, playerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.YELLOW, rank: 1, playerIndex: PLAYER.CATHY });

        state.update_turn(state, { type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 3 should still be [r3,r4] to allow for the possibility of a hidden finesse.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r3', 'r4'].map(expandShortCard));

        // Alice discards.
        state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.BOB });

        // Bob discards.
        state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
        state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.CATHY });

        // Cathy plays r3.
        state.handle_action({ type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 3 });
        state.update_turn(state, { type: 'turn', num: 6, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 4 (used to be slot 3) should be just [r4] now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r4'].map(expandShortCard));
    });

    it('understands a fake delayed finesse', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
            ['r2', 'b3', 'r1', 'y3', 'p3']
		], 5);

        // Alice clues 1 to Cathy.
        state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [12], target: PLAYER.CATHY });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues Alice red, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
        state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

        // Cathy plays r1.
        state.handle_action({ type: 'play', order: 12, suitIndex: COLOUR.RED, rank: 1, playerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.YELLOW, rank: 1, playerIndex: PLAYER.CATHY });

        state.update_turn(state, { type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

        // Alice discards.
        state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.BOB });

        // Bob discards.
        state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
        state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.CATHY });

        // Cathy discards.
        state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
        state.update_turn(state, { type: 'turn', num: 6, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 4 (used to be slot 3) should be just [r2] now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2'].map(expandShortCard));
    });
});

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
        state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

        // Bob discards.
        state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

        // Cathy plays y1.
        state.handle_action({ type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.YELLOW, rank: 1 });
        state.update_turn(state, { type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 4 (used to be slot 3) should be y2 now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['y2'].map(expandShortCard));
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

        // Alice's slot 2 should be [y1] now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['y1'].map(expandShortCard));
    });

    it('understands a clandestine finesse', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
            ['g1', 'r1', 'b2', 'y3', 'p3']
		], 5);

		// Bob clues Alice 2, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

        // Alice's slot 3 should be [g2,r2].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2', 'g2'].map(expandShortCard));

        // Cathy plays g1 thinking it is r1.
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 });

        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2', 'g2'].map(expandShortCard));

        // Alice discards.
        state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
        state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

        // Bob discards.
        state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

        // Cathy plays r1.
        state.handle_action({ type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 1 });
        state.update_turn(state, { type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 3 should just be r2 now.
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['r2'].map(expandShortCard));
    });

    it('understands a queued finesse', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
            ['g2', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Cathy green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });

        // Alice's slot 1 should be [g1].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][0]), ['g1'].map(expandShortCard));

        // Cathy clues 2 to Bob.
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [8], target: PLAYER.BOB });

        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 2 should be [r1].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['r1'].map(expandShortCard));
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
});

describe('ambiguous finesse', () => {
    it('understands an ambiguous finesse', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
            ['r1', 'b3', 'r2', 'y3', 'p3'],
            ['g1', 'b4', 'y5', 'y2', 'p4'],
		], 5);

		// Cathy clues Bob green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.DONALD });

        // Donald's g1 should be finessed
        assert.deepEqual(state.hands[PLAYER.DONALD][0].finessed, true);

        // Donald discards.
        state.handle_action({ type: 'discard', order: 15, playerIndex: PLAYER.DONALD, suitIndex: COLOUR.PURPLE, rank: 4, failed: false });
        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 2 should be [g1].
        assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][0]), ['g1'].map(expandShortCard));
    });

    it('understands an ambiguous finesse with a self component', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
            ['r1', 'b3', 'r2', 'y3', 'p3']
		], 5);

		// Bob clues Alice 2, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

        // Cathy discards.
        state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
        state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 1 should be finessed.
        assert.equal(state.hands[PLAYER.ALICE][0].finessed, true);
    });
});

describe('guide principle', () => {
    it('does not give a finesse leaving a critical on chop', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
            ['r4', 'r3', 'b3', 'y3', 'b5']
		], 5);

        // Giving 3 to Cathy should be unsafe since b5 will be discarded.
        assert.equal(clue_safe(state, { type: CLUE.RANK, value: 3, target: PLAYER.CATHY }), false);
    });
});