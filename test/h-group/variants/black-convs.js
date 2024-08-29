import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../../extra-asserts.js';

import { PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';
import { CLUE } from '../../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue interpretation', () => {
	it('understands k2/5 save with black for multiple touches', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues black to Alice (slots 1,5)');

		assert.ok(['k2', 'k5'].every(id =>
			game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});

	it('understands k2/5 save with black for filling in', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues 3 to Alice (slots 1,3)');
		takeTurn(game, 'Alice plays r3 (slot 1)');
		takeTurn(game, 'Bob clues black to Alice (slots 3,5)');

		assert.ok(['k2', 'k5'].every(id =>
			game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});

	it('understands not k2/5 save with black if not multiple touches', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues black to Alice (slot 5)');

		assert.ok(['k2', 'k5'].every(id =>
			!game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});

	it('understands not k2/5 save with black if not filling in', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		game.state.hands[PLAYER.ALICE][0].clued = true;
		game.state.hands[PLAYER.ALICE][0].clues.push({ type: CLUE.COLOUR, value: 4, giver: PLAYER.BOB, turn: -1 });

		takeTurn(game, 'Bob clues black to Alice (slot 1,5)');

		assert.ok(['k2', 'k5'].every(id =>
			!game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].inferred.has(expandShortCard(id))));
	});

	it('understands k2 save to avoid bad touch', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'g4', 'g1', 'b2', 'k2'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		], {
			level: { min: 1 },
			clue_tokens: 7,
			play_stacks: [0, 0, 0, 4, 0],
			starting: PLAYER.CATHY,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Cathy clues black to Bob');

		// Alice should not be finessed for k1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
	});

	it('finesses when k2 is saved with black without exceptions', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'g4', 'g1', 'b2', 'k2'],
			['g2', 'b1', 'r2', 'r3', 'g5']
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.CATHY,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Cathy clues black to Bob');

		// Alice should be finessed for k1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['k1']);
	});
});
