import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, expandShortCard, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION } from '../../src/constants.js';
import { solve_game } from '../../src/conventions/shared/endgame.js';
import logger from '../../src/tools/logger.js';
import { logObjectiveAction } from '../../src/tools/log.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('simple endgames with 1 card left', () => {
	it('clues to start b4 -> b5 endgame', () => {
		const game = setup(HGroup, [
			['y5', 'xx', 'xx', 'xx'],
			['b4', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r5'],
			['b4', 'p1', 'p1', 'r1'],
		], {
			play_stacks: [4, 4, 5, 3, 5],
			init: (game) => {
				const { common, state } = game;
				const a_slot1 = common.thoughts[state.hands[PLAYER.ALICE][0]];
				a_slot1.inferred = a_slot1.inferred.intersect(expandShortCard('y5'));

				const [b_slot1, b_slot4] = [0, 3].map(i => common.thoughts[state.hands[PLAYER.BOB][i]]);
				b_slot1.inferred = b_slot1.inferred.intersect(expandShortCard('b4'));
				b_slot4.inferred = b_slot4.inferred.intersect(expandShortCard('b5'));

				const c_slot4 = common.thoughts[state.hands[PLAYER.CATHY][3]];
				c_slot4.inferred = c_slot4.inferred.intersect(expandShortCard('r5'));

				const d_slot1 = common.thoughts[state.hands[PLAYER.DONALD][0]];
				d_slot1.inferred = d_slot1.inferred.intersect(expandShortCard('b4'));

				game.state.cardsLeft = 1;
			}
		});

		const action = solve_game(game, PLAYER.ALICE);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR, `expected clue, selected ${logObjectiveAction(game.state, action)}`);
	});

	it('clues to start endgame on a double player with different suits', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'y4', 'g1', 'r1'],
			['g1', 'b1', 'b1', 'r1'],
			['y4', 'p1', 'p1', 'y5'],
		], {
			play_stacks: [5, 3, 4, 5, 5],
			init: (game) => {
				const { common, state } = game;
				const [b_slot1, b_slot2] = [0, 1].map(i => common.thoughts[state.hands[PLAYER.BOB][i]]);
				b_slot1.inferred = b_slot1.inferred.intersect(expandShortCard('g5'));
				b_slot2.inferred = b_slot2.inferred.intersect(expandShortCard('y4'));

				const [d_slot1, d_slot4] = [0, 3].map(i => common.thoughts[state.hands[PLAYER.DONALD][i]]);
				d_slot1.inferred = d_slot1.inferred.intersect(expandShortCard('y4'));
				d_slot4.inferred = d_slot4.inferred.intersect(expandShortCard('y5'));

				game.state.cardsLeft = 1;
			}
		});

		const action = solve_game(game, PLAYER.ALICE);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR, `expected clue, selected ${logObjectiveAction(game.state, action)}`);
	});

	it('plays to start endgame', () => {
		const game = setup(HGroup, [
			['r4', 'r4', 'xx', 'xx'],
			['b2', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r1'],
			['b2', 'p1', 'p1', 'r5'],
		], {
			play_stacks: [3, 5, 5, 4, 5],
			init: (game) => {
				const { common, state } = game;
				const [a_slot1, a_slot2] = [0, 1].map(i => common.thoughts[state.hands[PLAYER.ALICE][i]]);
				a_slot1.inferred = a_slot1.inferred.intersect(expandShortCard('r4'));
				a_slot2.inferred = a_slot2.inferred.intersect(expandShortCard('r4'));

				const b_slot4 = common.thoughts[state.hands[PLAYER.BOB][3]];
				b_slot4.inferred = b_slot4.inferred.intersect(expandShortCard('b5'));

				const d_slot4 = common.thoughts[state.hands[PLAYER.DONALD][3]];
				d_slot4.inferred = d_slot4.inferred.intersect(expandShortCard('r5'));

				game.state.cardsLeft = 1;
			}
		});

		// Alice should play r4.
		const action = solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});

	it('plays to start endgame when other has dupes', () => {
		const game = setup(HGroup, [
			['p3', 'xx', 'xx', 'xx'],
			['b1', 'p4', 'g1', 'p4'],
			['g1', 'b1', 'b1', 'r1'],
			['r1', 'p1', 'p1', 'p5'],
		], {
			play_stacks: [5, 5, 5, 5, 2],
			discarded: ['p3'],
			init: (game) => {
				const { common, state } = game;
				const a_slot1 = common.thoughts[state.hands[PLAYER.ALICE][0]];
				a_slot1.inferred = a_slot1.inferred.intersect(expandShortCard('p3'));

				const [b_slot2, b_slot4] = [1, 3].map(i => common.thoughts[state.hands[PLAYER.BOB][i]]);
				b_slot2.inferred = b_slot2.inferred.intersect(expandShortCard('p4'));
				b_slot4.inferred = b_slot4.inferred.intersect(expandShortCard('p4'));

				const d_slot4 = common.thoughts[state.hands[PLAYER.DONALD][3]];
				d_slot4.inferred = d_slot4.inferred.intersect(expandShortCard('p5'));

				game.state.cardsLeft = 1;
			}
		});

		// Alice should play p3.
		const action = solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});
});

describe('more complex endgames where all cards are seen', () => {
	it('plays to start endgame 1', () => {
		const game = setup(HGroup, [
			['xx', 'p3', 'p4', 'r5', 'r4'],
			['b1', 'r1', 'g1', 'p5', 'p2'],
			['g1', 'b1', 'r4', 'r1', 'g5']
		], {
			play_stacks: [3, 5, 4, 5, 1],
			init: (game) => {
				const { common, state } = game;
				const a_hand = state.hands[PLAYER.ALICE].map(o => common.thoughts[o]);
				['p3', 'p4', 'r5', 'r4'].map((id, i) => a_hand[i + 1].inferred = a_hand[i + 1].inferred.intersect(expandShortCard(id)));

				const [b_slot4, b_slot5] = [3, 4].map(i => common.thoughts[state.hands[PLAYER.BOB][i]]);
				b_slot4.inferred = b_slot4.inferred.intersect(expandShortCard('p5'));
				b_slot5.inferred = b_slot5.inferred.intersect(expandShortCard('p2'));

				const c_slot5 = common.thoughts[state.hands[PLAYER.CATHY][4]];
				c_slot5.inferred = c_slot5.inferred.intersect(expandShortCard('g5'));

				game.state.cardsLeft = 4;
			}
		});

		// Alice should play r4.
		const action = solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
	});
});
