import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import logger from '../../src/tools/logger.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('bluff clues', () => {

	it(`understands a direct play if the bluff isn't played into`, () => {
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
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		// Alice's slot 2 could be r3 or r4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3', 'r4']);

		takeTurn(game, 'Cathy discards y4', 'y1');

		// After Cathy doesn't play into it, assume we have a play. 
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3']);
	});

	it(`understands a finesse if the played card matches`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'y2', 'b3', 'y5'],
			['p1', 'r3', 'g1', 'y4'],
			['p2', 'b5', 'b1', 'y1']
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});
		takeTurn(game, 'Bob clues purple to Alice (slot 1)');
		takeTurn(game, 'Cathy plays p1', 'r2');
		takeTurn(game, 'Donald plays p2', 'b4');

		// Alice's slot 1 must be the p3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['p3']);
	});

	it(`understands a self finesse that's too long to be a bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g5', 'y2', 'b3', 'y5'],
			['p4', 'r3', 'g1', 'y4'],
			['p2', 'b5', 'b1', 'y1']
		], {
			level: 11,
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues 4 to Alice (slot 2)');

		// Cathy's slot 1 could be any of the next 1's.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r1', 'y1', 'g1', 'b1', 'p1']);
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
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r3', 'r4']);

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

	it('infers the identity of indirect bluffs', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5', 'g3'],
			['p1', 'r4', 'b5', 'b2', 'y3'],
		], {
			level: 11,
			starting: PLAYER.BOB
		});
		takeTurn(game, 'Bob clues red to Alice (slot 4)');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r1', 'r2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		takeTurn(game, 'Cathy plays p1', 'p2');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r2']);
		takeTurn(game, 'Alice discards g4 (slot 5)');
		takeTurn(game, 'Bob clues red to Alice (slots 1,5)');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r1', 'r3']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		takeTurn(game, 'Cathy plays p2', 'p3');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r3']);
	});

	it('infers the identity of bluffed prompts', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5'],
			['p1', 'r4', 'b5', 'b2'],
			['g4', 'r4', 'r5', 'g3']
		], {
			level: 11,
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues red to Alice (slots 3,4)');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r1']);
		takeTurn(game, 'Alice plays r1 (slot 4)');

		// The only way this clue makes sense is if we have r3 to connect to the r4, r5 in Donald's hand.
		takeTurn(game, 'Bob clues red to Donald');
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r3']);
	});

	it('infers the identity of bluff prompts through other people', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5'],
			['p1', 'r4', 'b5', 'b2'],
			['g4', 'b2', 'r3', 'r1']
		], {
			level: 11,
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues red to Donald');
		takeTurn(game, 'Donald plays r1', 'p5');
		takeTurn(game, 'Alice discards y4 (slot 4)');

		takeTurn(game, 'Bob clues red to Alice (slots 2,3)');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r2', 'r4']);

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].finessed, true);
		takeTurn(game, 'Cathy plays p1', 'p2');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r4']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][3].order], ['r3']);
	});

	it(`makes the correct inferrences on a received bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'], // y4 y2 y4 b5
			['p2', 'y2', 'g3', 'b1'],
			['r4', 'b1', 'g5', 'r2'],
			['p2', 'r4', 'r1', 'b3']
		], {
			level: 11,
			play_stacks: [1, 1, 0, 0, 1],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues 1 to Bob');
		takeTurn(game, 'Alice clues yellow to Bob');
		takeTurn(game, 'Bob clues red to Cathy');
		takeTurn(game, 'Cathy clues 2 to Alice (slot 2)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g2', 'b2', 'p2']);

		takeTurn(game, 'Donald plays p2', 'b2');

		// After the play, we should narrow it down to only the bluff possibility.
		// If it were the finesse through b1, Donald wouldn't have played.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g2']);
	});

	it('understands being clued a bluff with a rank disconnect', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'r1', 'y1', 'g5', 'p2'],
			['p1', 'r4', 'b5', 'b2', 'y4']
		], {
			level: 11,
			play_stacks: [1, 2, 1, 0, 0],
			starting: PLAYER.BOB
		});
		takeTurn(game, 'Bob clues 3 to Alice (slot 2)');

		// Alice's slot 2 could be any of the playable 3's
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3', 'y3', 'g3']);

		// Cathy plays to demonstrate the bluff.
		takeTurn(game, 'Cathy plays p1', 'y5');

		// After Cathy plays, Alice should know it was a bluff.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3', 'g3']);
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

	it(`doesn't bluff a card that isn't immediately playable`, () => {
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
				clue.type == CLUE.COLOUR && clue.target == 3 && clue.value == COLOUR.GREEN;
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
		// Alice must have a playable 3 with a connection to it in the second position.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r3', 'y3', 'g3', 'b3', 'p3']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r2', 'y2', 'g1', 'b1', 'p2']);
	});

	it(`doesn't bluff through self finesses`, () => {
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

	it(`doesn't bluff when bluff can't be known by next player to play`, () => {
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
				clue.type == CLUE.COLOUR && clue.target == 2 && (clue.value == COLOUR.BLUE || clue.value == COLOUR.PURPLE);
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

	it(`doesn't bluff on top of colour-clued cards which might match bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r4', 'y1', 'y1', 'y5'],
			['p4', 'b2', 'r3', 'y5', 'y4'],
		], { level: 11 });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'g1');
		takeTurn(game, 'Cathy clues 5 to Bob');

		// Alice cannot use r3 to bluff Bob's g1, as r4 would play instead.
		const { play_clues } = find_clues(game);
		assert.ok(!play_clues[PLAYER.CATHY].some(clue =>
			(clue.type === CLUE.RANK && clue.value === 3) ||
			(clue.type === CLUE.COLOUR && clue.value === COLOUR.RED)));
	});

	it(`doesn't bluff on top of rank-clued cards which might match bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y2', 'r2', 'y1', 'y1', 'y5'],
			['g4', 'b2', 'p3', 'y5', 'y4'],
		], {
			level: 11,
			play_stacks: [0, 1, 0, 0, 1]
		});

		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob plays y2', 'g1');
		takeTurn(game, 'Cathy clues 5 to Bob');

		// Alice cannot use p3 to bluff Bob's g1, as r2 would play instead.
		const { play_clues } = find_clues(game);
		assert.ok(!play_clues[PLAYER.CATHY].some(clue =>
			(clue.type === CLUE.RANK && clue.value === 3) ||
			(clue.type === CLUE.COLOUR && clue.value === COLOUR.PURPLE)));
	});

	it(`understands a complex play if the bluff isn't played into`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g3', 'r3', 'g5'],
			['p1', 'r4', 'b5', 'b2'],
			['r2', 'b2', 'g1', 'y3']
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

	it(`understands a double finesse if the target is too far away to be a bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g4', 'p3', 'r3', 'b4'],
			['y1', 'y2', 'p2', 'p4'],
			['b1', 'y5', 'g2', 'r4']
		], {
			level: 11,
			starting: PLAYER.DONALD,
			play_stacks: [3, 4, 1, 1, 3],
			discarded: ['r1', 'y3', 'g3']
		});
		takeTurn(game, 'Donald clues blue to Bob');

		// We expect Alice is finessed on both slots
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['b2']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['b3']);
	});

	it('understands a bluff on top of unknown plays that cannot match', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'p3', 'y1', 'y1'],
			['g5', 'b2', 'r3', 'y5'],
			['b4', 'p2', 'g3', 'r5'],
		], {
			level: 11,
			play_stacks: [0, 0, 1, 0, 2],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues 1 to Bob');
		// Since Bob is only queued on 1s, Alice should be able to bluff Bob's p3 using g3.
		takeTurn(game, 'Alice clues 3 to Donald');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1].order].finessed, true);
	});

	it(`doesn't bluff on top of unknown queued cards`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'g1', 'y1', 'y1', 'r4'],
			['p2', 'b2', 'r3', 'y5', 'y4'],
			['g1', 'g2', 'g3', 'g5', 'p4'],
		], {
			level: 11,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});
		takeTurn(game, 'Donald clues red to Cathy');
		// With r2 queued, we cannot bluff the g1.
		const { play_clues } = find_clues(game);
		const bluff_clues = play_clues[2].filter(clue => {
			return clue.type == CLUE.RANK && clue.target == 2 && clue.value == 2 ||
				clue.type == CLUE.COLOUR && clue.target == 2 && (clue.value == COLOUR.BLUE || clue.value == COLOUR.PURPLE);
		});
		assert.equal(bluff_clues.length, 0);
	});

	it(`computes connections correctly`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'], // Known g1*
			['y2', 'r1', 'r2', 'y4'], // After play b1, y2, r2*, y4
			['y3', 'p2', 'y1', 'r4'],
			['g5', 'y1', 'p4', 'b5']
		], { level: 11 });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'b1');
		takeTurn(game, 'Cathy clues yellow to Donald');
		takeTurn(game, 'Donald clues green to Alice (slots 3,4)');

		takeTurn(game, 'Alice clues 3 to Cathy');

		// Simplest interpretations: r2 (Bob) prompt, b1 (Bob) -> y2 (Bob) layered finesse
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order], ['r3', 'y3', 'b3']);
	});

	it(`doesn't confuse a bluff as a layered finesse`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'b1', 'y4', 'y3'], // After play b1, y2, r1, r2
			['g4', 'r5', 'b2', 'p4'],
			['r1', 'r1', 'r3', 'y1']
		], { level: 11 });

		takeTurn(game, 'Alice clues blue to Cathy');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['r1', 'y1', 'g1', 'b1', 'p1']);

		// Bob cannot receive a layered finesse as he cannot tell it apart from a bluff.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1].order].finessed, false);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][2].order], ['b1', 'b2']);
	});

	it(`prefers a bluff clue when more information is given`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'y5', 'b4', 'g5', 'p3'],
			['b3', 'r2', 'b2', 'b4', 'y4']
		], {
			level: 11,
			play_stacks: [0, 0, 5, 3, 0],
			starting: PLAYER.ALICE
		});
		const action = take_action(game);
		ExAsserts.objHasProperties(action, {target: 2, type: ACTION.COLOUR, value: COLOUR.RED});
	});

	it(`prefers a bluff clue when more information is given case 2`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'p5', 'y5', 'g5'],
			['p3', 'p4', 'b2', 'p2'],
			['y2', 'p3', 'g3', 'p2']
		], {
			level: 11,
			play_stacks: [4, 1, 1, 3, 0],
			starting: PLAYER.ALICE
		});
		const action = take_action(game);
		ExAsserts.objHasProperties(action, {target: 2, type: ACTION.COLOUR, value: COLOUR.PURPLE});
	});

	it(`understands a clandestine finesse`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'y5', 'y1', 'y1'],
			['g3', 'g3', 'b2', 'b1'],
			['g1', 'r1', 'r3', 'y2']
		], {
			level: 11,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slot 4)');

		// Alice's slot 4 should be r3 as a Clandestine Finesse (no 3 is a valid bluff target).
		// Note, it's not common knowledge that both g3's are visible in Cathy's hand.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r3', 'g3']);
		ExAsserts.cardHasInferences(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r3']);
	});

	it('rank connects on a self-finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'p1', 'y1', 'p4'],
			['r3', 'p3', 'p1', 'y2'],
			['b3', 'y2', 'g4', 'r5']
		], {
			starting: PLAYER.DONALD,
			level: 11
		});

		takeTurn(game, 'Donald clues 2 to Alice (slot 3)');
		takeTurn(game, 'Alice plays g1 (slot 1)');

		// Slot 3 should be g2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['g2']);
	});

	it(`understands a finesse when a player doesn't play into potential bluff`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'r2', 'b3', 'b1', 'r3'],
			['g3', 'r1', 'y4', 'p3', 'r1']
		], {
			starting: PLAYER.CATHY,
			level: 11
		});
		takeTurn(game, 'Cathy clues 1 to Alice (slots 3,5)');
		takeTurn(game, 'Alice plays g1 (slot 5)');
		takeTurn(game, 'Bob clues 3 to Cathy');

		// Initially Alice thinks this is a self bluff, rather than a finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order], ['r1', 'y1', 'g2', 'b1', 'p1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order].finessed, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);

		takeTurn(game, 'Cathy clues 1 to Bob');

		// After Cathy doesn't play into it, Alice should know it's a finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['g2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order].finessed, false);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);

		// This should also remove the original thoughts in Cathy's hand.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order].inferred.length > 5, true);
	});
});
