import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CLUE } from '../../../src/constants.js';
import { COLOUR, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('other cases', () => {
	it('prefers to interpret finesses on others before unknown playables on self', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'b3', 'p1', 'g4'],
			['r5', 'p4', 'r4', 'b2'],
			['r1', 'g5', 'p2', 'p4']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		// Bob clues 1 to us, touching slot 4.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [0], target: PLAYER.ALICE });

		// Cathy clues red to Bob, touching r2.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });

		// Alice's slot 4 should still be any 1.
		ExAsserts.cardHasInferences(state.hands[PLAYER.ALICE][3], ['r1', 'y1', 'g1', 'b1', 'p1']);

		// Donald's r1 should be finessed.
		assert.equal(state.hands[PLAYER.DONALD][0].finessed, true);
	});

	it(`doesn't perform unknown self-prompts on target`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y2', 'b2', 'b1', 'g3'],
			['p1', 'p4', 'r3', 'y3'],
			['y5', 'r4', 'r4', 'r2']
		], {
			level: 1,
			play_stacks: [1, 0, 0, 0, 0],
			discarded: ['y3'],
			starting: PLAYER.BOB
		});

		// Bob clues 3 to Cathy, saving y3 and touching r3.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [8,9], target: PLAYER.CATHY });

		// Cathy clues clues red to Donald.
		takeTurn(state, { type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [12,13,14], target: PLAYER.DONALD });

		// Donald plays r2 and draws r5.
		takeTurn(state, { type: 'play', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 2, order: 12 }, 'r5');

		const { play_clues } = find_clues(state);

		// Red to Donald is not a valid play clue.
		assert.equal(play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED), false);
	});
});
