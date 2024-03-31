import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import { ACTION_PRIORITY as PRIORITY } from '../../src/conventions/h-group/h-constants.js';
import logger from '../../src/tools/logger.js';

import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { determine_playable_card } from '../../src/conventions/h-group/action-helper.js';
import { find_urgent_actions } from '../../src/conventions/h-group/urgent-actions.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(game);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 1 });
	});

	it('will give a rank tcm touching multiple trash cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'b4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(game);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 1 });
	});

	it('will not give a tcm if chop is trash', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(game);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop is a duplicated card', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'g4', 'g4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(game);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop can be saved directly (critical)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'g5']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(game);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 5 });
	});

	it('will not give a tcm if chop can be saved directly (2 save)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], {
			level: 4,
			play_stacks: [5, 0, 0, 2, 2]
		});

		const { save_clues } = find_clues(game);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 2 });
	});

	it('will not give a tcm if a play can be given instead', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], {
			level: 4,
			play_stacks: [5, 1, 0, 2, 2]
		});

		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const playable_priorities = determine_playable_card(game, game.me.thinksPlayables(game.state, PLAYER.ALICE));
		const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		assert.deepEqual(urgent_actions[PRIORITY.ONLY_SAVE], []);
		ExAsserts.objHasProperties(urgent_actions[PRIORITY.PLAY_OVER_SAVE][0], { type: ACTION.COLOUR, value: 1 });
	});
});

describe('giving order chop move', () => {
	it('will find an ocm to the next player', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 3,4)');

		const { state } = game;
		const our_hand = state.hands[state.ourPlayerIndex];

		const playable_priorities = determine_playable_card(game, game.me.thinksPlayables(state, PLAYER.ALICE));
		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		ExAsserts.objHasProperties(urgent_actions[PRIORITY.ONLY_SAVE][0], { type: ACTION.PLAY, target: our_hand[2].order });
	});

	it('will find an ocm to cathy', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r3', 'y3', 'y4', 'y4'],
			['r4', 'r4', 'g4', 'r3', 'r5'],
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3,4)');

		const { state } = game;
		const our_hand = state.hands[PLAYER.ALICE];

		const playable_priorities = determine_playable_card(game, [our_hand[1], our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		ExAsserts.objHasProperties(urgent_actions[PRIORITY.ONLY_SAVE + Object.keys(PRIORITY).length][0], { type: ACTION.PLAY, target: our_hand[1].order });
	});

	it('will not give an ocm putting a critical on chop', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 3,4)');

		const { save_clues } = find_clues(game);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 5 });
	});

	it('will not ocm trash', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'g4', 'r1']
		], {
			level: 4,
			play_stacks: [2, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 3,4)');

		// Alice should not OCM the trash r1.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 1 });
	});

	it('will ocm one card of an unsaved duplicate', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g5', 'g4', 'g4']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 3,4)');

		// Alice should OCM 1 copy of g4.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 2 });
	});

	it('will not ocm one card of a saved duplicate', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g3', 'g3', 'r2'],
			['g4', 'r3', 'y3', 'y3', 'r2']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');		// 2 Save, r2
		takeTurn(game, 'Cathy clues 1 to Alice (slots 3,4)');

		// Alice should not OCM the copy of r2.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 1 });
	});
});

describe('interpreting order chop move', () => {
	it('will interpret an ocm to the next player', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], { level: 4 });

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays g1', 'r1');		// OCM on Cathy

		// Cathy's slot 5 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][4].order].chop_moved, true);
	});

	it('will interpret an ocm skipping a player', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], {
			level: 4,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');
		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays b1', 'r1');		// OCM on Alice

		// Alice's slot 4 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order].chop_moved, true);
	});
});

describe('interpreting chop moves', () => {
	it('will interpret new focus correctly', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b3', 'g3', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => game.common.thoughts[game.state.hands[PLAYER.ALICE][index].order].chop_moved = true);

		takeTurn(game, 'Bob clues purple to Alice (slots 2,5)');

		// Alice's slot 2 should be p1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['p1']);
	});

	it('will interpret only touching cm cards correctly', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b3', 'g3', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => game.common.thoughts[game.state.hands[PLAYER.ALICE][index].order].chop_moved = true);

		takeTurn(game, 'Bob clues purple to Alice (slots 4,5)');

		// Alice's slot 4 should be p1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['p1']);
	});

	it('prioritizes new cards over gt-eliminated chop moved cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r5', 'r2'],
			['y2', 'b2', 'p3', 'y1', 'r4']
		], {
			level: 4,
			play_stacks: [1, 5, 5, 5, 5],
			discarded: ['r3', 'r4'],
			clue_tokens: 4
		});

		takeTurn(game, 'Alice clues 5 to Bob');				// known r5
		takeTurn(game, 'Bob clues 4 to Cathy');				// r4 save
		takeTurn(game, 'Cathy clues 1 to Alice (slot 4)');	// Trash Chop Move, saving r3 in slot 5
		takeTurn(game, 'Alice discards b1 (slot 4)');		// Alice draws r2 in slot 1 
		takeTurn(game, 'Bob clues red to Cathy');			// Reverse finesse on r4

		// Slot 1 should be red 2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r2']);

		takeTurn(game, 'Cathy discards y1', 'r1');

		// Alice should play r2.
		const action1 = take_action(game);
		assert.ok(action1.type === ACTION.PLAY && action1.target === game.state.hands[PLAYER.ALICE][0].order);

		takeTurn(game, 'Alice plays r2 (slot 1)');
		takeTurn(game, 'Bob discards r2', 'p2');
		takeTurn(game, 'Cathy discards p3', 'y4');

		// Alice should play r3.
		const action2 = take_action(game);
		assert.ok(action2.type === ACTION.PLAY && action2.target === game.state.hands[PLAYER.ALICE][1].order);
	});
});
