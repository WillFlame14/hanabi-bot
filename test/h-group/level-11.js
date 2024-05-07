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

		takeTurn(game, 'Cathy discards y4', 'y1');

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
			play_stacks: [2, 2, 2, 2, 2]
		});
		takeTurn(game, 'Alice clues red to Cathy');

		// Bob's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order].finessed, false);
		// Cathy's slot 2 will be known to be r3 by Cathy after Bob doesn't play.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3']);

		takeTurn(game, 'Bob discards p2', 'y5');

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
			play_stacks: [2, 2, 2, 2, 2]
		});
		takeTurn(game, 'Alice clues red to Cathy');

		// Bob's slot 1 could be any of the playable 3's.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		// Cathy's slot 2 could be r3 or r4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3', 'r4']);

		takeTurn(game, 'Bob plays b3', 'y5');

		// After Bob plays into the bluff, Cathy knows it is an r4 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r4']);
	});

	it('understands a bluff even if bluffed card could duplicate cards in hand', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'r2', 'b4', 'b2'],
			['y1', 'r4', 'p4', 'r4'],
			['b2', 'g1', 'p3', 'r3'],
		], {
			level: 11,
			play_stacks: [1, 0, 0, 0, 0]
		});
		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob clues red to Donald');

		// Cathy's slot 1 could be any playable.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['r2', 'y1', 'g1', 'b1', 'p1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);

		// Donald's slot 4 must be r2,g3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][3].order], ['r2', 'r3']);

		takeTurn(game, 'Cathy plays y1', 'p5');

		// After Cathy plays into the bluff, Donald knows it is r3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][3].order], ['r3']);

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
		takeTurn(game, 'Cathy clues blue to Bob');

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
		takeTurn(game, 'Donald clues blue to Bob');

		// Alice's slot 1 should is not assumed
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
		// Bob's card could be b3 or b4 depending on whether Cathy plays.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['b3', 'b4']);
		// Cathy's slot 1 must be b3.
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
		takeTurn(game, 'Bob clues yellow to Cathy');
		takeTurn(game, 'Cathy clues blue to Bob');

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
		takeTurn(game, 'Cathy clues 1 to Donald');
		takeTurn(game, 'Donald plays r1', 'p1');

		const { play_clues } = find_clues(game);
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
		takeTurn(game, 'Cathy clues red to Donald');
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
			level: 11
		});

		const { play_clues } = find_clues(game);
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
			level: 11
		});

		const { play_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2;
		});
		assert.equal(bluff_clues.length, 0);
	});

	it(`doesn't bluff on top of unknown queued cards`, () => {
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
		takeTurn(game, 'Donald clues red to Cathy');
		// With g1, r2 already queued, we cannot bluff the y1.
		const { play_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2 ||
				clue.type == CLUE.COLOUR && clue.target == 2 && (clue.value == 3 || clue.value == 4);
		});
		assert.equal(bluff_clues.length, 0);
	});

	it(`understands a bluff on top of known queued plays`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'y1', 'y1', 'r4'],
			['g5', 'b2', 'r3', 'y5', 'y4'],
			['g1', 'g2', 'g3', 'g5', 'p4'],
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues red to Bob');
		// Since Bob has known plays a bluff should be possible on blue.
		takeTurn(game, 'Alice clues blue to Cathy');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2].order].finessed, true);
	});

	it(`doesn't bluff on top of known cards which might match bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g1', 'y1', 'y1', 'y5'],
			['p4', 'b2', 'r3', 'y5', 'y4'],
			['g1', 'g2', 'g3', 'g5', 'p4'],
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues red to Bob');
		// r2 is known to be queued, and would be played over finesse slot.
		const { play_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2;
		});
		assert.equal(bluff_clues.length, 0);
	});

	it(`understands a complex play if the bluff isn't played into`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g3', 'r3', 'g5'],
			['p1', 'r4', 'b5', 'b2'],
			['r2', 'b3', 'g1', 'y3']
		], {
			level: 11,
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues 2 to Cathy');    // 2 save
		takeTurn(game, 'Alice clues 5 to Bob');       // 5 save
		takeTurn(game, 'Bob clues blue to Donald');   // finesse for b1 on us

		// We expect that Cathy is bluffed
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);

		takeTurn(game, 'Cathy discards b2', 'y5');    // 5 save
	
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['b1']);
	});

});
