import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ACTION, CLUE } from '../../src/constants.js';
import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { get_result } from '../../src/conventions/h-group/clue-finder/determine-clue.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue', () => {
	it('prefers play over save with >1 clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
			['g3', 'p1', 'b3', 'b2', 'b5']
		], {
			level: 1,
			play_stacks: [1, 5, 1, 0, 5],
			clue_tokens: 2
		});

		// Bob's last 3 cards are clued.
		[2,3,4].forEach(index => state.hands[PLAYER.BOB][index].clued = true);

		// Cathy's last 2 cards are clued.
		[3,4].forEach(index => state.hands[PLAYER.CATHY][index].clued = true);

		const action = take_action(state);

		// Alice should give green to Cathy to finesse over save
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN });
	});

	it('prefers touching less cards to save critical cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'g5', 'p2', 'p4', 'g4']
		], {
			level: 1,
			discarded: ['g4']
		});

		// Bob's p2 is clued.
		state.hands[PLAYER.BOB][2].clued = true;

		const action = take_action(state);

		// Alice should give green to Bob instead of 4
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN });
	});

	it('generates correct inferences for a 2 Save', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'b2', 'y4'],
			['g5', 'b2', 'g2', 'y2'],
			['y3', 'g2', 'y1', 'b3']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Cathy');

		// g2 is visible in Donald's hand. Other than that, the saved 2 can be any 2.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.CATHY][3].order], ['r2', 'y2', 'b2', 'p2']);
	});

	it('does not finesse from a 2 Save', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2'],
			['g5', 'b4', 'g1', 'y2', 'b3']
		], {
			level: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues 2 to Bob');

		// Our slot 1 should not only be y1.
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].inferred.length > 1, true);
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
	});

	it('prefers giving saves that fill in plays', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g2', 'p5', 'r2', 'y2'],
			['p3', 'g3', 'p2', 'p1', 'b4']
		], { level: 1 });

		takeTurn(state, 'Alice clues red to Bob');				// getting r1, touching r2
		takeTurn(state, 'Bob plays r1', 'b3');
		takeTurn(state, 'Cathy clues 5 to Alice (slot 5)');		// 5 Save

		const { save_clues } = find_clues(state);

		// We should save with 2 since it reveals r2 playable.
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 2 });
	});
});

describe('play clues', () => {
	it('correctly counts the number of playables when connecting on unknown plays', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g1', 'p5', 'r2', 'y2'],
			['g2', 'g3', 'p2', 'p1', 'b4']
		], {
			level: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues 1 to Bob');

		const clue = { type: CLUE.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN };
		const list = state.hands[PLAYER.CATHY].clueTouched(clue, state.variant).map(c => c.order);
		const hypo_state = state.simulate_clue({ type: 'clue', clue, list, giver: PLAYER.ALICE, target: PLAYER.CATHY });
		const { playables } = get_result(state, hypo_state, clue, PLAYER.ALICE);

		// g2 should be counted as newly playable.
		assert.equal(playables.length, 1);
	});
});

describe('early game', () => {
	it('will not 5 stall on a trash 5', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r5', 'r4', 'y4', 'b3'],
		], {
			level: 1,
			discarded: ['r4', 'r4'],
			clue_tokens: 7
		});

		const action = state.take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});
});

describe('sacrifice discards', () => {
	it('discards a non-critical card when locked with no clues', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r2', 'r4', 'p4', 'b3'],
			['r3', 'b4', 'r2', 'y4', 'y2'],
		], {
			level: 1,
			discarded: ['r4'],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 5 to Alice (slots 1,3,5)');
		takeTurn(state, 'Cathy clues 4 to Alice (slots 2,4)');

		// Alice should discard slot 2.
		assert.equal(state.common.lockedDiscard(state, state.hands[PLAYER.ALICE]).order, 3);
	});

	it('discards the farthest critical card when locked with crits', () => {
		const state = setup(HGroup, [
			['r4', 'b4', 'r5', 'b2', 'y5'],
		], {
			level: 1,
			play_stacks: [2, 1, 0, 0, 0],
			discarded: ['r4', 'b2', 'b4']
		});

		// Alice knows all of her cards (all crit).
		['r4', 'b4', 'r5', 'b2', 'y5'].forEach((short, index) => {
			state.common.thoughts[state.hands[PLAYER.ALICE][index].order].intersect('inferred', [expandShortCard(short)]);
		});

		// Alice should discard y5.
		assert.equal(state.common.lockedDiscard(state, state.hands[PLAYER.ALICE]).order, 0);
	});
});
