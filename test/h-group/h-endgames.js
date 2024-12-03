import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';

import { ACTION, CLUE } from '../../src/constants.js';
import { solve_game } from '../../src/conventions/shared/endgame.js';
import { find_all_clues } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';
import { produce } from '../../src/StateProxy.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('simple endgames with 1 card left', () => {
	it('solves a basic cluable endgame', () => {
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

				const update1 = (draft) => {
					draft.clued = true;
					draft.clues.push({ giver: PLAYER.DONALD, type: CLUE.RANK, value: 5, turn: -1 });
					draft.clues.push({ giver: PLAYER.DONALD, type: CLUE.COLOUR, value: COLOUR.RED, turn: -1 });
				};

				const a_slot1 = state.hands[PLAYER.ALICE][0];
				state.deck = state.deck.with(a_slot1, produce(state.deck[a_slot1], update1));

				let { inferred, possible } = common.thoughts[a_slot1];
				common.updateThoughts(state.hands[PLAYER.ALICE][0], (draft) => {
					draft.inferred = inferred.intersect(expandShortCard('r5'));
					draft.possible = possible.intersect(expandShortCard('r5'));
					update1(draft);
				});

				const update2 = (draft) => {
					draft.clued = true;
					draft.clues.push({ giver: PLAYER.ALICE, type: CLUE.RANK, value: 5, turn: -1 });
					draft.clues.push({ giver: PLAYER.ALICE, type: CLUE.COLOUR, value: COLOUR.BLUE, turn: -1 });
				};

				const d_slot4 = state.hands[PLAYER.DONALD][3];
				state.deck = state.deck.with(d_slot4, produce(state.deck[d_slot4], update2));

				({ inferred, possible } = common.thoughts[d_slot4]);
				common.updateThoughts(state.hands[PLAYER.DONALD][3], (draft) => {
					draft.inferred = inferred.intersect(expandShortCard('b5'));
					draft.possible = possible.intersect(expandShortCard('b5'));
					update2(draft);
				});

				game.state.cardsLeft = 1;
			}
		});

		const action = solve_game(game, PLAYER.ALICE, find_all_clues);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});
});

describe('simple endgames with 1 undrawn identity', () => {
	it('solves a cluable endgame with 1 undrawn identity', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'p4'],
			['p2', 'g3', 'b1', 'b3', 'p3'],
			['y1', 'b1', 'p5', 'r3', 'y3'],
		], {
			play_stacks: [5, 5, 5, 4, 2],
			clue_tokens: 5,
			init: (game) => {
				const { common, state } = game;
				const a_slot5 = common.thoughts[state.hands[PLAYER.ALICE][4]];
				common.updateThoughts(state.hands[PLAYER.ALICE][4], (draft) => {
					draft.inferred = a_slot5.inferred.intersect(expandShortCard('p4'));
					draft.possible = a_slot5.possible.intersect(expandShortCard('p4'));
					draft.clued = true;
				});

				const b_slot5 = common.thoughts[state.hands[PLAYER.BOB][4]];
				common.updateThoughts(state.hands[PLAYER.BOB][4], (draft) => {
					draft.inferred = b_slot5.inferred.intersect(expandShortCard('p3'));
					draft.possible = b_slot5.possible.intersect(expandShortCard('p3'));
					draft.clued = true;
				});

				const c_slot3 = common.thoughts[state.hands[PLAYER.CATHY][2]];
				common.updateThoughts(state.hands[PLAYER.CATHY][2], (draft) => {
					draft.inferred = c_slot3.inferred.intersect(expandShortCard('p5'));
					draft.possible = c_slot3.possible.intersect(expandShortCard('p5'));
					draft.clued = true;
				});

				game.state.cardsLeft = 2;
			}
		});

		const action = solve_game(game, PLAYER.ALICE, find_all_clues);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});
});
