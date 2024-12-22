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

/**
 * @param {import('../../src/basics/Player.js').Player} common
 * @param {number} order
 * @param {string} id_hash
 * @returns {(draft: import('../../src/types.js').Writable<import('../../src/basics/Card.js').Card>) => void}
 */
const update_func = (common, order, id_hash) => (draft) => {
	draft.inferred = common.thoughts[order].inferred.intersect(expandShortCard(id_hash));
};

describe('simple endgames with 1 card left', () => {
	it('clues to start b4 -> b5 endgame', async () => {
		const game = setup(HGroup, [
			['y5', 'xx', 'xx', 'xx'],
			['b4', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r5'],
			['b4', 'p1', 'p1', 'r1'],
		], {
			play_stacks: [4, 4, 5, 3, 5],
			init: (game) => {
				const { common, state } = game;

				const a_slot1 = state.hands[PLAYER.ALICE][0];
				common.updateThoughts(a_slot1, update_func(common, a_slot1, 'y5'));

				const [b_slot1, b_slot4] = [0, 3].map(i => state.hands[PLAYER.BOB][i]);
				common.updateThoughts(b_slot1, update_func(common, b_slot1, 'b4'));
				common.updateThoughts(b_slot4, update_func(common, b_slot4, 'b5'));

				const c_slot4 = state.hands[PLAYER.CATHY][3];
				common.updateThoughts(c_slot4, update_func(common, c_slot4, 'r5'));

				const d_slot1 = state.hands[PLAYER.DONALD][0];
				common.updateThoughts(d_slot1, update_func(common, d_slot1, 'b4'));

				game.state.cardsLeft = 1;
			}
		});

		const action = await solve_game(game, PLAYER.ALICE);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR, `expected clue, selected ${logObjectiveAction(game.state, action)}`);
	});

	it('clues to start endgame on a double player with different suits', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'y4', 'g1', 'r1'],
			['g1', 'b1', 'b1', 'r1'],
			['y4', 'p1', 'p1', 'y5'],
		], {
			play_stacks: [5, 3, 4, 5, 5],
			init: (game) => {
				const { common, state } = game;
				const [b_slot1, b_slot2] = [0, 1].map(i => state.hands[PLAYER.BOB][i]);
				common.updateThoughts(b_slot1, update_func(common, b_slot1, 'g5'));
				common.updateThoughts(b_slot2, update_func(common, b_slot2, 'y4'));

				const [d_slot1, d_slot4] = [0, 3].map(i => state.hands[PLAYER.DONALD][i]);
				common.updateThoughts(d_slot1, update_func(common, d_slot1, 'y4'));
				common.updateThoughts(d_slot4, update_func(common, d_slot4, 'y5'));

				game.state.cardsLeft = 1;
			}
		});

		const action = await solve_game(game, PLAYER.ALICE);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR, `expected clue, selected ${logObjectiveAction(game.state, action)}`);
	});

	it('plays to start endgame', async () => {
		const game = setup(HGroup, [
			['r4', 'r4', 'xx', 'xx'],
			['b2', 'y1', 'g1', 'b5'],
			['g1', 'b1', 'b1', 'r1'],
			['b2', 'p1', 'p1', 'r5'],
		], {
			play_stacks: [3, 5, 5, 4, 5],
			init: (game) => {
				const { common, state } = game;
				const [a_slot1, a_slot2] = [0, 1].map(i => state.hands[PLAYER.ALICE][i]);
				common.updateThoughts(a_slot1, update_func(common, a_slot1, 'r4'));
				common.updateThoughts(a_slot2, update_func(common, a_slot2, 'r4'));

				const b_slot4 = state.hands[PLAYER.BOB][3];
				common.updateThoughts(b_slot4, update_func(common, b_slot4, 'b5'));

				const d_slot4 = state.hands[PLAYER.DONALD][3];
				common.updateThoughts(d_slot4, update_func(common, d_slot4, 'r5'));

				game.state.cardsLeft = 1;
			}
		});

		// Alice should play r4.
		const action = await solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});

	it('plays to start endgame when other has dupes', async () => {
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
				const a_slot1 = state.hands[PLAYER.ALICE][0];
				common.updateThoughts(a_slot1, update_func(common, a_slot1, 'p3'));

				const [b_slot2, b_slot4] = [1, 3].map(i => state.hands[PLAYER.BOB][i]);
				common.updateThoughts(b_slot2, update_func(common, b_slot2, 'p4'));
				common.updateThoughts(b_slot4, update_func(common, b_slot4, 'p4'));

				const d_slot4 = state.hands[PLAYER.DONALD][3];
				common.updateThoughts(d_slot4, update_func(common, d_slot4, 'p5'));

				game.state.cardsLeft = 1;
			}
		});

		// Alice should play p3.
		const action = await solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});
});

describe('more complex endgames where all cards are seen', () => {
	it('plays to start endgame 1', async () => {
		const game = setup(HGroup, [
			['xx', 'p3', 'p4', 'r5', 'r4'],
			['b1', 'r1', 'g1', 'p5', 'p2'],
			['g1', 'b1', 'r4', 'r1', 'g5']
		], {
			play_stacks: [3, 5, 4, 5, 1],
			init: (game) => {
				const { common, state } = game;
				['p3', 'p4', 'r5', 'r4'].forEach((id, i) => {
					const order = state.hands[PLAYER.ALICE][i + 1];
					common.updateThoughts(order, update_func(common, order, id));
				});

				const [b_slot4, b_slot5] = [3, 4].map(i => state.hands[PLAYER.BOB][i]);
				common.updateThoughts(b_slot4, update_func(common, b_slot4, 'p5'));
				common.updateThoughts(b_slot5, update_func(common, b_slot5, 'p2'));

				const c_slot5 = state.hands[PLAYER.CATHY][4];
				common.updateThoughts(c_slot5, update_func(common, c_slot5, 'g5'));

				game.state.cardsLeft = 4;
			}
		});

		// Alice should play r4.
		const action = await solve_game(game, PLAYER.ALICE);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
	});
});
