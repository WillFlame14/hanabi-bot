import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';

import { ACTION } from '../../src/constants.js';
import { winnable } from '../../src/conventions/shared/endgame.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('endgames with 1 card left', () => {
	it('clues to start b4 -> b5 endgame', () => {
		const game = setup(HGroup, [
			['y5', 'xx', 'xx', 'xx'],
			['b4', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r5'],
			['b4', 'p1', 'p1', 'r1'],
		], {
			play_stacks: [4, 4, 5, 3, 5]
		});

		game.state.cardsLeft = 1;

		const { actions, winrate } = winnable(game.state, PLAYER.ALICE, true);

		assert.equal(actions[0].type, ACTION.RANK);
		assert.equal(winrate, 1);
	});

	it('clues to start endgame on a double player with different suits', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'y4', 'g1', 'r1'],
			['g1', 'b1', 'b1', 'r1'],
			['y4', 'p1', 'p1', 'y5'],
		], {
			play_stacks: [5, 3, 4, 5, 5]
		});

		game.state.cardsLeft = 1;

		const { actions, winrate } = winnable(game.state, PLAYER.ALICE, true);

		assert.equal(actions[0].type, ACTION.RANK);
		assert.equal(winrate, 1);
	});

	it('plays to start endgame', () => {
		const game = setup(HGroup, [
			['r4', 'r4', 'xx', 'xx'],
			['b2', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r1'],
			['b2', 'p1', 'p1', 'r5'],
		], {
			play_stacks: [3, 5, 5, 4, 5]
		});

		game.state.cardsLeft = 1;

		const { actions, winrate } = winnable(game.state, PLAYER.ALICE, true);

		assert.equal(actions[0].type, ACTION.PLAY);
		assert.equal(winrate, 1);
	});

	it('plays to start endgame when other has dupes', () => {
		const game = setup(HGroup, [
			['p3', 'xx', 'xx', 'xx'],
			['b1', 'p4', 'g1', 'p4'],
			['g1', 'b1', 'b1', 'r1'],
			['r1', 'p1', 'p1', 'p5'],
		], {
			play_stacks: [5, 5, 5, 5, 2],
			discarded: ['p3']
		});

		game.state.cardsLeft = 1;

		const { actions, winrate } = winnable(game.state, PLAYER.ALICE, true);

		assert.equal(actions[0].type, ACTION.PLAY);
		assert.equal(winrate, 1);
	});
});
