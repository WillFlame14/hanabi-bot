// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { CLUE } from '../../../src/constants.js';
import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('good touch principle', () => {
	it('eliminates from focus correctly (direct play)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 4];
		state.hypo_stacks = [0, 0, 0, 0, 4];

		// Bob clues purple to Alice, touching slots 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1], target: PLAYER.ALICE, giver: PLAYER.BOB });

		// Our slot 5 should be p5, and our slot 4 should have no inferences.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['p5'].map(expandShortCard));
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), [].map(expandShortCard));
	});

	it('eliminates from focus correctly (direct save)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 2, 0, 0];
		state.hypo_stacks = [0, 0, 2, 0, 0];

		// One g4 has been discarded.
		state.discard_stacks[COLOUR.GREEN] = [0, 0, 0, 1, 0];

		// Bob clues green to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });

		// Our slot 5 should be g4, and our slots 2 and 3 should have no inferences.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['g4'].map(expandShortCard));
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), [].map(expandShortCard));
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), [].map(expandShortCard));
	});

	it('eliminates from focus (indirect)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'b2', 'p2', 'r1'],
			['y3', 'r4', 'y2', 'p1', 'g3']
		], 1);

		state.play_stacks = [5, 2, 5, 3, 5];
		state.hypo_stacks = [5, 2, 5, 3, 5];

		// y4 is discarded.
		state.discard_stacks[COLOUR.YELLOW] = [0, 0, 0, 1, 0];

		// Bob clues 4 to Alice, touching slots 3 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, list: [0,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// The two 4's in Alice's hand should be inferred y4,b4.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), ['y4', 'b4'].map(expandShortCard));
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['y4', 'b4'].map(expandShortCard));

		// Cathy clues 4 to Bob, touching b4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, list: [8], target: PLAYER.BOB, giver: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Aice's slot 5 should be y4 only, and slot 3 should have no inferences.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][2]), []);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['y4'].map(expandShortCard));
	});

	it('generates a link from GTP', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 3];
		state.hypo_stacks = [0, 0, 0, 0, 3];

		// Bob clues purple to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 5 as p4.
		state.handle_action({ type: 'play', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 4 });
		state.handle_action({ type: 'draw', order: 10, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5.
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.hands[PLAYER.ALICE].links, expected_links);

		const playables = state.hands[PLAYER.ALICE].find_playables();
		assert.deepEqual(playables.map(c => c.order), []);
	});

	it('cleans up links properly (indirect clue)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 3];
		state.hypo_stacks = [0, 0, 0, 0, 3];

		// Bob clues purple to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 5 as p4.
		state.handle_action({ type: 'play', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 4 });
		state.handle_action({ type: 'draw', order: 10, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.hands[PLAYER.ALICE].links, expected_links);

		// Bob clues 5 to Alice, touching slot 3 (chop).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, list: [3], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// Link should be gone now
		assert.deepEqual(state.hands[PLAYER.ALICE].links, []);

		const trash = state.hands[PLAYER.ALICE].find_known_trash();
		assert.deepEqual(trash.map(c => c.order), [2, 1]);
	});

	it('cleans up links properly (direct clue)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 3];
		state.hypo_stacks = [0, 0, 0, 0, 3];

		// Bob clues purple to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 5 as p4.
		state.handle_action({ type: 'play', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 4 });
		state.handle_action({ type: 'draw', order: 10, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.hands[PLAYER.ALICE].links, expected_links);

		// Bob clues 5 to Alice, touching slot 5 (chop).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, list: [1], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// Link should be gone now
		assert.deepEqual(state.hands[PLAYER.ALICE].links, []);

		const trash = state.hands[PLAYER.ALICE].find_known_trash();
		assert.deepEqual(trash.map(c => c.order), [2]);
	});

	it('cleans up links properly (card drawn)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 3];
		state.hypo_stacks = [0, 0, 0, 0, 3];

		// Bob clues purple to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 5 as p4.
		state.handle_action({ type: 'play', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 4 });
		state.handle_action({ type: 'draw', order: 10, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.hands[PLAYER.ALICE].links, expected_links);

		// Bob discards, drawing p5.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 2, failed: false });
		state.handle_action({ type: 'draw', order: 11, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 5 });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// Link should be gone now
		assert.deepEqual(state.hands[PLAYER.ALICE].links, []);

		const trash = state.hands[PLAYER.ALICE].find_known_trash();
		assert.deepEqual(trash.map(c => c.order), [2, 1]);
	});

	it('cleans up links properly (card bombed)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p5', 'p4', 'p4', 'p3', 'p3'],
		], 1);

		state.play_stacks = [0, 0, 0, 0, 0];
		state.hypo_stacks = [0, 0, 0, 0, 0];

		// Bob clues purple to Alice, touching slots 3, 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, list: [0,1,2], target: PLAYER.ALICE, giver: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 5 as p1.
		state.handle_action({ type: 'play', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 1 });
		state.handle_action({ type: 'draw', order: 10, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob discards, drawing p2.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.handle_action({ type: 'draw', order: 11, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 2 });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p2.
		const expected_links = [{ cards: [3, 4].map(index => state.hands[PLAYER.ALICE][index]), identities: ['p2'].map(expandShortCard), promised: false }];
		assert.deepEqual(state.hands[PLAYER.ALICE].links, expected_links);

		// Alice bombs slot 5. It is p1.
		state.handle_action({ type: 'discard', order: 1, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 1, failed: true });
		state.handle_action({ type: 'draw', order: 12, playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1 });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.BOB });

		// Link should be gone now, Alice's new slot 5 should be p2.
		assert.deepEqual(state.hands[PLAYER.ALICE].links, []);
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][4]), ['p2'].map(expandShortCard));
	});
});
