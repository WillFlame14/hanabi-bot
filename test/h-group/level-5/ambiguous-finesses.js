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
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues green to Bob');

		// Donald's g1 should be finessed
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.DONALD][0].order].finessed, true);

		takeTurn(game, 'Donald discards p4', 'r1');

		// Alice's slot 2 should be [g1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['g1']);
	});

	it('understands an ambiguous finesse with a self component', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g2', 'g4', 'r5', 'b4'],
			['r1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: 5,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');
		takeTurn(game, 'Cathy discards p3', 'r1');

		// Alice's slot 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
	});

	it('passes back a layered ambiguous finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'g2', 'g4', 'r5'],
			['g3', 'y4', 'p4', 'y3'],
			['r1', 'r2', 'b4', 'p3']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Bob');
		takeTurn(game, 'Donald discards p3', 'b3');

		// Alice should pass back, making her slot 1 not finessed and Donald's slots 2 and 3 (used to be slots 1 and 2) finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
		assert.ok([1,2].every(index => game.common.thoughts[game.state.hands[PLAYER.DONALD][index].order].finessed));
	});

	it('understands an ambiguous finesse pass-back', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b1', 'b5', 'r3', 'y5'],
			['r4', 'g2', 'g4', 'r5'],
			['p4', 'b4', 'y1', 'p2']
		], {
			level: 5,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Donald');	// Ambiguous finesse on us and Bob
		takeTurn(game, 'Donald clues 5 to Cathy');
		takeTurn(game, 'Alice clues 5 to Bob');			// we pass finesse to Bob
		takeTurn(game, 'Bob discards r3', 'b2');		// Bob passes back

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['b1']);
	});

	it('prefers hidden prompt over ambiguous', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'b2', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g2', 'y2', 'g5', 'b2']
		], {
			level: 5,
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Donald');
		takeTurn(game, 'Cathy clues 4 to Bob');	// connecting on g2 (Donald, prompt) and g3 (Bob, finesse)

		// Bob's slot 1 can be either g3 or y3, since he doesn't know which 1 is connecting.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0].order], ['y3', 'g3']);
	});

	it('correctly counts playables for ambiguous finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'g3', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['b2', 'b4', 'y5', 'y2', 'g2'],
		], { level: 5 });

		const clue = { type: CLUE.COLOUR, target: PLAYER.DONALD, value: COLOUR.GREEN };
		const list = game.state.hands[PLAYER.DONALD].clueTouched(clue, game.state.variant).map(c => c.order);
		const hypo_state = game.simulate_clue({ type: 'clue', giver: PLAYER.ALICE, target: PLAYER.DONALD, list, clue });
		const { playables } = get_result(game, hypo_state, clue, PLAYER.ALICE);

		// There should be 2 playables: g1 (Bob) and g2 (Donald).
		assert.equal(playables.length, 2);
	});
});
