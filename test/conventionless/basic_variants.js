import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { isCluable } from '../../src/variants.js';
import { isCritical } from '../../src/basics/hanabi-util.js';

import logger from '../../src/tools/logger.js';
import { CLUE } from '../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

// TODO: Make this actually conventionless and not dependant on the HGroup conventions?

describe('rainbow', () => {
	it('has rainbow possibilities from colour clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 16, 'name': 'Rainbow (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Rainbow']}
		},
		);

		takeTurn(state, 'Bob clues red to Alice (slot 1)');

		assert.ok(state.common.thoughts[4].possible.some(c => c.matches({suitIndex: 4, rank: 1})));
	});

	it('excludes rainbow possibilities from colour clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'p1', 'b3', 'b2', 'b5']
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 16, 'name': 'Rainbow (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Rainbow']}
		},
		);

		takeTurn(state, 'Bob clues red to Alice (slot 5)');

		assert.ok(!state.common.thoughts[4].possible.some(c => c.matches({suitIndex: 4, rank: 1})));
	});

	it('cannot clue rainbow', () => {
		assert.ok(!isCluable(
			{'id': 16, 'name': 'Rainbow (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Rainbow']},
			{
				type: CLUE.COLOUR,
				value: 4,
			}
		));
	});
});

describe('pink', () => {
	it('has pink possibilities from number clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 107, 'name': 'Pink (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Pink']}
		},
		);

		takeTurn(state, 'Bob clues 1 to Alice (slot 1)');

		assert.ok(state.common.thoughts[4].possible.some(c => c.matches({suitIndex: 4, rank: 5})));
	});

	it('excludes pink possibilities from number clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 107, 'name': 'Pink (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Pink']}
		},
		);

		takeTurn(state, 'Bob clues 1 to Alice (slot 5)');

		assert.ok(!state.common.thoughts[4].possible.some(c => c.matches({suitIndex: 4, rank: 5})));
	});

	it('can clue pink', () => {
		assert.ok(isCluable(
			{'id': 107, 'name': 'Pink (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Pink']},
			{
				type: CLUE.COLOUR,
				value: 4,
			}
		));
	});
});

describe('white', () => {
	it('eliminates white possibilities from colour clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 22, 'name': 'White (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'White']}
		},
		);

		takeTurn(state, 'Bob clues red to Alice (slot 1)');

		assert.ok(!state.common.thoughts[4].possible.some(c => c.matches({suitIndex: 4, rank: 1})));
	});

	it('cannot clue white', () => {
		assert.ok(!isCluable(
			{'id': 22, 'name': 'White (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'White']},
			{
				type: CLUE.COLOUR,
				value: 4,
			}
		));
	});
});

describe('black', () => {
	it('sees only black as critical', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			play_stacks: [0, 0, 0, 0, 0],
			clue_tokens: 8,
			starting: PLAYER.BOB,
			variant: {'id': 21, 'name': 'Black (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Black']}
		},
		);

		assert.ok(isCritical(state, {suitIndex: 4, rank: 1}));
		assert.ok(!isCritical(state, {suitIndex: 0, rank: 1}));
	});

	it('can clue black', () => {
		assert.ok(isCluable(
			{'id': 21, 'name': 'Black (5 Suits)', 'suits': ['Red', 'Yellow', 'Green', 'Blue', 'Black']},
			{
				type: CLUE.COLOUR,
				value: 4,
			}
		));
	});
});
