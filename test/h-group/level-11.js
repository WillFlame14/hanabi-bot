import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import logger from '../../src/tools/logger.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('bluff clues', () => {
	it('understands a bluff', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b3', 'r1', 'b1', 'g5', 'p2'],
			['p1', 'r4', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.ALICE
		});
		takeTurn(game, 'Alice clues red to Cathy (slot 2)');

		// Bob's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		// Cathy's slot 2 could be r3 or r4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3', 'r4']);

		takeTurn(game, 'Bob plays b3 (slot 1)', 'y5');

		// After Bob plays into the bluff, Cathy knows it is an r4 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r4']);
	});

	it('understands receiving a bluff', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5', 'p2'],
			['p1', 'r4', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues blue to Bob (slot 1)');

		// Alice's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		// Bob's slot 1 must be b4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['b4']);

		takeTurn(game, 'Alice plays b3 (slot 1)', 'y5');

		// After Alice plays into the bluff, Bob knows it is a b4 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['b4']);
	});

	it('never assumes a bluff when reverse finesse exists', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5', 'p2'],
			['b3', 'w1', 'w1', 'w5', 'w2'],
			['p1', 'r4', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues blue to Bob (slot 1)');

		// Alice's slot 1 should is not assumed
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
		// Bob's slot 1 could be b3,b4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['b3', 'b4']);
		// Cathy's slot 1 must be b4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['b3']);
	});

	it('prioritizes playing into a bluff', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p3', 'r4', 'p1', 'b2', 'y4'],
			['y2', 'y3', 'y5', 'p1', 'g4']
		], {
			level: 11,
			play_stacks: [0, 1, 0, 0, 1],
			starting: PLAYER.BOB
		});
		takeTurn(game, 'Bob clues yellow to Cathy (slot 1, 2, 3)');
		takeTurn(game, 'Cathy clues blue to Bob (slot 4)');

		// Alice's slot 1 could be any of the immediately playable cards.
		// Notably, it can't be yellow as that's not immediately playable.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r1', 'g1', 'b1', 'p2']);

		// Bob's slot 4 must be b2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3].order], ['b2']);

		const action = take_action(game);

		// Alice should play to prevent a misplay of the b2.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0].order });
	});

	it('doesn\'t bluff a card that isn\'t immediately playable', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y1', 'b5', 'r1', 'r1'],
			['y4', 'p1', 'g3', 'g4'],
			['y3', 'g1', 'g3', 'r1']
		], {
			level: 11,
			play_stacks: [1, 0, 0, 1, 2],
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues 1 to Donald (slot 2, 4)');
		takeTurn(game, 'Donald plays r1 (slot 4)', 'p1');

		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const bluff_clues = play_clues[3].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 3 && clue.value == 3 ||
				clue.type == CLUE.COLOUR && clue.target == 3 && clue.value == 2;
		});
		assert.equal(bluff_clues.length, 0);
	});

});
