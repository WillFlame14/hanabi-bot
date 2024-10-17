import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';

import HGroup from '../../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../../src/constants.js';
import { team_elim } from '../../../src/basics/helper.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('hidden finesse', () => {
	it('understands a hidden finesse (rank)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b5'],
			['r1', 'b3', 'p3', 'y3', 'r2']
		], {
			level: { min: 5 },
			play_stacks: [1, 0, 1, 1, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');	// 2 Save
		takeTurn(game, 'Cathy bombs r1', 'g2');
		takeTurn(game, 'Alice clues 5 to Bob');	// 5 Save

		takeTurn(game, 'Bob clues 3 to Alice (slot 3)');

		// Alice's slot 3 should be [r3,g3].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r3', 'g3']);

		takeTurn(game, 'Cathy plays r2', 'r1');	// expecting g2 prompt

		// Alice's slot 3 should still be [r3,g3] to allow for the possibility of a hidden finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r3', 'g3']);
	});

	it('understands a fake hidden finesse (rank)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g3', 'b3', 'p3', 'y3', 'r2']
		], {
			level: { min: 5 },
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
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['r3']);
	});

	it('understands a complicated fake hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'p4', 'r3', 'y3', 'r5'],
			['y2', 'g2', 'b1', 'g3', 'r1']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy plays r1', 'g1');
		takeTurn(game, 'Alice clues purple to Bob');

		takeTurn(game, 'Bob clues 2 to Alice (slot 1)');	// could be r2, g2 (finesse), b2 or p2 (selfish)
		takeTurn(game, 'Cathy plays b1', 'y5');
		takeTurn(game, 'Alice clues 5 to Bob');

		takeTurn(game, 'Bob clues 2 to Cathy');		// focusing y2 as a reverse finesse on us

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y1']);

		takeTurn(game, 'Cathy discards g3', 'p3');

		// Cathy didn't play into the green finesse, so we have r2,b2,p2 in slot 1
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r2', 'b2', 'p2']);
	});

	it('plays into a hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r2', 'r3', 'p1', 'b4'],
			['p2', 'g4', 'y2', 'b4', 'p5']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays y1 (slot 3)');
		takeTurn(game, 'Bob clues 5 to Cathy');

		takeTurn(game, 'Cathy clues red to Bob');		// r2 hidden finesse
		takeTurn(game, 'Alice plays b1 (slot 3)');		// expecting r1 playable

		// Our slot 1 (now slot 2) should be r1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r1']);
	});

	it('correctly generates focus possibilities for a connection involving a hidden finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'y4', 'b1', 'r5', 'g4'],
			['y3', 'g2', 'b3', 'p5', 'p4']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		// Cathy's g2 is fully known.
		const g2 = game.common.thoughts[game.state.hands[PLAYER.CATHY][1]];
		g2.clued = true;
		g2.possible = g2.possible.intersect([expandShortCard('g2')]);
		g2.inferred = g2.inferred.intersect([expandShortCard('g2')]);
		g2.clues.push({ type: CLUE.RANK, value: 2, giver: PLAYER.ALICE, turn: -1 });
		g2.clues.push({ type: CLUE.COLOUR, value: COLOUR.GREEN, giver: PLAYER.ALICE, turn: -1 });

		// Bob's b1 is clued with 1.
		const b1 = game.common.thoughts[game.state.hands[PLAYER.BOB][2]];
		b1.clued = true;
		b1.possible = b1.possible.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		b1.possible = b1.inferred.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		b1.clues.push({ type: CLUE.RANK, value: 1, giver: PLAYER.ALICE, turn: -1 });

		team_elim(game);

		takeTurn(game, 'Cathy clues green to Alice (slot 2)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['g1', 'g3']);
	});

	it('correctly realizes a hidden/layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'r2', 'y4', 'g2'],
			['y4', 'g4', 'p3', 'y3'],
			['p3', 'g4', 'g2', 'b2']

		], {
			level: { min: 5 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 1 to Alice (slots 2,4)');
		takeTurn(game, 'Alice plays r1 (slot 4)');
		takeTurn(game, 'Bob clues 3 to Cathy');				// Looks like y1 (playable) -> y2 finesse on Alice
		takeTurn(game, 'Cathy discards g4', 'p4');
		takeTurn(game, 'Donald clues green to Bob');		// g1 needs to finesse from Alice, but slot 1 is [y2] and slot 2 is neg 1.

		const action = take_action(game);

		// Alice should play slot 3.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][2] });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['y1', 'g1']);

		// Slot 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);

		takeTurn(game, 'Alice plays y1 (slot 3)');

		// Alice's slot 2 should still be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].finessed, true);
	});

	it('correctly realizes a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'r2', 'y4', 'g2'],
			['p4', 'g4', 'p3', 'y4'],
			['p3', 'g4', 'g2', 'b2']

		], {
			level: { min: 5 },
			play_stacks: [0, 2, 0, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 1 to Alice (slot 4)');
		takeTurn(game, 'Alice plays r1 (slot 4)');
		takeTurn(game, 'Bob clues yellow to Cathy');		// Looks like y3 finesse from us
		takeTurn(game, 'Cathy clues green to Bob');			// g1 needs to finesse from Alice, but slot 1 is [y3] and slot 2 is neg 1.
		takeTurn(game, 'Donald discards b2', 'b5');

		// Slots 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);

		const action = take_action(game);

		// Alice should play slot 1.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['y3', 'g1']);

		takeTurn(game, 'Alice plays g1 (slot 1)');

		// Alice's slot 2 should still be finessed as y3.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y3']);
	});

	it(`doesn't give bad hidden finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'y1', 'r1', 'y2', 'b5'],
			['r1', 'b4', 'p4', 'y3', 'r2']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		const { play_clues } = find_clues(game);

		// 3 or yellow to Cathy aren't valid play clues.
		assert.ok(!play_clues[PLAYER.CATHY].some(clue =>
			clue.type === CLUE.RANK && clue.value === 3 || clue.type === CLUE.COLOUR && clue.value === COLOUR.YELLOW));
	});
});
