import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { ACTION } from '../../../src/constants.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('queued finesse', () => {
	it('understands a queued finesse', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Cathy');		// g2 finesse on us

		// Alice's slot 1 should be [g1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['g1']);

		takeTurn(game, 'Cathy clues 2 to Bob');			// r2 finesse on us

		// Alice should play slot 1 first.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });

		takeTurn(game, 'Alice plays g1 (slot 1)');

		// Alice's slot 2 should be [r1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r1']);
	});

	it('understands a delayed queued finesse', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'g3', 'g4', 'r5', 'b4'],
			['r3', 'b3', 'r4', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues green to Bob');		// g1, g2 finesse on us
		takeTurn(game, 'Alice plays g1 (slot 1)');
		takeTurn(game, 'Bob clues red to Cathy');		// r1, r2 finesse on us

		// Alice should play slot 2 first.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][1] });

		// Alice's slots should be [r1, g2, r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r1']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['g2']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2']);
	});

	it('waits for a queued finesse to resolve', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'r2', 'y3', 'p3'],
			['g1', 'r1', 'r4', 'g4', 'b4']
		], { level: { min: 5 } });

		takeTurn(game, 'Alice clues green to Bob');			// g2 reverse finesse on Cathy
		takeTurn(game, 'Bob clues red to Alice (slot 2)');		// r2 reverse finesse on Cathy
		takeTurn(game, 'Cathy plays g1', 'b1');

		// Alice's slot 2 should still be [r1, r2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r1', 'r2']);
	});

	it('plays queued finesses in the right order', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r2', 'g4', 'r5', 'b4'],
			['g2', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 2 to Bob');		// r2 finesse
		takeTurn(game, 'Alice plays b1 (slot 1)');	// expecting r1 finesse
		takeTurn(game, 'Bob clues green to Cathy');	// g2 reverse finesse

		takeTurn(game, 'Cathy discards p3', 'y1');

		// Alice should play slot 2 first (continue digging for r1).
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][1] });
	});

	it('waits for an older unplayable finesse to resolve before playing into a new finesse', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'g4', 'p5'],
			['r1', 'r2', 'r3', 'y3'],
			['b4', 'r5', 'p3', 'y2']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Donald');		// r5 finesse, we have r4
		takeTurn(game, 'Cathy plays r1', 'b1');
		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');
		takeTurn(game, 'Alice discards y4 (slot 3)');	// r4 now in slot 2

		takeTurn(game, 'Bob clues yellow to Donald');	// y2 finesse, we have y1

		// Alice cannot play y1 in slot 1, because y1 could be layered in the r4 finesse.
		const action = await take_action(game);
		assert.ok(action.type !== ACTION.PLAY);
	});

	it(`doesn't wait for older queued finesses when they can't be layered`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'g4', 'p4'],
			['r1', 'r2', 'r3', 'y3'],
			['b4', 'r5', 'p3', 'y2']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Donald');		// r5 finesse, we have r4
		takeTurn(game, 'Cathy plays r1', 'b1');
		takeTurn(game, 'Donald clues 5 to Alice (slots 3,4)');
		takeTurn(game, 'Alice discards y4 (slot 2)');	// r4 now in slot 2

		takeTurn(game, 'Bob clues yellow to Donald');	// y2 finesse, we have y1

		// Alice can play y1 in slot 1, because the queued r4 cannot be layered.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});

	it(`orders complex finesses correctly`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b5', 'r4', 'y2', 'p4'],
			['p2', 'r1', 'b3', 'g4'],
			['r3', 'b1', 'r4', 'b1']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 1)');	// g2 self-finesse
		takeTurn(game, 'Cathy clues 2 to Bob');				// adding y1 to our finesses
		takeTurn(game, 'Donald clues green to Cathy');		// adding g3 to our finesses
		takeTurn(game, 'Alice plays g1 (slot 2)');

		// Slot 3 should be y1, and slot 4 should be g3.
		const slot3 = game.common.thoughts[game.state.hands[PLAYER.ALICE][2]];
		ExAsserts.cardHasInferences(slot3, ['y1']);
		assert.equal(slot3.finessed, true);

		const slot4 = game.common.thoughts[game.state.hands[PLAYER.ALICE][3]];
		ExAsserts.cardHasInferences(slot4, ['g3']);
		assert.equal(slot4.finessed, true);

		takeTurn(game, 'Bob clues red to Cathy');
		takeTurn(game, 'Cathy plays r1', 'g1');
		takeTurn(game, 'Donald clues 5 to Bob');

		// Alice should play y1 in slot 3.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][2] });
	});
});
