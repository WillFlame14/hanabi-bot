import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('self-finesse', () => {
	it('does not give bad self-finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'r4', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 2,
			play_stacks: [1, 3, 0, 1, 2],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Cathy');

		const { play_clues } = find_clues(game);

		// 3 to Bob is not a valid clue.
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});

	it('plays correctly into self-finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 2,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 2)');
		takeTurn(game, 'Alice plays g1 (slot 1)');

		const { common, state } = game;

		// Slot 2 should be g2.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1].order], ['g2']);
	});

	it('interprets self-finesses correctly when giver knows less', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r1', 'g4', 'b1', 'g3'],
			['g1', 'g2', 'r5', 'y3', 'p3']
		], { level: 2 });

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob clues 2 to Cathy');

		const { common, state } = game;

		// Cathy's slot 1 should be finessed, Alice's slot 1 should not.
		assert.equal(common.thoughts[state.hands[PLAYER.CATHY][0].order].finessed, true);
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
	});

	it('interprets self-finesses correctly when other possibilities are impossible', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'b4', 'g4', 'p1'],
			['b2', 'b3', 'p1', 'g3'],
			['b5', 'b2', 'r4', 'p5']
		], {
			level: 2,
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues purple to Alice (slot 2)');	// p1 play
		takeTurn(game, 'Alice plays p1 (slot 2)');
		takeTurn(game, 'Bob clues blue to Cathy');					// b2 reverse finesse on us
		takeTurn(game, 'Cathy clues 5 to Donald');

		takeTurn(game, 'Donald clues 4 to Bob');					// connect b4
		takeTurn(game, 'Alice plays b1 (slot 1)');
		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');			// 2 is neg purple, b2 is clued in Cathy's hand

		// Alice's slot 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2']);
	});
});

describe('direct clues', () => {
	it(`doesn't self-prompt when a clue could be direct`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b4', 'r4', 'r5', 'g2'],
			['b2', 'y3', 'r4', 'p2', 'p3']
		], {
			level: 2,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays b1 (slot 5)');
		takeTurn(game, 'Bob clues blue to Alice (slots 1,5)');

		const { common, state } = game;

		// Alice's slot 1 should only be [b2,b3], not [b2,b3,b4].
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][0].order], ['b2', 'b3']);
	});

	it('allows finesses to look direct if someone else plays into it first', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b2', 'y4', 'r3', 'r5'],
			['g5', 'y3', 'r4', 'p2', 'r3']
		], {
			level: 2,
			play_stacks: [0, 2, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slot 2)');

		const { common, state } = game;

		// While ALice's slot 2 could be y3, it could also be g3 (reverse finesse on Bob + self-finesse).
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1].order], ['y3', 'g3']);
	});

	it(`assumes direct play over a "stomped" finesse involving a self-component`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'b2', 'y4', 'r3'],
			['g5', 'y3', 'r4', 'p2'],
			['g1', 'r3', 'y2', 'b3']
		], {
			level: 2,
			play_stacks: [0, 2, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 3 to Alice (slot 4)');	// Could be direct play on y3 or finesse on g3
		takeTurn(game, 'Cathy clues green to Donald');		// "stomping" on the g3 finesse
		takeTurn(game, 'Donald plays g1', 'g4');

		// Alice should assume the simpler explanation that she doesn't have to play g2.
		const slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order];
		assert.equal(slot1.finessed, false);
		assert.ok(slot1.inferred.length > 1);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['y3']);
	});
});

