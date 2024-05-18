import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { clue_safe } from '../../src/conventions/h-group/clue-finder/clue-safe.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous clues', () => {
	it('understands a fake finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Alice (slot 2)');

		// Alice's slot 2 should be [g1,g2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g1', 'g2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][0].order].reasoning.length, 1);

		takeTurn(game, 'Cathy discards p3', 'r1');

		// Alice's slot 2 should just be g1 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g1']);
	});

	it('understands a self-connecting play clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g3', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 4)');
		takeTurn(game, 'Cathy clues 2 to Alice (slot 3)');
		takeTurn(game, 'Alice plays g1 (slot 4)');

		// Alice's slot 4 (used to be slot 3) should just be g2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['g2']);
	});

	it('understands a delayed finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
			['r3', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			play_stacks: [1, 0, 1, 1, 0]
		});

		takeTurn(game, 'Alice clues 2 to Cathy');
		takeTurn(game, 'Bob clues red to Alice (slot 3)');

		// Alice's slot 3 should be [r3,r4].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r3', 'r4']);

		takeTurn(game, 'Cathy plays r2', 'y1');

		// Alice's slot 3 should still be [r3,r4] to allow for the possibility of a hidden finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r3', 'r4']);

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'r1');
		takeTurn(game, 'Cathy plays r3', 'g1');

		// Alice's slot 4 (used to be slot 3) should be just [r4] now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r4']);
	});

	it('understands a fake delayed finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'g4', 'r5', 'b4'],
			['r2', 'b3', 'r1', 'y3', 'p3']
		], { level: 5 });

		takeTurn(game, 'Alice clues 1 to Cathy');
		takeTurn(game, 'Bob clues red to Alice (slot 3)');
		takeTurn(game, 'Cathy plays r1', 'y1');

		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'r1');
		takeTurn(game, 'Cathy discards p3', 'g1');

		// Alice's slot 4 (used to be slot 3) should be just [r2] now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r2']);
	});

	it('understands that a self-finesse may not be ambiguous', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'p4', 'r2', 'r3', 'g4'],
			['p2', 'p1', 'b3', 'y3', 'b4']
		], {
			level: 5,
			clue_tokens: 4,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');
		takeTurn(game, 'Cathy discards b4', 'r4');

		// Alice can deduce that she has a playable card on finesse position, but shouldn't play it.
		assert.ok(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed === false);
		assert.ok(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].inferred.length > 1);
	});

	it(`still finesses if cards in the finesse are clued, as long as they weren't the original finesse target`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'b1', 'g3', 'r1'],
			['p5', 'g3', 'p1', 'b3'],
			['p1', 'b1', 'r3', 'g1']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues blue to Cathy');			// r1, b1 layer -> b2 on us
		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');
		takeTurn(game, 'Donald plays p1', 'b4');
		takeTurn(game, 'Alice clues 1 to Donald');			// getting g1, but touches b1

		takeTurn(game, 'Bob clues blue to Donald');			// focusing b4, but filling in b1
		takeTurn(game, 'Cathy discards p1', 'g4');
		takeTurn(game, 'Donald plays b1', 'b5');

		// Alice's b2 in slot 1 should still be finessed.
		const slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order];
		assert.equal(slot1.finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[slot1.order], ['b2']);
	});

	it('does not assume it has finessed card if another finesse is given', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'p2', 'p4', 'y3'],
			['r3', 'r4', 'g3', 'g2'],
			['r1', 'r2', 'b3', 'y5']
		], { level: 5, starting: PLAYER.BOB });

		takeTurn(game, 'Bob clues red to Cathy');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, false);

		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald plays r1', 'p1');
		takeTurn(game, 'Alice discards b4 (slot 4)');
		takeTurn(game, 'Bob clues 2 to Alice (slot 4)');
		takeTurn(game, 'Cathy clues purple to Donald');
		takeTurn(game, 'Donald clues green to Cathy');

		// Donald gave a finesse, so Alice should still wait for the r2 play.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][1].order].finessed, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, false);

		// Meanwhile, Alice should play into the green finesse.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['g1']);
	});

	it('does not assume it has finessed card if a save was given', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'p2', 'p4', 'y3'],
			['r3', 'r4', 'g3', 'g2'],
			['r1', 'r2', 'b3', 'y5']
		], { level: 5, starting: PLAYER.BOB });

		takeTurn(game, 'Bob clues red to Cathy');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, false);

		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');

		// Donald gave a save, so Alice should still wait for the r1 play.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][0].order].finessed, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
	});
});

describe('guide principle', () => {
	it('does not give a finesse leaving a critical on chop', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['r4', 'r3', 'b3', 'y3', 'b5']
		], { level: 5 });

		// Giving 3 to Cathy should be unsafe since b5 will be discarded.
		assert.equal(clue_safe(game, game.me, { type: CLUE.RANK, value: 3, target: PLAYER.CATHY }), false);
	});
});

describe('mistake recovery', () => {
	it('should cancel an ambiguous self-finesse if a missed finesse is directly clued', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'p4', 'y2', 'b5'],
			['g3', 'b2', 'y1', 'r5'],
			['r3', 'r1', 'g4', 'b1']
		], {
			level: 2,
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 3 to Cathy');
		takeTurn(game, 'Alice plays g1 (slot 1)');
		takeTurn(game, 'Bob clues 5 to Alice (slot 4)');

		// Alice should interpret g2 as an ambiguous finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1].order], ['g2']);

		// Assume Cathy knows she doesn't have g2 because Alice has the other copy, just not in slot 2.
		takeTurn(game, 'Cathy clues 2 to Bob');

		// Alice should cancel ambiguous g2 in slot 2.
		// Note that this is not common since Bob is unaware of what happened.
		assert.ok(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1].order].inferred.length > 1);
		assert.equal(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1].order].finessed, false);
	});
});
