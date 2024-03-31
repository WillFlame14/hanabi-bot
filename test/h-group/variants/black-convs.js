import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

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
			level: 1,
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
			level: 1,
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
			level: 1,
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		takeTurn(game, 'Bob clues black to Alice (slot 5)');

		assert.ok(!game.common.thoughts[0].inferred.has(expandShortCard('k2')));
		assert.ok(!game.common.thoughts[0].inferred.has(expandShortCard('k5')));
	});

	it('understands not k2/5 save with black if not filling in', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: 1,
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.BLACK
		});

		game.state.hands[PLAYER.ALICE][0].clued = true;
		game.state.hands[PLAYER.ALICE][0].clues.push({ type: CLUE.COLOUR, value: 4, giver: PLAYER.BOB });

		takeTurn(game, 'Bob clues black to Alice (slot 1,5)');

		assert.ok(!game.common.thoughts[0].inferred.has(expandShortCard('k2')));
		assert.ok(!game.common.thoughts[0].inferred.has(expandShortCard('k5')));
	});
});
