import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../../src/constants.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';
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

describe('layered finesse', () => {
	it('understands a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'y1', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues yellow to Alice (slot 3)');

		// Alice's slot 3 should be [y1,y2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['y1', 'y2']);

		takeTurn(game, 'Cathy plays g1', 'b1');		// expecting y1 finesse
		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'r1');

		takeTurn(game, 'Cathy plays y1', 'y1');

		// Alice's slot 4 (used to be slot 3) should be y2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['y2']);
	});

	it('understands playing into a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3', 'r3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues yellow to Bob');

		// Alice's slot 1 should be [y1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['y1']);

		takeTurn(game, 'Alice plays g1 (slot 1)');		// expecting y1 finesse

		// Alice's slot 2 should be [y1] now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['y1']);
	});

	it('understands playing into a complex layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3'],
			['g1', 'r4', 'g4', 'r5'],
			['g2', 'r4', 'b4', 'g1']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 4 to Alice (slot 4)');	// touching g4
		takeTurn(game, 'Cathy plays g1 (slot 1)', 'p3');
		takeTurn(game, 'Donald plays g2 (slot 1)', 'r5');
		takeTurn(game, 'Alice plays p1 (slot 1)');

		const slot3 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order];
		ExAsserts.cardHasInferences(slot3, ['g3']);
		assert.equal(slot3.finessed, true);

		// Double-check that Alice also thinks slot 3 is g3 and finessed
		const alice_slot3 = game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1].order];
		ExAsserts.cardHasInferences(alice_slot3, ['g3']);
		assert.equal(alice_slot3.finessed, true);
	});

	it('does not try giving layered finesses on the same card', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'y1', 'p1', 'r5', 'b4'],
			['r2', 'y4', 'p2', 'g3', 'r3']
		], { level: 5 });

		const { play_clues } = find_clues(game);

		// Purple does not work as a layered finesse
		assert.equal(play_clues[PLAYER.CATHY].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.PURPLE), false);
	});

	it('gracefully handles clues that reveal layered finesses (non-matching)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b5', 'r2', 'y1', 'p4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY,
			discarded: ['y4']
		});

		takeTurn(game, 'Cathy clues red to Bob');			// r2 layered finesse on us
		takeTurn(game, 'Alice plays b1 (slot 1)');			// expecting r1 finesse
		takeTurn(game, 'Bob clues yellow to Alice (slots 2,5)');		// y4 save

		// Alice's slot 2 (the yellow card) should be finessed as y1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['y1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r1']);
	});

	it('gracefully handles clues that reveal layered finesses (matching)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b5', 'r2', 'y1', 'p4'],
			['y4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY,
			discarded: ['r4']
		});

		takeTurn(game, 'Cathy clues red to Bob'); 			// r2 layered finesse on us
		takeTurn(game, 'Alice plays b1 (slot 1)');			// expecting r1 finesse
		takeTurn(game, 'Bob clues red to Alice (slots 3,5)');		// r4 save

		// Alice's slot 2 should be finessed as [y1, g1, b2, p1].
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['y1', 'g1', 'b2', 'p1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r1']);
	});

	it('plays correctly into layered finesses with self-connecting cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y2', 'r5', 'r4'],
			['g1', 'r1', 'b5', 'g4', 'b4']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		// Cathy clues yellow to Bob, touching y2.
		takeTurn(game, 'Cathy clues yellow to Bob');		// y2 layered finesse on us
		takeTurn(game, 'Alice plays p1 (slot 1)');			// expecting y1 finesse
		takeTurn(game, 'Bob discards r4', 'b2');

		takeTurn(game, 'Cathy discards b4', 'b3');
		takeTurn(game, 'Alice plays p2 (slot 2)');			// expecting y1 finesse

		// y1 should be in slot 3 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['y1']);
	});

	it('understands a clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');	// r2 clandestine finesse

		// Alice's slot 3 should be [g2,r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2', 'g2']);

		takeTurn(game, 'Cathy plays g1', 'b1');			// expecing r1 finesse

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2', 'g2']);

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'g5');
		takeTurn(game, 'Cathy plays r1', 'r1');

		// Alice's slot 4 (used to be 3) should just be r2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r2']);
	});

	it('understands a fake clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'r1', 'b2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');	// r2 clandestine finesse

		// Alice's slot 3 should be [g2,r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2', 'g2']);

		takeTurn(game, 'Cathy plays g1', 'b1');			// expecing r1 finesse

		// Alice's slot 3 should still be [g2,r2] to allow for the possibility of a clandestine finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2', 'g2']);

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'g5');
		takeTurn(game, 'Cathy clues 5 to Bob');

		// Alice's slot 4 (used to be 3) should just be g2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['g2']);
	});

	it('understands a symmetric clandestine finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r3'],
			['r2', 'y1', 'b2', 'y3', 'p3']
		], {
			level: 5,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues 3 to Bob');		// r3 reverse finesse

		// However, it could also be a y3 clandestine finesse. Bob's slot 5 should be [r3,y3].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][4].order], ['r3', 'y3']);
	});

	it(`doesn't give illegal clandestine self-finesses`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'r1', 'g1', 'y3', 'p3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], { level: 5 });

		const { play_clues } = find_clues(game);

		// 2 to Bob is an illegal play clue.
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 2));
		takeTurn(game, 'Alice clues 2 to Bob');
	});

	it('understands a queued finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Cathy');		// g2 finesse on us

		// Alice's slot 1 should be [g1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['g1']);

		takeTurn(game, 'Cathy clues 2 to Bob');			// r2 finesse on us

		// Alice's slot 2 should be [r1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r1']);

		// Alice should play slot 1 first.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0].order });
	});

	it('waits for a queued finesse to resolve', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'r1', 'r4', 'g4', 'b4']
		], { level: 5 });

		takeTurn(game, 'Alice clues green to Bob');			// g2 reverse finesse on Cathy
		takeTurn(game, 'Bob clues red to Alice (slot 2)');		// r2 reverse finesse on Cathy
		takeTurn(game, 'Cathy plays g1', 'b1');

		// Alice's slot 2 should still be [r1, r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['r1', 'r2']);
	});

	it('plays queued finesses in the right order', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 2 to Bob');		// r2 finesse
		takeTurn(game, 'Alice plays b1 (slot 1)');		// expecting r1 finesse
		takeTurn(game, 'Bob clues green to Cathy');	// g2 reverse finesse

		takeTurn(game, 'Cathy discards p3', 'y1');

		// Alice should play slot 2 first (continue digging for r1).
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][1].order });
	});
});
