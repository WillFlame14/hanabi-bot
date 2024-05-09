import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../../src/tools/logger.js';
import { clue_safe } from '../../../src/conventions/h-group/clue-finder/clue-safe.js';

logger.setLevel(logger.LEVELS.ERROR);

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

	it('writes correct notes for a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'g2', 'y1', 'y2', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues yellow to Alice (slot 3)');

		// Cathy's hand should be marked correctly.
		assert.ok(game.state.hands[PLAYER.CATHY].every(c => game.common.thoughts[c.order].inferred.has(c)));
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

		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order];
		ExAsserts.cardHasInferences(slot2, ['g3']);
		assert.equal(slot2.finessed, true);

		// Double-check that Alice also thinks slot 2 is g3 and finessed
		const alice_slot2 = game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1].order];
		ExAsserts.cardHasInferences(alice_slot2, ['g3']);
		assert.equal(alice_slot2.finessed, true);
	});

	it('understands when it dupes a card in its own layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'b4', 'g2', 'r5'],
			['g1', 'b2', 'y3', 'r4'],
			['p1', 'r3', 'r1', 'g3']
		], {
			level: 5,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 4 to Cathy');		// r2 on Cathy, r3 on us
		takeTurn(game, 'Alice clues green to Bob');		// reverse finesse for g1
		takeTurn(game, 'Bob plays r2', 'b4');
		takeTurn(game, 'Cathy plays g1', 'g4');

		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');
		takeTurn(game, 'Alice bombs g1 (slot 1)');		// We try to play r3, but end up bombing a copy of g1 that was layered.

		// Slot 2 should still be finessed as r3.
		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order];
		ExAsserts.cardHasInferences(slot2, ['r3']);
		assert.equal(slot2.finessed, true);
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

	it('recognizes unsafe players when they cannot play into a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'r3', 'r2', 'g5', 'p4'],
			['r1', 'r2', 'g4', 'y3', 'b4']
		], {
			level: 6,
			clue_tokens: 6
		});

		takeTurn(game, 'Alice clues 3 to Bob');
		takeTurn(game, 'Bob discards p4', 'b4');
		takeTurn(game, 'Cathy plays r1', 'g1');

		// Green to Cathy is not safe, Bob cannot play into the r3 layer.
		assert.equal(clue_safe(game, game.me, { type: CLUE.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN }), false);
	});
});
