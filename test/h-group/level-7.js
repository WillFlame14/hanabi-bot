import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION } from '../../src/constants.js';
import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('scream discard chop moves', () => {
	it(`performs a scream discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'r5'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = await take_action(game);

		// Alice should discard slot 4 as a SDCM.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });

		takeTurn(game, 'Alice discards y3 (slot 4)');

		// Bob's slot 5 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].chop_moved, true);
	});

	it(`only scream discards if critical`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'y2'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = await take_action(game);

		// Alice should play as y2 is not critical or playable.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
	});

	it(`scream discards if playable`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'y2'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 1,
			play_stacks: [0, 1, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = await take_action(game);

		// Alice should discard slot 4 to SDCM as y2 is playable.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });

	});

	it(`stalls after a scream discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r2', 'g4', 'b4', 'b3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 0
		});

		takeTurn(game, 'Alice discards r1 (slot 5)');	// End early game
		takeTurn(game, 'Bob clues green to Cathy');
		takeTurn(game, 'Cathy discards p3', 'p4');

		const action = await take_action(game);

		// Alice should 5 Stall on Bob.
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 5 });
	});

	it(`performs a scream discard at 1 clue when the next player will become locked`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'y5', 'g5', 'b5', 'r5'],
			['g3', 'b3', 'y2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 3,
			discarded: ['r4'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Alice (slot 1)');
		takeTurn(game, 'Cathy clues 5 to Bob');

		const action = await take_action(game);

		// Alice should discard slot 5 as a SDCM.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][4] });

		takeTurn(game, 'Alice discards y3 (slot 5)');

		// Bob's slot 1 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].chop_moved, true);
	});
});

describe('shout discard chop moves', () => {
	it(`performs a shout discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'p1', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 2,
			play_stacks: [1, 1, 1, 1, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 1 to Alice (slots 4,5)');

		const action = await take_action(game);

		// Alice should discard slot 4 as a Shout Discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });

		takeTurn(game, 'Alice discards p1 (slot 4)');

		// Bob's slot 5 should be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].chop_moved, true);
	});

	it(`stalls after a shout discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'g4', 'b4', 'b3'],
			['g1', 'p1', 'r4', 'y3', 'p3']
		], {
			level: { min: 7 },
			clue_tokens: 2,
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Alice discards r1 (slot 5)');	// End early game
		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy discards p1', 'p4');

		const action = await take_action(game);

		// Alice should 5 Stall on Bob.
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 5 });
	});
});

describe('generation discards', () => {
	it(`performs a gen discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'p2'],
			['g1', 'b3', 'r2', 'y3', 'r5']
		], {
			level: { min: 7 },
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = await take_action(game);

		// Alice should discard slot 4 to generate for Cathy.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });
	});

	it(`doesn't mistake a gen discard for a sdcm`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'p2'],
			['g1', 'b3', 'r2', 'y3', 'r5']
		], {
			level: { min: 7 },
			clue_tokens: 1,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slot 5)');

		const action = await take_action(game);

		// Alice should discard slot 4 to generate for Cathy.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });

		// Bob's slot 5 should not be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].chop_moved, false);
	});

	it(`interprets generation over sdcm`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'r1'],
			['g1', 'b3', 'r2', 'y3', 'p5']
		], {
			level: { min: 7 },
			clue_tokens: 1
		});

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob discards b4', 'g3');		// Could be scream or generation

		assert.equal(game.state.screamed_at, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][4]].chop_moved, true);

		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');

		// Alice now knows that it was a generation discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][4]].chop_moved, false);
	});

	it(`doesn't perform a gen discard if they can connect`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'b4', 'r1'],
			['r3', 'b3', 'r5', 'y3', 'b1']
		], {
			level: { min: 7 },
			clue_tokens: 2,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays r2 (slot 5)');
		takeTurn(game, 'Bob clues red to Cathy');
		takeTurn(game, 'Cathy plays r3', 'p4');

		const action = await take_action(game);

		// Alice should play slot 5 (r4 -> r5) rather than generating for Cathy.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
	});
});
