import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, assertCardHasInferences, setup } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous finesse', () => {
	it('understands an ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'b4', 'y5', 'y2', 'p4'],
		], { level: 5 });

		// Cathy clues Bob green.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.DONALD });

		// Donald's g1 should be finessed
		assert.deepEqual(state.hands[PLAYER.DONALD][0].finessed, true);

		// Donald discards.
		state.handle_action({ type: 'discard', order: 15, playerIndex: PLAYER.DONALD, suitIndex: COLOUR.PURPLE, rank: 4, failed: false });
		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 2 should be [g1].
		assertCardHasInferences(state.hands[PLAYER.ALICE][0], ['g1']);
	});

	it('understands an ambiguous finesse with a self component', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3']
		], { level: 5 });

		// Bob clues Alice 2, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy discards.
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 1 should be finessed.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, true);
	});

	it('passes back a layered ambiguous finesse', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b1', 'r2', 'y3', 'p3']
		], { level: 5 });

		// Bob clues Alice 3, touching slot 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [2], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy discards.
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.update_turn(state, { type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice should pass back the ambiguous finesse, making her slot 1 not finessed and Cathy's slot 1 finessed.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
		assert.equal(state.hands[PLAYER.CATHY][0].finessed, true);
	});

	it('understands an ambigous finesse pass-back', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'b5', 'r3', 'y5', 'p4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], { level: 5 });

		// Cathy clues Bob 3, touching r3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice discards and draws y1.
		state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.YELLOW, rank: 1, playerIndex: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob discards and draws b2, passing back the ambiguous finesse.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
		state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.BLUE, rank: 2, playerIndex: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 5 to Bob as a 5 Save.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [6,8], target: PLAYER.BOB });
		state.update_turn(state, { type: 'turn', num: 4, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 1 has now moved to slot 2.
		assert.equal(state.hands[PLAYER.ALICE][1].finessed, true);
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['r1']);
	});

	it('prefers hidden prompt over ambiguous', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'b4', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g2', 'y2', 'g5', 'b2']
		], {
			level: 5,
			play_stacks: [0, 1, 1, 0, 0]
		});

		// Bob clues 2 to Donald.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [12,14,15], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 4 to Bob, connecting on g2 (Donald, prompt) and g3 (Bob, finesse).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.CATHY, list: [5], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.DONALD });

		// Bob's slot 1 can be either g3 or y3, since he doesn't know which 1 is connecting.
		assertCardHasInferences(state.hands[PLAYER.BOB][0], ['y3', 'g3']);
	});
});
