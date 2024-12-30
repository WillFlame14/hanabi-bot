import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import logger from '../../../src/tools/logger.js';
import { get_result } from '../../../src/conventions/h-group/clue-finder/determine-clue.js';
import { CLUE } from '../../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('ambiguous finesse', () => {
	it('understands an ambiguous finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'b4', 'y5', 'y2', 'p4'],
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues green to Bob');

		// Donald's g1 should be finessed
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][0]].finessed, true);

		takeTurn(game, 'Donald discards p4', 'r1');

		// Alice's slot 2 should be [g1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['g1']);
	});

	it('understands an ambiguous finesse with a self component', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');
		takeTurn(game, 'Cathy discards p3', 'r1');

		// Alice's slot 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it('passes back a layered ambiguous finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'g2', 'g4', 'r5'],
			['g3', 'y4', 'p4', 'y3'],
			['r1', 'r2', 'b4', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Bob');
		takeTurn(game, 'Donald discards p3', 'b3');

		// Alice should pass back, making her slot 1 not finessed and Donald's slots 2 and 3 (used to be slots 1 and 2) finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, false);
		assert.ok([1,2].every(index => game.common.thoughts[game.state.hands[PLAYER.DONALD][index]].finessed));
	});

	it('understands an ambiguous finesse pass-back', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b1', 'b5', 'r1', 'y5'],
			['r4', 'g2', 'g4', 'r5'],
			['p4', 'b4', 'p2', 'y1']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Donald');	// Ambiguous finesse on us and Bob
		takeTurn(game, 'Donald clues 5 to Cathy');
		takeTurn(game, 'Alice clues 5 to Bob');			// we pass finesse to Bob
		takeTurn(game, 'Bob clues yellow to Donald');		// Bob passes back (not urgent save, Donald can clue r1)

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['b1']);
	});

	// it('understands a really ambiguous finesse', () => {
	// 	const game = setup(HGroup, [
	// 		['xx', 'xx', 'xx', 'xx', 'xx'],		// Alice's hand is g1 r4 r5 b4 g3
	// 		['r1', 'r2', 'g2', 'g4', 'p4'],
	// 		['r4', 'b2', 'g4', 'r5', 'b1']
	// 	], {
	// 		level: { min: 5 },
	// 		starting: PLAYER.CATHY
	// 	});

	// 	takeTurn(game, 'Cathy clues 3 to Alice (slot 5)');	// looks r3 to Alice
	// 	takeTurn(game, 'Alice clues blue to Cathy');		// Alice passes to Bob. Bob knows he has a 1 on finesse.
	// 	takeTurn(game, 'Bob clues 5 to Cathy');				// Bob can't play because he might have 1 of the wrong colour. Alice now knows she has 13 matching.

	// 	takeTurn(game, 'Cathy plays b1', 'y1');
	// 	takeTurn(game, 'Alice clues yellow to Cathy');		// Alice can't play because her 13 might be red. Bob now knows he can fulfill the entire finesse.
	// 	takeTurn(game, 'Bob discards p4', 'p1');			// Bob can't play because he might have the finesse of the wrong colour (the actual situation).

	// 	// Alice now knows that she has to play into it.
	// 	assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	// 	ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['g1']);
	// });

	it('prefers hidden prompt over ambiguous', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'b2', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g2', 'y2', 'g5', 'b2']
		], {
			level: { min: 5 },
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Donald');
		takeTurn(game, 'Cathy clues 4 to Bob');	// connecting on g2 (Donald, prompt) and g3 (Bob, finesse)

		// There should be y3 -> y4 and g3 -> g4 waiting connections.
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.GREEN && wc.inference.rank === 4));
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.YELLOW && wc.inference.rank === 4));
	});

	it('correctly counts playables for ambiguous finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'g3', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['b2', 'b4', 'y5', 'y2', 'g2'],
		], { level: { min: 5 } });

		const clue = { type: CLUE.COLOUR, target: PLAYER.DONALD, value: COLOUR.GREEN };
		const list = game.state.clueTouched(game.state.hands[PLAYER.DONALD], clue);
		const action = /** @type {const} */({ type: 'clue', giver: PLAYER.ALICE, target: PLAYER.DONALD, list, clue });
		const hypo_state = game.simulate_clue(action);
		const { playables } = get_result(game, hypo_state, action);

		// There should be 2 playables: g1 (Bob) and g2 (Donald).
		assert.equal(playables.length, 2);
	});

	it('recognizes an ambiguous self-finesse when a direct clue is impossible', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'r4', 'g4', 'r3'],
			['y2', 'y3', 'r4', 'p2'],
			['g2', 'y5', 'g5', 'b2']
		], {
			level: { min: 5 },
			play_stacks: [0, 1, 0, 0, 0],
			discarded: ['y2'],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 2 to Alice (slot 2)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r2','y2','g2','b2','p2']);
		ExAsserts.cardHasInferences(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1]], ['r2','g2','b2','p2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);

		takeTurn(game, 'Alice plays r1 (slot 1)');
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r2']);
	});

	it('understands an ambiguous reverse finesse where the finessed card is discarded', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'r4', 'r4', 'g1', 'y3'],
			['b5', 'p5', 'y5', 'r3', 'r1']
		], {
			level: { min: 5 }
		});

		takeTurn(game, 'Alice clues red to Cathy');		// getting r1
		takeTurn(game, 'Bob clues 5 to Cathy');			// Cathy is now fully clued.
		takeTurn(game, 'Cathy plays r1', 'r2');

		takeTurn(game, 'Alice clues green to Bob');		// getting g1
		takeTurn(game, 'Bob clues 3 to Cathy');			// looks like r2 self-finesse
		takeTurn(game, 'Cathy discards r2', 'p3');		// Cathy shows that it is ambiguous on us.

		// ALice's slot 1 should be finessed as r2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});
});
