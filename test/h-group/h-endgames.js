import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, expandShortCard, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';

import { ACTION } from '../../src/constants.js';
import { solve_game } from '../../src/conventions/shared/endgame.js';
import { find_all_clues } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('simple endgames with 1 card left', () => {
	it('solves a cluable endgame', () => {
		const game = setup(HGroup, [
			['r5', 'xx', 'xx', 'xx'],
			['y5', 'r1', 'g1', 'b1'],
			['r4', 'b1', 'b1', 'g1'],
			['r4', 'p1', 'p1', 'b5'],
		], {
			play_stacks: [3, 4, 5, 4, 5],
			clue_tokens: 2,
			init: (game) => {
				const { common, state } = game;
				const a_slot1 = common.thoughts[state.hands[PLAYER.ALICE][0].order];
				a_slot1.inferred = a_slot1.inferred.intersect(expandShortCard('r5'));
				a_slot1.possible = a_slot1.possible.intersect(expandShortCard('r5'));
				a_slot1.clued = true;

				const d_slot4 = common.thoughts[state.hands[PLAYER.DONALD][3].order];
				d_slot4.inferred = d_slot4.inferred.intersect(expandShortCard('b5'));
				d_slot4.possible = d_slot4.possible.intersect(expandShortCard('b5'));
				d_slot4.clued = true;

				game.state.cardsLeft = 1;
			}
		});

		const action = solve_game(game, PLAYER.ALICE, find_all_clues);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});
});

describe('simple endgames with 1 undrawn identity', () => {
	it('solves a cluable endgame', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'p4'],
			['p2', 'g3', 'b1', 'b3', 'p3'],
			['y1', 'b1', 'p5', 'r3', 'y3'],
		], {
			play_stacks: [5, 5, 5, 4, 3],
			clue_tokens: 5,
			init: (game) => {
				const { common, state } = game;
				const a_slot5 = common.thoughts[state.hands[PLAYER.ALICE][4].order];
				a_slot5.inferred = a_slot5.inferred.intersect(expandShortCard('p4'));
				a_slot5.possible = a_slot5.possible.intersect(expandShortCard('p4'));
				a_slot5.clued = true;

				const b_slot5 = common.thoughts[state.hands[PLAYER.BOB][4].order];
				b_slot5.inferred = b_slot5.inferred.intersect(expandShortCard('p3'));
				b_slot5.possible = b_slot5.possible.intersect(expandShortCard('p3'));
				b_slot5.clued = true;

				const c_slot3 = common.thoughts[state.hands[PLAYER.CATHY][3].order];
				c_slot3.inferred = c_slot3.inferred.intersect(expandShortCard('p5'));
				c_slot3.possible = c_slot3.possible.intersect(expandShortCard('p5'));
				c_slot3.clued = true;
				game.state.cardsLeft = 2;
			}
		});

		const action = solve_game(game, PLAYER.ALICE, find_all_clues);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});
});
