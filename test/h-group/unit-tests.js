// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, getRawInferences, expandShortCard } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import * as Utils from '../../src/util.js';

import { determine_playable_card } from '../../src/conventions/h-group/action-helper.js';

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

		const { card } = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		assert.deepEqual(card, our_hand[3]);
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

        const { card } = determine_playable_card(state, [our_hand[0], our_hand[3]]);
		assert.deepEqual(card, our_hand[0]);
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

        const { card } = determine_playable_card(state, [our_hand[0], our_hand[3]]);
		assert.deepEqual(card, our_hand[3]);
    });
});
