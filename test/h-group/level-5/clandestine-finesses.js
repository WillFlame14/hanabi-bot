import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('clandestine finesses', () => {
	it('understands a clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');	// r2 clandestine finesse

		// Alice's slot 3 should be [g2,r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2', 'g2']);

		takeTurn(game, 'Cathy plays g1', 'b1');			// expecing r1 finesse

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2', 'g2']);

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'g5');
		takeTurn(game, 'Cathy plays r1', 'r1');

		// Alice's slot 4 (used to be 3) should just be r2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['r2']);
	});

	it('understands a fake clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');	// r2 clandestine finesse

		// Alice's slot 3 should be [g2,r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2', 'g2']);

		takeTurn(game, 'Cathy plays g1', 'b1');			// expecing r1 finesse

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2', 'g2']);

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'g5');
		takeTurn(game, 'Cathy clues 5 to Bob');

		// Alice's slot 4 (used to be 3) should just be g2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['g2']);
	});

	it('understands a symmetric clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r3'],
			['r2', 'y1', 'b2', 'y3', 'p3']
		], {
			level: { min: 5 },
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues 3 to Bob');		// r3 reverse finesse

		// However, it could also be a y3 clandestine finesse. Bob's slot 5 should be [r3,y3].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][4]], ['r3', 'y3']);
	});

	it(`doesn't give illegal clandestine self-finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r1', 'g1', 'y3', 'p3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], { level: { min: 5 } });

		const { play_clues } = find_clues(game);

		// 2 to Bob is an illegal play clue.
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 2));
		takeTurn(game, 'Alice clues 2 to Bob');
	});

	it(`recognizes fake clandestine finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'p4', 'p1', 'b1'],
			['b4', 'y2', 'y5', 'b3'],
			['b1', 'b2', 'y1', 'p2']
		], { level: { min: 5 } });

		// Alice gives a triple finesse on b4. However, Cathy believes that it could be a y4 Clandestine Finesse.
		takeTurn(game, 'Alice clues 4 to Cathy');

		// Bob gives a reverse finesse on y2.
		takeTurn(game, 'Bob clues 2 to Cathy');

		// Donald's y1 should be finessed, not our slot 1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][2]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.DONALD][2]], ['y1']);

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, false);
	});
});
