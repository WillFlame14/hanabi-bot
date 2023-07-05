// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { CLUE } from '../../../src/constants.js';
import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../../test-utils.js';
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
		], 1);

		// Bob clues 1 to us, touching slot 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [0], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues red to Bob, touching r2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [7], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.DONALD });

		// Alice's slot 4 should still be any 1.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		// Donald's r1 should be finessed.
		assert.equal(state.hands[PLAYER.DONALD][0].finessed, true);
	});

	it(`doesn't perform unknown self-prompts on target`, () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y2', 'b2', 'b1', 'g3'],
			['p1', 'p4', 'r3', 'y3'],
			['y5', 'r4', 'r4', 'r2']
		], 1);

		state.play_stacks = [1, 0, 0, 0, 0];
		state.hypo_stacks = [1, 0, 0, 0, 0];

		// y3 is discarded.
		state.discard_stacks[COLOUR.YELLOW] = [0, 0, 1, 0, 0];

		// Bob clues 3 to Cathy, saving y3 and touching r3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [8,9], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues clues red to Donald.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [12,13,14], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.DONALD });

		// Donald plays r2 and draws r5.
		state.handle_action({ type: 'play', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 2, order: 12 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 5, order: 16 });

		const { play_clues } = find_clues(state);

		// Red to Donald is not a valid play clue.
		assert.equal(play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED), false);
	});
});
