// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { logClue } from '../../src/tools/log.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('self-finesse', () => {
	it('does not give bad self-finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'r4', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], 2);

		state.play_stacks = [1, 3, 0, 1, 2];
		state.hypo_stacks = [1, 3, 0, 1, 2];

		// Bob clues Cathy green, touching slot 1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });

		const { play_clues } = find_clues(state);

		logger.info(play_clues[PLAYER.BOB].map(clue => logClue(clue)));

		// 3 to Bob is not a valid clue.
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});
});

describe('asymmetric clues', () => {
	it('understands delayed play clues through asymetrically known cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'r4', 'r5'],
			['g4', 'y3', 'r4', 'p2'],
			['g3', 'g2', 'p3', 'b3']
		], 2);

		// b1 has been played. We hold a b2 in our hand.
		state.play_stacks = [0, 0, 0, 1, 0];
		state.hypo_stacks = [0, 0, 0, 1, 0];

		// Cathy clues blue to Donald, finessing b2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.BLUE }, giver: PLAYER.CATHY, list: [12], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.DONALD });

		// Donald clues 4 to Bob, getting b4. Donald knows that he has b3 and not b2 since he can see Bob's b2 and ours.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.DONALD, list: [5,6], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// We think we have b3 in slot 1, as a Certain Finesse. 
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][0]), ['b3'].map(expandShortCard));

		// We clue 5 to Bob to save r5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.ALICE, list: [4], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob plays b2 to satisfy the finesse and draws y5.
		state.handle_action({ type: 'play', playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 2, order: 7 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 5, order: 16 });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 5 to Bob.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [4,16], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.DONALD });

		// Donald plays b3 and draws r2.
		state.handle_action({ type: 'play', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.BLUE, rank: 3, order: 12 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 2, order: 17 });
		state.handle_action({ type: 'turn', num: 6, currentPlayerIndex: PLAYER.ALICE });

		// We should no longer think that we have b3 in slot 1.
		assert.equal(state.hands[PLAYER.ALICE][0].inferred.length > 1, true);
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
	});
});
