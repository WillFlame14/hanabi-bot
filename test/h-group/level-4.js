// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { PLAYER, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import * as Utils from '../../src/util.js';
import logger from '../../src/logger.js';

import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { determine_playable_card, find_urgent_actions } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === ACTION.RANK && bob_save.value === 1);
	});

	it('will give a rank tcm touching multiple trash cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === ACTION.RANK && bob_save.value === 1);
	});

	it ('will not give a tcm if chop is trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert(save_clues[PLAYER.BOB] === undefined);
	});
});

describe('order chop move', () => {
	it('will find an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'r5']
		], 4);

		// Bob clues Alice 1, touching slots 3 and 4.
		const action = { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [1, 2], target: PLAYER.ALICE, turn: 0 };
		state.handle_action(action);

		const our_hand = state.hands[state.ourPlayerIndex];

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[1][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[1][0].target, our_hand[2].order);
	});

	it('will find an ocm to cathy', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r3', 'y3', 'y4', 'y4'],
			['r4', 'r4', 'g4', 'r3', 'r5'],
		], 4);

		// Bob clues Alice 1, touching slots 2, 3 and 4.
		const action = { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [1, 2, 3], target: PLAYER.ALICE, turn: 0 };
		state.handle_action(action);

		const our_hand = state.hands[PLAYER.ALICE];

		const playable_priorities = determine_playable_card(state, [our_hand[1], our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[5][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[5][0].target, our_hand[1].order);
	});

	it('will not give an ocm putting a critical on chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r5']
		], 4);

		// Bob clues Alice 1, touching slots 3 and 4.
		const action = { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [1, 2], target: PLAYER.ALICE, turn: 0 };
		state.handle_action(action);

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: ACTION.RANK, value: 5 });
	});
});
