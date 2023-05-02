// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous clues', () => {
	it('understands a fake finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
            ['g1', 'b3', 'r2', 'y3', 'p3']
		], 4);

		state.play_stacks = [0, 0, 0, 0, 0];

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
		], 4);

		state.play_stacks = [0, 0, 0, 0, 0];

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
});
