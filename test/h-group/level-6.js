import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('tempo clue chop moves', () => {
	it(`doesn't tccm before level 6`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: 5 });

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'y5');
		takeTurn(state, 'Cathy clues 2 to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][4].order].chop_moved, false);
	});

	it('understands a tccm', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: 6 });

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'y5');
		takeTurn(state, 'Cathy clues 2 to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][4].order].chop_moved, true);
	});

	it('understands a tccm on self', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'y5', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 6,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues red to Alice (slots 1,2)');
		takeTurn(state, 'Alice plays r1 (slot 1)');
		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');

		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][4].order].chop_moved, true);
	});

	it(`doesn't tccm if locked`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g2', 'r4', 'y3'],
			['b5', 'y5', 'g5', 'r5'],
			['b4', 'p3', 'g1', 'g1']
		], {
			level: 6,
			starting: PLAYER.DONALD
		});

		takeTurn(state, 'Donald clues 5 to Cathy');
		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob plays g1 (slot 1)', 'y2');
		takeTurn(state, 'Cathy clues 2 to Bob');

		// TODO: This should work even if Cathy clues green, as long as a higher priority clue is available (level 9, stalling).

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][3].order].chop_moved, false);
	});

	it(`doesn't tccm if getting a chop moved card`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g2', 'r1', 'y2'],
			['b2', 'y1', 'g5', 'r5'],
			['b4', 'p3', 'g1', 'g4']
		], {
			level: 6,
			play_stacks: [1, 1, 1, 1, 1],
			starting: PLAYER.DONALD
		});

		takeTurn(state, 'Donald clues 1 to Bob');
		takeTurn(state, 'Alice clues yellow to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][1].order].chop_moved, false);
	});

	it(`doesn't tccm if getting a playable in other hand`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p1', 'p2', 'r1', 'y1'],
			['b2', 'y5', 'g3', 'y3'],
			['b4', 'p4', 'g1', 'g1']
		], {
			level: 6,
			play_stacks: [2, 2, 2, 2, 0],
			discarded: ['y3'],
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues purple to Bob');
		takeTurn(state, 'Donald clues 3 to Cathy');

		// Gets p2 played, which unlocks touched g3 in Cathy's hand
		takeTurn(state, 'Alice clues 2 to Bob');

		assert.equal(state.common.thoughts[state.hands[PLAYER.BOB][3].order].chop_moved, false);
	});

	it(`prefers tccm to cm a useful card`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'r4', 'b4', 'p2', 'p1'],
			['b2', 'y5', 'g4', 'y1', 'p4'],
		], {
			level: 6,
			play_stacks: [5, 2, 2, 2, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues purple to Bob');

		const action = take_action(state);
		ExAsserts.objHasProperties(action, { target: PLAYER.BOB, type: ACTION.RANK, value: 2 });
	});
});

describe('multiple tempo clues', () => {
	it('understands a double tempo clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'g5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: 6 });

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'y5');
		takeTurn(state, 'Cathy clues red to Bob');

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][2].order], ['r3']);
	});

	it('understands a triple tempo clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'r4', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: 6 });

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'y5');
		takeTurn(state, 'Cathy clues red to Bob');

		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][3].order], ['r4']);
	});

	it('gives a triple tempo clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'r4', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: 6 });

		takeTurn(state, 'Alice clues red to Bob');
		takeTurn(state, 'Bob plays r1', 'y5');
		takeTurn(state, 'Cathy clues 5 to Alice (slot 5)');

		const { play_clues } = find_clues(state);

		const tempo_clue = play_clues[PLAYER.BOB].find(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED);
		assert.ok(tempo_clue);

		// The tempo clue gets r2, r3 and r4 to play.
		assert.equal(tempo_clue.result.playables.length, 3);
	});
});
