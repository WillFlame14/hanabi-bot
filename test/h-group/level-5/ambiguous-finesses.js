import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import logger from '../../../src/tools/logger.js';
import { get_result } from '../../../src/conventions/h-group/clue-finder/determine-clue.js';
import { CLUE } from '../../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous finesse', () => {
	it('understands an ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'b4', 'y5', 'y2', 'p4'],
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues green to Bob');

		// Donald's g1 should be finessed
		assert.equal(state.common.thoughts[state.hands[PLAYER.DONALD][0].order].finessed, true);

		takeTurn(state, 'Donald discards p4', 'r1');

		// Alice's slot 2 should be [g1].
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][0].order], ['g1']);
	});

	it('understands an ambiguous finesse with a self component', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slot 3)');
		takeTurn(state, 'Cathy discards p3', 'r1');

		// Alice's slot 1 should be finessed.
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, true);
	});

	it('passes back a layered ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b1', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 3 to Alice (slot 3)');
		takeTurn(state, 'Cathy discards p3', 'b3');

		// Alice should pass back, making her slot 1 not finessed and Cathy's slot 2 (used to be slot 1) finessed.
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
		assert.equal(state.common.thoughts[state.hands[PLAYER.CATHY][1].order].finessed, true);
	});

	it('understands an ambigous finesse pass-back', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b5', 'r3', 'y5', 'p4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues 3 to Bob');		// Ambiguous finesse on us and Bob
		takeTurn(state, 'Alice discards p3 (slot 5)');
		takeTurn(state, 'Bob discards p4', 'b2');		// Bob passes back

		takeTurn(state, 'Cathy clues 5 to Bob');		// 5 Save

		// Alice's slot 1 has now moved to slot 2.
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][1].order].finessed, true);
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][1].order], ['r1']);
	});

	it('prefers hidden prompt over ambiguous', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'b2', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g2', 'y2', 'g5', 'b2']
		], {
			level: 5,
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Donald');
		takeTurn(state, 'Cathy clues 4 to Bob');	// connecting on g2 (Donald, prompt) and g3 (Bob, finesse)

		// Bob's slot 1 can be either g3 or y3, since he doesn't know which 1 is connecting.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][0].order], ['y3', 'g3']);
	});

	it('correctly counts playables for ambiguous finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'g3', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['b2', 'b4', 'y5', 'y2', 'g2'],
		], { level: 5 });

		const clue = { type: CLUE.COLOUR, target: PLAYER.DONALD, value: COLOUR.GREEN };
		const list = state.hands[PLAYER.DONALD].clueTouched(clue, state.variant).map(c => c.order);
		const hypo_state = state.simulate_clue({ type: 'clue', giver: PLAYER.ALICE, target: PLAYER.DONALD, list, clue });
		const { playables } = get_result(state, hypo_state, clue, PLAYER.ALICE);

		// There should be 2 playables: g1 (Bob) and g2 (Donald).
		assert.equal(playables.length, 2);
	});
});
