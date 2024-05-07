import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, VARIANTS, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import logger from '../../src/tools/logger.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('bluff clues', () => {
	it('understands a direct play if the bluff isn\'t played into', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'y5', 'b1', 'g5', 'p2'],
			['b3', 'r1', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.BOB
		});
		takeTurn(game, 'Bob clues red to Alice (slot 2)');

		// Cathy's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		// Alice's slot 2 could be r3 or r4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3', 'r4']);

		takeTurn(game, 'Cathy discards y4 (slot 5)', 'y1');

		// After Cathy doesn't play into it, assume we have a play. 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3']);
	});

	it('understands giving a direct play through a bluff opportunity', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b3', 'r1', 'b1', 'g5', 'p2'],
			['p1', 'r3', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.ALICE
		});
		takeTurn(game, 'Alice clues red to Cathy (slot 2)');

		// Bob's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order].finessed, false);
		// Cathy's slot 2 will be known to be r3 or r4 until Bob reacts.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3']);

		takeTurn(game, 'Bob discards p2 (slot 5)', 'y5');

		// After Bob doesn't play into the bluff, Cathy knows it is an r3 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3']);
	});

	it('understands giving a bluff', () => {
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

	it('understands a given bluff', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'p2', 'k4', 'b2'],
			['y3', 'r4', 'p4', 'r4'],
			['k2', 'g1', 'p3', 'g3'],
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0, 0],
			starting: PLAYER.ALICE,
			variant: VARIANTS.BLACK6
		});
		takeTurn(game, 'Alice clues 2 to Bob (slot 2, 4)');
		takeTurn(game, 'Bob clues 1 to Alice (slot 1, 3, 4)');
		takeTurn(game, 'Cathy clues 1 to Donald (slot 2)');
		takeTurn(game, 'Donald clues black to Bob (slot 3)');
		takeTurn(game, 'Alice plays k1 (slot 4)', 'y1');
		takeTurn(game, 'Bob clues black to Donald (slot 1)');
		takeTurn(game, 'Cathy discards r4 (slot 4)', 'p1');
		takeTurn(game, 'Donald plays g1 (slot 2)', 'r1');
		takeTurn(game, 'Alice plays b1 (slot 4)', 'r3');
		takeTurn(game, 'Bob clues green to Donald (slot 4)');

		// Cathy's slot 1 could be any playable.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['r1', 'y1', 'g2', 'b2', 'p1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);

		// Donald's slot 4 must be g2,g3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][3].order], ['g2', 'g3']);

		takeTurn(game, 'Cathy plays p1 (slot 1)', 'p5');

		// After Cathy plays into the bluff, Donald knows it is a g3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][3].order], ['g3']);

		// And no-one is finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order].finessed, false);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, false);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][0].order].finessed, false);
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
		// Bob will know this isb4.
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

	it('assumes a finesse over self bluff when connecting cards exist', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g4', 'g2', 'p1', 'b2'],
			['b4', 'g4', 'y4', 'r4'],
			['y3', 'r1', 'g3', 'p3']
		], {
			level: 11,
			play_stacks: [0, 1, 0, 0, 1],
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues red to Donald (slot 2)');
		takeTurn(game, 'Donald clues 3 to Alice (slot 1)');

		// The bluff is not allowed as it can't be resolved immediately.
		// Alice must have r3, r2
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r3']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r2']);
	});

	it('doesn\'t bluff through self finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'b5', 'y1', 'r4', 'y4'],
			['p2', 'p3', 'g3', 'g4', 'y5'],
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.ALICE
		});

		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 3;
		});
		assert.equal(bluff_clues.length, 0);
	});

	it('doesn\'t bluff when bluff can\'t be known by next player to play', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'b5', 'y1', 'r4', 'y4'],
			['p2', 'r2', 'b2', 'g4', 'y5'],
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.ALICE
		});

		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2;
		});
		assert.equal(bluff_clues.length, 0);
	});

	it('doesn\'t bluff on top of queued cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'r2', 'y1', 'y1', 'r4'],
			['p2', 'b2', 'r3', 'y5', 'y4'],
			['g1', 'g2', 'g3', 'g5', 'p4'],
		], {
			level: 11,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues red to Cathy (slot 3)');
		// With g1, r2 already queued, we cannot bluff the y1.
		const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2 ||
				clue.type == CLUE.COLOUR && clue.target == 2 && (clue.value == 3 || clue.value == 4);
		});
		assert.equal(bluff_clues.length, 0);
	});
});
