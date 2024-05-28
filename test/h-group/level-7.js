import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION } from '../../src/constants.js';
import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('scream discard chop moves', () => {
	it(`performs a scream discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'r5'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 7,
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = take_action(game);

		// Alice should discard slot 4 as a SDCM.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3].order });

		takeTurn(game, 'Alice discards y3 (slot 4)');

		// Bob's slot 5 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4].order].chop_moved, true);
	});

	it(`stalls after a scream discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r2', 'g4', 'b4', 'b3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 7,
			clue_tokens: 0
		});

		takeTurn(game, 'Alice discards r1 (slot 5)');	// End early game
		takeTurn(game, 'Bob clues green to Cathy');
		takeTurn(game, 'Cathy discards p3', 'p4');

		const action = take_action(game);

		// Alice should 5 Stall on Bob.
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 5 });
	});
});

describe('shout discard chop moves', () => {
	it(`performs a shout discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'p1', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 7,
			clue_tokens: 2,
			play_stacks: [1, 1, 1, 1, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Alice (slots 4,5)');

		const action = take_action(game);

		// Alice should discard slot 4 as a Shout Discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3].order });

		takeTurn(game, 'Alice discards p1 (slot 4)');

		// Bob's slot 5 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4].order].chop_moved, true);
	});

	it(`stalls after a shout discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'g4', 'b4', 'b3'],
			['g1', 'p1', 'r4', 'y3', 'p3']
		], {
			level: 7,
			clue_tokens: 2,
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Alice discards r1 (slot 5)');	// End early game
		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy discards p1', 'p4');

		const action = take_action(game);

		// Alice should 5 Stall on Bob.
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 5 });
	});
});

describe('generation discards', () => {
	it(`performs a gen discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'p2'],
			['g1', 'b3', 'r2', 'y3', 'r5']
		], {
			level: 7,
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = take_action(game);

		// Alice should discard slot 4 to generate for Cathy.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3].order });
	});

	it(`doesn't mistake a gen discard for a sdcm`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'p2'],
			['g1', 'b3', 'r2', 'y3', 'r5']
		], {
			level: 7,
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = take_action(game);

		// Alice should discard slot 4 to generate for Cathy.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3].order });
	});
});
