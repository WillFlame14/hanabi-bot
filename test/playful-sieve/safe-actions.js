import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';
import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('direct rank playables', () => {
	it('prefers to give direct ranks', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g1', 'b1', 'g3', 'g4']
		]);

		const action = take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, value: 1 });
	});

	it('understands direct ranks are not referential', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 2,3)');

		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][3].order].called_to_discard, false);
	});

	it('eliminates direct ranks from focus', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(state, 'Bob clues 1 to Alice (slots 2,3)');

		assert.equal(state.common.thoughts[state.hands[PLAYER.ALICE][3].order].called_to_discard, false);
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][1].order], ['g1']);

		// Alice's slot 3 should be trash
		const trash = state.common.thinksTrash(state, PLAYER.ALICE);
		assert.ok(trash.some(c => c.order === state.hands[PLAYER.ALICE][2].order));
	});

	it('understands playable fill-ins are not referential', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(state, 'Bob clues red to Alice (slots 2,3)');
		takeTurn(state, 'Alice plays b1 (slot 4)');

		// Bob reveals r2 as a safe action.
		takeTurn(state, 'Bob clues 2 to Alice (slots 1,4)');

		// Alice's slot 2 should not be called to discard.
		const slot2 = state.common.thoughts[state.hands[PLAYER.ALICE][1].order];
		assert.equal(slot2.called_to_discard, false);
	});
});

describe('connecting cards', () => {
	it('plays connections to cm cards', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'y4', 'g3', 'r4', 'r4']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(state, 'Bob clues green to Alice (slot 1)');
		takeTurn(state, 'Alice plays b1 (slot 2)');
		takeTurn(state, 'Bob clues 2 to Alice (slot 2)');
		takeTurn(state, 'Alice discards r1 (slot 1)');
		// Alice now has known g2.

		takeTurn(state, 'Bob plays g1', 'r2');
		takeTurn(state, 'Alice clues 3 to Bob');
		takeTurn(state, 'Bob discards r4', 'b1');
		takeTurn(state, 'Alice clues green to Bob');
		takeTurn(state, 'Bob discards b1', 'r5');
		// Bob now has known g3.

		// Alice should play g2 to automatically cm r5.
		const action = take_action(state);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: state.hands[PLAYER.ALICE][1].order }, logPerformAction(action));
	});
});
