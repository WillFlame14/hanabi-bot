import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import logger from '../../src/tools/logger.js';
import * as ExAsserts from '../extra-asserts.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { ACTION } from '../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('double discard avoidance', () => {
	it(`understands a clue from a player on double discard avoidance may be a stall`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y2', 'y5', 'b2', 'g4'],
			['b1', 'b5', 'b4', 'b2'],
			['y4', 'y2', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.DONALD
		});
		const { state } = game;
		takeTurn(game, 'Donald discards r3', 'p3'); // Ends early game

		// A discard of a useful card means Alice is in a DDA situation.
		ExAsserts.objHasProperties(game.state.dda, {suitIndex: COLOUR.RED, rank: 3});
		takeTurn(game, 'Alice clues 5 to Bob');

		// No one should be finessed by this as Alice was simply stalling.
		const finessed = state.hands.map((hand, idx) => idx).filter(idx => state.hands[idx].some(c => game.common.thoughts[c.order].finessed));
		assert.equal(finessed.length, 0);
		assert.equal(game.common.waiting_connections.length, 0);
	});

	it(`will discard while on double discard avoidance if it can see the card`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'y5', 'b2', 'g4'],
			['b3', 'b5', 'b4', 'b2'],
			['y4', 'b4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.DONALD,
			clue_tokens: 0
		});
		const { state } = game;
		takeTurn(game, 'Donald discards r3', 'p3'); // Ends early game

		// A discard of a useful card means common knowledge is Alice is in a DDA situation.
		ExAsserts.objHasProperties(state.dda, {suitIndex: COLOUR.RED, rank: 3});

		// However, since Alice can see the other r3, Alice can discard.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: state.hands[PLAYER.ALICE][3].order });
	});
});
