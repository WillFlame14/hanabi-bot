import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, assertCardHasInferences, setup, takeTurn } from '../../test-utils.js';
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
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0],
			starting: PLAYER.BOB
		});

		// Cathy's r2 was previously clued with 2.
		state.hands[PLAYER.CATHY][2].clued = true;
		state.hands[PLAYER.CATHY][2].intersect('possible', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].intersect('inferred', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].clues.push({ type: CLUE.RANK, value: 2 });

		// Bob clues Alice 3, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Alice's slot 3 should be [r3,g3].
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r3', 'g3']);

		// Cathy plays r2 thinking it is a prompt.
		takeTurn(state, { type: 'play', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 2 }, 'r1');

		// Alice's slot 3 should still be [r3,g3] to allow for the possibility of a hidden finesse.
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r3', 'g3']);
	});

	it('understands a fake hidden finesse (rank)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0],
			starting: PLAYER.BOB
		});

		// Cathy's r2 was previously clued with 2.
		state.hands[PLAYER.CATHY][2].clued = true;
		state.hands[PLAYER.CATHY][2].intersect('possible', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].intersect('inferred', ['r2', 'y2', 'g2', 'b2', 'p2'].map(expandShortCard));
		state.hands[PLAYER.CATHY][2].clues.push({ type: CLUE.RANK, value: 2 });

		// Bob clues Alice 3, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Cathy plays r2 thinking it is a prompt.
		takeTurn(state, { type: 'play', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 2 }, 'b1');

		// Alice discards.
		takeTurn(state, { type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });

		// Bob discards.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false }, 'r1');

		// Cathy discards.
		takeTurn(state, { type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false }, 'y1');

		// Alice's slot 4 (used to be 3) should just be r3 now.
		assertCardHasInferences(state.hands[PLAYER.ALICE][3], ['r3']);
	});

	it('plays into a hidden finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r2', 'r3', 'p1', 'b4'],
			['p2', 'g4', 'y2', 'b4', 'p5']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues 1 to us, touching slots 2 and 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.CATHY, list: [2,3], target: PLAYER.ALICE });

		// We play slot 3 as y1.
		takeTurn(state, { type: 'play', order: 2, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.YELLOW, rank: 1 });

		// Bob clues 5 to Cathy.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.BOB, list: [10], target: PLAYER.CATHY });

		// Cathy clues red to Bob, touching r2 as a hidden finesse.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [7,8], target: PLAYER.BOB });

		// We play slot 3 as r1, but it turns out to be b1!
		takeTurn(state, { type: 'play', order: 3, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });

		// Our slot 1 (now slot 2) should be r1.
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['r1']);
	});
});

