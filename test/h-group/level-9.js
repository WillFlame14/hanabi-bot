import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import logger from '../../src/tools/logger.js';

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
		assert.equal(game.state.dda, true);

		takeTurn(game, 'Alice clues 5 to Bob');

		// No one should be finessed by this as Alice was simply stalling.
		const finessed = state.hands.map((hand, idx) => idx).filter(idx => state.hands[idx].some(c => game.common.thoughts[c.order].finessed));
		assert.equal(finessed.length, 0);
		assert.equal(game.common.waiting_connections.length, 0);
	});

});
