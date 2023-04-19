// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, getRawInferences, expandShortCard } from '../test-utils.js';
import { ACTION } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import * as Utils from '../../src/util.js';

import { determine_playable_card, find_urgent_actions } from '../../src/conventions/h-group/action-helper.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

describe('best playable card', () => {
	it('plays 1s from right to left', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

        // Slots 3 and 4 are clued with 1
		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[2].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[2].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		assert.deepEqual(playable_priorities[4][0], our_hand[3]);
	});

    it('plays fresh 1s', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

        // Slots 1 and 4 are clued with 1
		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[0].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[0].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

        // Slot 1 is a new card
        our_hand[0].order = 10;

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

        const playable_priorities = determine_playable_card(state, [our_hand[0], our_hand[3]]);
		assert.deepEqual(playable_priorities[4][0], our_hand[0]);
		assert.deepEqual(playable_priorities[4][1], our_hand[3]);
    });

    it('plays chop focus', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], 3);

        // Slots 1 and 4 are clued with 1
		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[0].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[0].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

        // Slot 1 is a new card
        our_hand[0].order = 10;

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

        // Slot 5 is clued, making slot 4 chop
        our_hand[4].clued = true;

        const playable_priorities = determine_playable_card(state, [our_hand[0], our_hand[3]]);
		assert.deepEqual(playable_priorities[4][0], our_hand[3]);
		assert.deepEqual(playable_priorities[4][1], our_hand[0]);
    });
});

describe('order chop move', () => {
	it('will find an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'r5']
		], 4);

		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[2].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[2].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[1][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[1][0].target, our_hand[2].order);
	});

	it('will find an ocm to cathy', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r3', 'y3', 'y4', 'y4'],
			['r4', 'r4', 'g4', 'r3', 'r5'],
		], 4);

		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[1].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[1].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		our_hand[2].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[2].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		const playable_priorities = determine_playable_card(state, [our_hand[1], our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[5][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[5][0].target, our_hand[1].order);
	});

	it('will not give an ocm putting a critical on chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r5']
		], 4);

		const our_hand = state.hands[state.ourPlayerIndex];
		our_hand[2].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[2].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		our_hand[3].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		our_hand[3].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[1][0].type, ACTION.RANK);
		assert.equal(urgent_actions[1][0].target, PLAYER.BOB);
		assert.equal(urgent_actions[1][0].value, 5);
	});
});