describe('layered finesse', () => {
	it('understands a layered finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'y1', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob clues Alice yellow, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Alice's slot 3 should be [y1,y2].
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['y1', 'y2']);

		// Cathy plays g1 thinking it is y1.
		takeTurn(state, { type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 }, 'b1');

		// Alice discards.
		takeTurn(state, { type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });

		// Bob discards.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false }, 'r1');

		// Cathy plays y1.
		takeTurn(state, { type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.YELLOW, rank: 1 }, 'y1');

		// Alice's slot 4 (used to be slot 3) should be y2 now.
		assertCardHasInferences(state.hands[PLAYER.ALICE][3], ['y2']);
	});

	it('understands playing into a layered finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3', 'r3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues Bob yellow, touching y2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });

		// Alice's slot 1 should be [y1].
		assertCardHasInferences(state.hands[PLAYER.ALICE][0], ['y1']);

		// Alice plays slot 1, but it is actually g1!
		takeTurn(state, { type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.GREEN, rank: 1 });

		// Alice's slot 2 should be [y1] now.
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['y1']);
	});

	it('does not try giving layered finesses on the same card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'y1', 'p1', 'r5', 'b4'],
			['r2', 'y4', 'p2', 'g3', 'r3']
		], { level: 5 });

		const { play_clues } = find_clues(state);

		// Purple does not work as a layered finesse
		assert.equal(play_clues[PLAYER.CATHY].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.PURPLE), false);
	});

	it('gracefully handles clues that reveal layered finesses (non-matching)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'r2', 'y1', 'p4', 'y4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob bombs y4 and draws g3.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 4, failed: true }, 'g3');

		// Cathy clues Bob red, touching r2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

		// Alice plays slot 1, which is revealed to be b1! Alice then draws something random.
		takeTurn(state, { type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });

		// Bob clues yellow to Alice, touching slots 2 and 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.BOB, list: [0,3], target: PLAYER.ALICE });

		// Alice's slot 2 (the yellow card) should be finessed as y1.
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['y1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r1']);
	});

	it('gracefully handles clues that reveal layered finesses (matching)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'r2', 'y1', 'p4', 'r4'],
			['y4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob bombs r4 and draws g3.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 4, failed: true }, 'g3');

		// Cathy clues Bob red, touching r2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

		// Alice plays slot 1, which is revealed to be b1! Alice then draws y1.
		takeTurn(state, { type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1 });

		// Bob clues red to Alice, touching slots 3 and 5.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [0,2], target: PLAYER.ALICE });

		// Alice's slot 2 should be finessed as [y1, g1, b2, p1].
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['y1', 'g1', 'b2', 'p1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r1']);
	});

	it('plays correctly into layered finesses with self-connecting cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y2', 'r5', 'r4'],
			['g1', 'r1', 'b5', 'g4', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues yellow to Bob, touching y2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });

		// We play slot 1, but it turns out to be p1!
		takeTurn(state, { type: 'play', order: 4, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 1 });

		// Bob discards and draws b2.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 4, failed: false }, 'b2');

		// Cathy discards and draws b3.
		takeTurn(state, { type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.BLUE, rank: 4, failed: false }, 'b3');

		// We play slot 2, but it turns out to be p2!
		takeTurn(state, { type: 'play', order: 3, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 2 });

		// y1 should be in slot 3 now.
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['y1']);
	});

	it('understands a clandestine finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob clues Alice 2, touching slot 3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });

		// Alice's slot 3 should be [g2,r2].
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r2', 'g2']);

		// Cathy plays g1 thinking it is r1.
		takeTurn(state, { type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 }, 'b1');

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		assertCardHasInferences(state.hands[PLAYER.ALICE][2], ['r2', 'g2']);

		// Alice discards.
		takeTurn(state, { type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, failed: false });

		// Bob discards and draws g5.
		takeTurn(state, { type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false }, 'g5');

		// Cathy plays r1.
		takeTurn(state, { type: 'play', order: 13, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 1 }, 'r1');

		// Alice's slot 4 (used to be 3) should just be r2 now.
		assertCardHasInferences(state.hands[PLAYER.ALICE][3], ['r2']);
	});

	it('understands a queued finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		// Bob clues Cathy green.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });

		// Alice's slot 1 should be [g1].
		assertCardHasInferences(state.hands[PLAYER.ALICE][0], ['g1']);

		// Cathy clues 2 to Bob.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

		// Alice's slot 2 should be [r1].
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['r1']);

		// Alice should play slot 1 first.
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: state.hands[PLAYER.ALICE][0].order });
	});

	it('waits for a queued finesse to resolve', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'r1', 'r4', 'g4', 'b4']
		], { level: 5 });

		// Alice clues Bob green.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.ALICE, list: [9], target: PLAYER.BOB });

		// Bob clues red to Alice, touching slot 2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.BOB, list: [3], target: PLAYER.ALICE });

		// Cathy plays g1.
		takeTurn(state, { type: 'play', order: 14, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.GREEN, rank: 1 }, 'r1');

		// Alice's slot 2 should still be [r1, r2].
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['r1', 'r2']);
	});

	it('plays queued finesses in the right order', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues 2 to Bob.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

		// Alice plays slot 1, but it is revealed to be b1!
		takeTurn(state, { type: 'play', order: 4, suitIndex: COLOUR.BLUE, rank: 1, playerIndex: PLAYER.ALICE });

		// Bob clues Cathy green.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });

		// Cathy discards and draws y1.
		takeTurn(state, { type: 'discard', order: 10, suitIndex: COLOUR.PURPLE, rank: 3, playerIndex: PLAYER.CATHY, failed: false }, 'y1');

		// Alice should play slot 2 first (continue digging for r1).
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: state.hands[PLAYER.ALICE][1].order });
	});
});
