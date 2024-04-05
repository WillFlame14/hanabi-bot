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
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'b3', 'p1', 'g4'],
			['r5', 'p4', 'r4', 'b2'],
			['r1', 'g5', 'p2', 'p4']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 4)');
		takeTurn(game, 'Cathy clues red to Bob');			// r2 finesse

		const { common, state } = game;

		// Alice's slot 4 should still be any 1.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][3].order], ['r1', 'y1', 'g1', 'b1', 'p1']);

		// Donald's r1 should be finessed.
		assert.equal(common.thoughts[state.hands[PLAYER.DONALD][0].order].finessed, true);
	});

	it(`doesn't perform unknown self-prompts on target`, () => {
		const game = setup(HGroup, [
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

		takeTurn(game, 'Bob clues 3 to Cathy');		// saving y3 and touching r3
		takeTurn(game, 'Cathy clues red to Donald');	// getting r2
		takeTurn(game, 'Donald plays r2', 'r5');

		const { play_clues } = find_clues(game);

		// Red to Donald is not a valid play clue.
		assert.equal(play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED), false);
	});

	it(`doesn't connect on fake finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p1', 'p4', 'r3', 'y5'],
			['y5', 'r4', 'r4', 'r2'],
			['r1', 'b2', 'g3', 'b1']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 4)');
		takeTurn(game, 'Cathy clues 1 to Donald');
		takeTurn(game, 'Donald plays r1', 'p1');

		// Alice's slot 5 should be [r2,y2,g2,p2] (r2 would be stomped finesse, b2 is an illegal 2 Save).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r2','y2','g2','p2']);
	});

	it(`doesn't eliminate on missed finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'p4', 'r3', 'y5', 'r1'],
			['y5', 'g4', 'r3', 'b4', 'g5']
		], {
			level: 1,
			play_stacks: [1, 0, 2, 2, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slots 2,4)');	// Play clue on b3
		takeTurn(game, 'Alice plays b3 (slot 2)');
		takeTurn(game, 'Bob clues 5 to Cathy');

		takeTurn(game, 'Cathy discards b4', 'p1');
		takeTurn(game, 'Alice clues 3 to Cathy');				// Finesse for r3
		takeTurn(game, 'Bob discards r1', 'p1');				// Bob misses

		// Alice's 3 in slot 4 can still be any good-touch 3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r3','y3','g3','p3']);
	});
});
