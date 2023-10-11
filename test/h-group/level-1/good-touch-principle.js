import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { HGroup_Hand as Hand } from '../../../src/conventions/h-hand.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('good touch principle', () => {
	it('eliminates from focus correctly (direct play)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2']
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 4],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 4,5)');

		// Our slot 5 should be p5, and our slot 4 should have no inferences.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['p5']);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], []);
	});

	it('eliminates from focus correctly (direct save)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: 1,
			play_stacks: [0, 0, 2, 0, 0],
			discarded: ['g4'],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Alice (slots 3,4,5)');

		// Our slot 5 should be g4, and our slots 2 and 3 should have no inferences.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['g4']);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], []);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][2], []);
	});

	it('eliminates from focus (indirect)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'b2', 'p2', 'r1'],
			['y3', 'r4', 'y2', 'p1', 'g3']
		], {
			level: 1,
			play_stacks: [5, 2, 5, 3, 5],
			discarded: ['y4'],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 4 to Alice (slots 3,5)');

		// The two 4's in Alice's hand should be inferred y4,b4.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][2], ['y4', 'b4']);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['y4', 'b4']);

		takeTurn(state, 'Cathy clues 4 to Bob');		// getting b4

		// Aice's slot 5 should be y4 only, and slot 3 should have no inferences.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][2], []);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['y4']);
	});

	it('eliminates from focus and gets known trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'r4', 'y2', 'p1', 'g3']
		], {
			level: 1,
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues red to Alice (slots 4,5)');

		const trash = Hand.find_known_trash(state, PLAYER.ALICE);
		assert.ok(trash[0]?.order === 1);
	});

	it('generates a link from GTP', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(state, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5.
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.links[PLAYER.ALICE], expected_links);

		const playables = Hand.find_playables(state, PLAYER.ALICE);
		assert.deepEqual(playables.map(c => c.order), []);
	});

	it('cleans up links properly (indirect clue)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(state, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.links[PLAYER.ALICE], expected_links);

		takeTurn(state, 'Bob clues 5 to Alice (slot 3)');

		// Link should be gone now
		assert.deepEqual(state.links[PLAYER.ALICE], []);

		const trash = Hand.find_known_trash(state, PLAYER.ALICE);
		assert.deepEqual(trash.map(c => c.order), [2, 1]);
	});

	it('cleans up links properly (direct clue)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(state, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.links[PLAYER.ALICE], expected_links);

		takeTurn(state, 'Bob clues 5 to Alice (slot 5)');

		// Link should be gone now
		assert.deepEqual(state.links[PLAYER.ALICE], []);

		const trash = Hand.find_known_trash(state, PLAYER.ALICE);
		assert.deepEqual(trash.map(c => c.order), [2]);
	});

	it('cleans up links properly (card drawn)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(state, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.links[PLAYER.ALICE], expected_links);

		takeTurn(state, 'Bob discards y2', 'p5');

		// Link should be gone now
		assert.deepEqual(state.links[PLAYER.ALICE], []);

		const trash = Hand.find_known_trash(state, PLAYER.ALICE);
		assert.deepEqual(trash.map(c => c.order), [2, 1]);
	});

	it('cleans up links properly (card bombed)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p5', 'p4', 'p4', 'p3', 'p3'],
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(state, 'Alice plays p1 (slot 5)');
		takeTurn(state, 'Bob discards p3 (slot 5)', 'p2');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p2.
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p2'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.links[PLAYER.ALICE], expected_links);

		takeTurn(state, 'Alice bombs p1 (slot 5)');

		// Link should be gone now, Alice's new slot 5 should be p2.
		assert.deepEqual(state.links[PLAYER.ALICE], []);
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['p2']);
	});

	it('plays from focus (no link)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'r2', 'p4', 'p3', 'b1'],
		], {
			level: 1,
			play_stacks: [5, 5, 1, 5, 5],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 1,3)');

		const playables = Hand.find_playables(state, PLAYER.ALICE);
		assert.deepEqual(playables.map(c => c.order), [4]);
	});

	it('plays from focus (link)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'r2', 'p4', 'p3', 'b1'],
		], {
			level: 1,
			play_stacks: [5, 5, 1, 5, 5],
			discarded: ['g2'],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slots 1,3)');

		const playables = Hand.find_playables(state, PLAYER.ALICE);
		assert.deepEqual(playables.map(c => c.order), [4]);
	});

	it('assumes good touch even when others are playing unknown cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'p2', 'g4', 'p1', 'g2']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slot 5)');
		takeTurn(state, 'Alice clues 1 to Bob');
		takeTurn(state, 'Bob plays p1', 'p4');

		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][4], ['r1', 'y1', 'g1', 'b1']);
	});
});
