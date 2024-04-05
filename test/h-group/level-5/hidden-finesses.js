import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import logger from '../../../src/tools/logger.js';
import { team_elim } from '../../../src/basics/helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('hidden finesse', () => {
	it('understands a hidden finesse (rank)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b5'],
			['r1', 'b3', 'p3', 'y3', 'r2']
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');	// 2 Save
		takeTurn(game, 'Cathy bombs r1', 'g2');
		takeTurn(game, 'Alice clues 5 to Bob');	// 5 Save

		takeTurn(game, 'Bob clues 3 to Alice (slot 3)');

		// Alice's slot 3 should be [r3,g3].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r3', 'g3']);

		takeTurn(game, 'Cathy plays r2', 'r1');	// expecting g2 prompt

		// Alice's slot 3 should still be [r3,g3] to allow for the possibility of a hidden finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r3', 'g3']);
	});

	it('understands a fake hidden finesse (rank)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g3', 'b3', 'p3', 'y3', 'r2']
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');	// 2 Save
		takeTurn(game, 'Cathy bombs g3', 'g2');
		takeTurn(game, 'Alice clues 5 to Bob');	// 5 Save

		takeTurn(game, 'Bob clues 3 to Alice (slot 3)');
		takeTurn(game, 'Cathy plays r2', 'b1');			// r2 prompt
		takeTurn(game, 'Alice discards b1 (slot 5)');		// waiting for g2 hidden finesse

		takeTurn(game, 'Bob discards b4', 'r1');
		takeTurn(game, 'Cathy discards p3', 'y1');			// Cathy demonstrates not hidden finesse

		// Alice's slot 4 (used to be 3) should just be r3 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r3']);
	});

	it('understands a complicated fake hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'p4', 'r3', 'y3', 'r5'],
			['y2', 'g2', 'b1', 'g3', 'r1']
		], {
			level: 1,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy plays r1', 'g1');
		takeTurn(game, 'Alice clues purple to Bob');

		takeTurn(game, 'Bob clues 2 to Alice (slot 1)');	// could be r2, g2 (finesse), b2 or p2 (selfish)
		takeTurn(game, 'Cathy plays b1', 'y5');
		takeTurn(game, 'Alice clues 5 to Bob');

		takeTurn(game, 'Bob clues 2 to Cathy');		// focusing y2 as a reverse finesse on us

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['y1']);

		takeTurn(game, 'Cathy discards g3', 'p3');

		// Cathy didn't play into the green finesse, so we have r2,b2,p2 in slot 1
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['r2', 'b2', 'p2']);
	});

	it('plays into a hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r2', 'r3', 'p1', 'b4'],
			['p2', 'g4', 'y2', 'b4', 'p5']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays y1 (slot 3)');
		takeTurn(game, 'Bob clues 5 to Cathy');

		takeTurn(game, 'Cathy clues red to Bob');		// r2 hidden finesse
		takeTurn(game, 'Alice plays b1 (slot 3)');		// expecting r1 playable

		// Our slot 1 (now slot 2) should be r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r1']);
	});

	it('correctly generates focus possibilities for a connection involving a hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'y4', 'b1', 'r5', 'g4'],
			['y3', 'g2', 'b3', 'p5', 'p4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy's g2 is fully known.
		const g2 = game.common.thoughts[game.state.hands[PLAYER.CATHY][1].order];
		g2.clued = true;
		g2.possible = g2.possible.intersect([expandShortCard('g2')]);
		g2.inferred = g2.inferred.intersect([expandShortCard('g2')]);
		g2.clues.push({ type: CLUE.RANK, value: 2 });
		g2.clues.push({ type: CLUE.COLOUR, value: COLOUR.GREEN });

		// Bob's b1 is clued with 1.
		const b1 = game.common.thoughts[game.state.hands[PLAYER.BOB][2].order];
		b1.clued = true;
		b1.possible = b1.possible.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		b1.possible = b1.inferred.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		b1.clues.push({ type: CLUE.RANK, value: 1 });

		team_elim(game);

		takeTurn(game, 'Cathy clues green to Alice (slot 2)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g1', 'g3']);
	});
});
