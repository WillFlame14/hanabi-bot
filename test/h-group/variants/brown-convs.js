import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ACTION } from '../../../src/constants.js';
import { COLOUR, PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands n2/5 save with brown', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			starting: PLAYER.BOB,
			variant: VARIANTS.BROWN
		});

		takeTurn(game, 'Bob clues brown to Alice (slot 5)');

		assert.ok(['n2', 'n5'].every(id =>
			game.common.thoughts[game.state.hands[PLAYER.ALICE][4]].inferred.has(expandShortCard(id))));
	});

	it('will save n5 with brown', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b2', 'r2', 'r3', 'n5'],
		], {
			level: { min: 1 },
			clue_tokens: 5,
			variant: VARIANTS.BROWN
		});

		const action = await take_action(game);

		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.PURPLE });
	});
});

describe('focus connections', () => {
	it('plays the correct card after a delayed play clue', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'n5'],
			['g4', 'n1', 'b3', 'g4', 'y3']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB,
			play_stacks: [0, 0, 0, 0, 3],
			variant: VARIANTS.BROWN
		});

		takeTurn(game, 'Bob clues brown to Alice (slot 2,4,5)');
		takeTurn(game, 'Cathy clues brown to Bob');

		const action = await take_action(game);

		// Alice should play slot 5.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]], ['n4']);
	});

	it('plays the correct card after a finesse', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['n5', 'b1', 'r2', 'r3'],
			['g3', 'y3', 'r1', 'n1'],
			['n3', 'y1', 'b3', 'g4']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB,
			play_stacks: [0, 0, 0, 0, 2],
			discarded: ['n3'],
			variant: VARIANTS.BROWN
		});

		takeTurn(game, 'Bob clues brown to Alice (slot 2,3,4)');
		takeTurn(game, 'Cathy clues brown to Bob');
		takeTurn(game, 'Donald plays n3', 'y2');

		const action = await take_action(game);

		// Alice should play slot 4.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][3] });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['n4']);
	});
});

describe('brown tempo clues', () => {
	it('understands a brown tempo clue', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'n5'],
			['g4', 'n1', 'b3', 'g4', 'y3']
		], {
			level: { min: 1 },
			starting: PLAYER.CATHY,
			variant: VARIANTS.BROWN
		});

		takeTurn(game, 'Cathy clues brown to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice clues brown to Bob');
		takeTurn(game, 'Bob clues brown to Alice (slot 3,4,5)');

		takeTurn(game, 'Cathy clues blue to Bob');

		const action = await take_action(game);

		// Alice should play slot 5.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4] });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]], ['n1']);

		// Slot 2 should not be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].chop_moved, false);
	});
});
