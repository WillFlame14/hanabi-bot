import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import { HGroup_Hand as Hand } from '../../src/conventions/h-hand.js';
import logger from '../../src/tools/logger.js';

import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { determine_playable_card } from '../../src/conventions/h-group/action-helper.js';
import { find_urgent_actions } from '../../src/conventions/h-group/urgent-actions.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(state);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 1 });
	});

	it('will give a rank tcm touching multiple trash cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'b4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(state);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 1 });
	});

	it('will not give a tcm if chop is trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop is a duplicated card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'g4', 'g4']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop can be saved directly (critical)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'g5']
		], {
			level: 4,
			play_stacks: [2, 2, 2, 2, 2]
		});

		const { save_clues } = find_clues(state);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 5 });
	});

	it('will not give a tcm if chop can be saved directly (2 save)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], {
			level: 4,
			play_stacks: [5, 0, 0, 2, 2]
		});

		const { save_clues } = find_clues(state);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 2 });
	});

	it('will not give a tcm if a play can be given instead', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], {
			level: 4,
			play_stacks: [5, 1, 0, 2, 2]
		});

		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);
		const playable_priorities = determine_playable_card(state, Hand.find_playables(state, PLAYER.ALICE));
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		assert.deepEqual(urgent_actions[1], []);
		ExAsserts.objHasProperties(urgent_actions[2][0], { type: ACTION.COLOUR, value: 1 });
	});
});

describe('giving order chop move', () => {
	it('will find an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');

		const our_hand = state.hands[state.ourPlayerIndex];

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		ExAsserts.objHasProperties(urgent_actions[1][0], { type: ACTION.PLAY, target: our_hand[2].order });
	});

	it('will find an ocm to cathy', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r3', 'y3', 'y4', 'y4'],
			['r4', 'r4', 'g4', 'r3', 'r5'],
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 2,3,4)');

		const our_hand = state.hands[PLAYER.ALICE];

		const playable_priorities = determine_playable_card(state, [our_hand[1], our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

		ExAsserts.objHasProperties(urgent_actions[5][0], { type: ACTION.PLAY, target: our_hand[1].order });
	});

	it('will not give an ocm putting a critical on chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');

		const { save_clues } = find_clues(state);
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 5 });
	});

	it('will not ocm trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'g4', 'r1']
		], {
			level: 4,
			play_stacks: [2, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');

		// Alice should not OCM the trash r1.
		const action = take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 1 });
	});

	it('will ocm one card of an unsaved duplicate', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g5', 'g4', 'g4']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 3,4)');

		// Alice should OCM 1 copy of g4.
		const action = take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 2 });
	});

	it('will not ocm one card of a saved duplicate', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g3', 'g3', 'r2'],
			['g4', 'r3', 'y3', 'y3', 'r2']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Cathy');		// 2 Save, r2
		takeTurn(state, 'Cathy clues 1 to Alice (slots 3,4)');

		// Alice should not OCM the copy of r2.
		const action = take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 1 });
	});
});

describe('interpreting order chop move', () => {
	it('will interpret an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], { level: 4 });

		takeTurn(state, 'Alice clues 1 to Bob');
		takeTurn(state, 'Bob plays g1', 'r1');		// OCM on Cathy

		// Cathy's slot 5 should be chop moved.
		assert.equal(state.hands[PLAYER.CATHY][4].chop_moved, true);
	});

	it('will interpret an ocm skipping a player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], {
			level: 4,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues 5 to Alice (slot 5)');
		takeTurn(state, 'Alice clues 1 to Bob');
		takeTurn(state, 'Bob plays b1', 'r1');		// OCM on Alice

		// Alice's slot 4 should be chop moved.
		assert.equal(state.hands[PLAYER.ALICE][3].chop_moved, true);
	});
});

describe('interpreting chop moves', () => {
	it('will interpret new focus correctly', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b3', 'g3', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => state.hands[PLAYER.ALICE][index].chop_moved = true);

		takeTurn(state, 'Bob clues purple to Alice (slots 2,5)');

		// Alice's slot 2 should be p1.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][1], ['p1']);
	});

	it('will interpret only touching cm cards correctly', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b3', 'g3', 'r3', 'r5']
		], {
			level: 4,
			starting: PLAYER.BOB
		});

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => state.hands[PLAYER.ALICE][index].chop_moved = true);

		takeTurn(state, 'Bob clues purple to Alice (slots 4,5)');

		// Alice's slot 4 should be p1.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['p1']);
	});
});
