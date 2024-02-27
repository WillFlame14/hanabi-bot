import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('self-finesse', () => {
	it('does not give bad self-finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'r4', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 2,
			play_stacks: [1, 3, 0, 1, 2],
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues green to Cathy');

		const { play_clues } = find_clues(state);

		// 3 to Bob is not a valid clue.
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});

	it('plays correctly into self-finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 2,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');
		takeTurn(state, 'Alice plays g1 (slot 1)');

		// Slot 2 should be g2.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][1].order], ['g2']);
	});

	it('interprets self-finesses correctly when giver knows less', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r1', 'g4', 'b1', 'g3'],
			['g1', 'g2', 'r5', 'y3', 'p3']
		], { level: 2 });

		takeTurn(state, 'Alice clues 1 to Bob');
		takeTurn(state, 'Bob clues 2 to Cathy');

		// Cathy's slot 1 should be finessed, Alice's slot 1 should not.
		assert.equal(state.common.thoughts[state.hands[PLAYER.CATHY][0].order].finessed, true);
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
	});
});

describe('asymmetric clues', () => {
	it('understands delayed play clues through asymetrically known cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'r4', 'r5'],
			['g4', 'y3', 'r4', 'p2'],
			['g3', 'g2', 'p3', 'b3']
		], {
			level: 2,
			play_stacks: [0, 0, 0, 1, 0],	// b1 has been played. We hold a b2 in our hand.
			starting: PLAYER.CATHY
		});

		takeTurn(state, 'Cathy clues blue to Donald');	// finessing b2
		takeTurn(state, 'Donald clues 4 to Bob'); 	// Donald knows that he has b3, not b2 since he can see Bob's b2 and ours.

		// We think we have b3 in slot 1, as a Certain Finesse. 
		// ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][0].order], ['b3']);

		takeTurn(state, 'Alice clues 5 to Bob');	// 5 Save
		takeTurn(state, 'Bob plays b2', 'y5');
		takeTurn(state, 'Cathy clues 5 to Alice (slot 4)');	// 5 Save
		takeTurn(state, 'Donald plays b3', 'r2');

		// We should no longer think that we have b3 in slot 1.
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].inferred.length > 1, true);
		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][0].order].finessed, false);
	});

	it('understands multiple interpretations when connecting through multiple possible cards in other hand', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b4', 'g3', 'r4'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'g5', 'y1', 'b4']
		], {
			level: 2,
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Donald');
		takeTurn(state, 'Cathy clues 3 to Bob');	// connecting on g1 (Donald, playable) and g2 (Bob, finesse)

		// Bob's slot 1 can be either g2 or y2, since he doesn't know which 1 is connecting.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][0].order], ['y2', 'g2']);
	});

	it('prefers the least number of blind plays on target', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], {
			level: 2,
			play_stacks: [0, 1, 0, 0, 0]	// y1 is played.
		});

		takeTurn(state, 'Alice clues yellow to Donald');	// getting y2
		takeTurn(state, 'Bob clues 1 to Donald');			// getting g1
		takeTurn(state, 'Cathy clues 4 to Bob');			// connecting on y2 (Donald, known) and y3 (Bob, finesse)

		// Bob's slot 1 must be y3, since it only requires one blind play (y3) instead of two (g2,g3).
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][0].order], ['y3']);
	});

	it('includes the correct interpretation, even if it requires more blind plays', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'g3', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], {
			level: 2,
			play_stacks: [0, 1, 0, 0, 0]	// y1 is played.
		});

		takeTurn(state, 'Alice clues yellow to Donald');	// y2
		takeTurn(state, 'Bob clues 1 to Donald');
		takeTurn(state, 'Cathy clues 4 to Bob');			// connecting on g2 (Bob, finesse) and g3 (Bob, finesse)

		// Although y3 should still be preferred, the correct inference is g2 -> g3 double self-finesse.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.BOB][0].order], ['g2','y3']);
	});

	it('connects when a card plays early', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p5', 'y4', 'r1', 'b3'],
			['p1', 'p2', 'y3', 'y1'],
			['g1', 'g5', 'y1', 'b5']
		], {
			level: 2,
			starting: PLAYER.DONALD
		});

		takeTurn(state, 'Donald clues 2 to Alice (slot 4)');	// 2 Save
		takeTurn(state, 'Alice clues 1 to Donald');				// getting g1, y1
		takeTurn(state, 'Bob clues 3 to Cathy');				// connecting on y1 (Donald, playable) and y2 (Alice, prompt)

		// The clued card is likely g3 or y3, since that requires the least number of blind plays.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.CATHY][2].order], ['y3', 'g3']);

		takeTurn(state, 'Cathy clues 5 to Donald');		// 5 Save
		takeTurn(state, 'Donald plays y1', 'r4');

		// Note that at level 5, Alice cannot play y2, since it could be a hidden finesse.
		takeTurn(state, 'Alice plays y2 (slot 4)');

		// y3 should be known, since y2 played before g1 played.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.CATHY][2].order], ['y3']);
	});
});