describe('asymmetric clues', () => {
	it('understands delayed play clues through asymetrically known cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'r4', 'r5'],
			['g4', 'y3', 'r4', 'p2'],
			['g3', 'g2', 'p3', 'b3']
		], {
			level: 2,
			play_stacks: [0, 0, 0, 1, 0],	// b1 has been played. We hold a b2 in our hand.
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues blue to Donald');	// finessing b2
		takeTurn(game, 'Donald clues 4 to Bob'); 	// Donald knows that he has b3, not b2 since he can see Bob's b2 and ours.

		// We think we have b3 in slot 1, as a Certain Finesse. 
		// ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][0].order], ['b3']);

		takeTurn(game, 'Alice clues 5 to Bob');	// 5 Save
		takeTurn(game, 'Bob plays b2', 'y5');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');	// 5 Save
		takeTurn(game, 'Donald plays b3', 'r2');

		const { common, state } = game;

		// We should no longer think that we have b3 in slot 1.
		const slot1 = common.thoughts[state.hands[PLAYER.ALICE][0].order];
		assert.equal(slot1.inferred.length > 1, true);
		assert.equal(slot1.finessed, false);
	});

	it('understands multiple interpretations when connecting through multiple possible cards in other hand', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b4', 'g3', 'r4'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'g5', 'y1', 'b4']
		], {
			level: 2,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Donald');
		takeTurn(game, 'Cathy clues 3 to Bob');	// connecting on g1 (Donald, playable) and g2 (Bob, finesse)

		const { common, state } = game;

		// Bob's slot 1 can be either g2 or y2, since he doesn't know which 1 is connecting.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][0].order], ['y2', 'g2']);
	});

	it('prefers the least number of blind plays on target', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], {
			level: 2,
			play_stacks: [0, 1, 0, 0, 0]	// y1 is played.
		});

		takeTurn(game, 'Alice clues yellow to Donald');	// getting y2
		takeTurn(game, 'Bob clues 1 to Donald');			// getting g1
		takeTurn(game, 'Cathy clues 4 to Bob');			// connecting on y2 (Donald, known) and y3 (Bob, finesse)

		const { common, state } = game;

		// Bob's slot 1 must be y3, since it only requires one blind play (y3) instead of two (g2,g3).
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][0].order], ['y3']);
	});

	it('prefers not starting with self, even if there are known playables before', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g1', 'y3', 'r4', 'p2'],
			['g2', 'p4', 'y5', 'b4']
		], {
			level: 2,
			play_stacks: [0, 2, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues green to Donald');
		takeTurn(game, 'Bob clues 4 to Alice (slot 2)');

		const { common, state } = game;

		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1].order], ['y4']);

		// Alice's slot 1 should not be finessed.
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
	});

	it('includes the correct interpretation, even if it requires more blind plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'g3', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], {
			level: 2,
			play_stacks: [0, 1, 0, 0, 0]	// y1 is played.
		});

		takeTurn(game, 'Alice clues yellow to Donald');	// y2
		takeTurn(game, 'Bob clues 1 to Donald');
		takeTurn(game, 'Cathy clues 4 to Bob');			// connecting on g2 (Bob, finesse) and g3 (Bob, finesse)

		const { common, state } = game;

		// Although y3 should still be preferred, the correct inference is g2 -> g3 double self-finesse.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][0].order], ['g2','y3']);
	});

	it('connects when a card plays early', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p5', 'y4', 'r1', 'b3'],
			['p1', 'p2', 'y3', 'y1'],
			['g1', 'g5', 'y1', 'b5']
		], {
			level: 2,
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 2 to Alice (slot 4)');	// 2 Save
		takeTurn(game, 'Alice clues 1 to Donald');				// getting g1, y1
		takeTurn(game, 'Bob clues 3 to Cathy');				// connecting on y1 (Donald, playable) and y2 (Alice, prompt)

		// The clued card is likely g3 or y3, since that requires the least number of blind plays.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][2].order], ['y3', 'g3']);

		takeTurn(game, 'Cathy clues 5 to Donald');		// 5 Save
		takeTurn(game, 'Donald plays y1', 'r4');

		// Note that at level 5, Alice cannot play y2, since it could be a hidden finesse.
		takeTurn(game, 'Alice plays y2 (slot 4)');

		// y3 should be known, since y2 played before g1 played.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][2].order], ['y3']);
	});

	it('connects to a finesse after a fake finesse was just disproven', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'y4', 'r1', 'b3', 'y1'],
			['g1', 'y3', 'p4', 'y1', 'b5']
		], {
			level: 2,
			play_stacks: [2, 1, 1, 1, 2],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slots 2,5)'); 	// Could be b3 reverse finesse or r3, p3 
		takeTurn(game, 'Alice clues 5 to Cathy');
		takeTurn(game, 'Bob clues purple to Cathy');

		// Alice's slot 2 can be any 3 (not prompted to be p3).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r3', 'y3', 'g3', 'b3']);
	});
});

describe('continuation clues', () => {
	it(`doesn't give continuation clues when cards are in a superposition`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r2'],
			['r3', 'g3', 'p2', 'p1'],
			['b4', 'y2', 'r4', 'p1']
		], {
			level: 2,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 3,4)');
		takeTurn(game, 'Donald clues 5 to Bob');

		// Red to Donald is not a valid play clue.
		const { play_clues } = find_clues(game);
		assert.ok(!play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED));
	});
});
