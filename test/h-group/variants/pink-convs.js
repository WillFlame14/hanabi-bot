import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../../extra-asserts.js';

import { PLAYER, VARIANTS, setup, takeTurn } from '../../test-utils.js';
import { ACTION, CLUE } from '../../../src/constants.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('pink promise', () => {
	it('interprets pink promise on a play clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 2 },
			play_stacks: [2, 0, 0, 0, 0],
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Bob clues 3 to Alice (slot 5)');

		// This should be known r3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order], ['r3']);
	});

	it('gives play clues with pink promise', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['i1', 'b1', 'r2', 'r3', 'g5'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		const { play_clues } = find_clues(game);

		// No rank clue should be a valid play clue except 1.
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value !== 1));
	});
});

describe('pink 1s assumption', () => {
	it('plays with pink 1s assumption', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['i1', 'b1', 'r2', 'r3', 'g4'],
		], {
			level: { min: 1 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays r1 (slot 5)');
		takeTurn(game, 'Bob discards g4', 'g5');

		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);
		assert.ok(playables.some(p => p.order === game.state.hands[PLAYER.ALICE][4].order));
	});

	it('fixes a pink 1s assumption with pink fix promise', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'i4', 'i1', 'r3', 'g4'],
		], {
			level: { min: 3 },
			clue_tokens: 7,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays i1', 'b4');

		const { fix_clues } = find_clues(game);
		assert.ok(fix_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 4));

		takeTurn(game, 'Alice clues 4 to Bob');

		// Bob's slot 3 is promised to be i4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][2].order], ['i4']);
	});

	it('fixes a pink 1s assumption without pink fix promise', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'i3', 'i1', 'r3', 'g5'],
		], {
			level: { min: 3 },
			clue_tokens: 7,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays i1', 'b4');
		takeTurn(game, 'Alice clues 5 to Bob');

		// Bob's slot 3 is not promised to be i5.
		assert.ok(game.common.thoughts[game.state.hands[PLAYER.BOB][2].order].inferred.length > 1);
	});

	it(`doesn't perform OCMs in pink`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'i3', 'i2', 'r1', 'g3'],
		], {
			level: { min: 4 },
			clue_tokens: 7,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 4,5)');

		// Alice must play slot 5 (not allowed to OCM by playing slot 4).
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4].order });
	});
});

describe('pink prompts', () => {
	it('prompts leftmost correctly when rank matches', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'i3', 'i1', 'r4', 'g5'],
			['g4', 'y3', 'r2', 'b3', 'b1']
		], {
			level: { min: 3 },
			clue_tokens: 7,
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 3,4,5)');
		takeTurn(game, 'Cathy clues red to Bob');

		// Alice should prompt slot 3 as r2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order], ['r2']);
	});

	it('finesses when rank mismatches', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'y3', 'r1', 'r4', 'g5'],
			['g4', 'i3', 'r2', 'b3', 'b1']
		], {
			level: { min: 3 },
			clue_tokens: 7,
			play_stacks: [0, 0, 0, 0, 1],
			starting: PLAYER.CATHY,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Cathy clues 5 to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice discards g4 (slot 2)');
		takeTurn(game, 'Bob clues pink to Cathy');

		// Alice should finesse slot 1 as i2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order], ['i2']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, true);
	});
});

describe('pink choice tempo clues', () => {
	it('gives a pink choice tempo clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'y3', 'r2', 'b3', 'b1'],
			['r1', 'i1', 'i3', 'i2', 'g5']
		], {
			level: { min: 6 },
			clue_tokens: 7,
			starting: PLAYER.BOB,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Bob clues pink to Cathy');
		takeTurn(game, 'Cathy plays i1', 'b2');

		// 4 to Cathy is a valid pink choice tempo clue.
		const { play_clues } = find_clues(game);
		assert.ok(play_clues[PLAYER.CATHY].some(clue => clue.type === CLUE.RANK && clue.value === 4));
	});

	it('understands a pink choice tempo clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'y3', 'r2', 'b3', 'b1'],
			['r3', 'b1', 'b3', 'b2', 'g5']
		], {
			level: { min: 6 },
			clue_tokens: 7,
			starting: PLAYER.CATHY,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Cathy clues 5 to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice clues blue to Bob');
		takeTurn(game, 'Bob clues 4 to Alice (slots 3,4,5)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['i1']);

		// Alice is not TCCM'd.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].chop_moved, false);
	});

	it('understands a pink choice finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'y3', 'r2', 'b3', 'b1'],
			['i1', 'b1', 'b3', 'b2', 'g5']
		], {
			level: { min: 6 },
			clue_tokens: 7,
			starting: PLAYER.CATHY,
			variant: VARIANTS.PINK
		});

		takeTurn(game, 'Cathy clues 5 to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice clues blue to Bob');
		takeTurn(game, 'Bob clues 4 to Alice (slots 3,4,5)');

		// Cathy might be finessed for i1.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['i2']);

		takeTurn(game, 'Cathy clues green to Alice (slot 1)');

		// Alice knows that she only has i1, and she is not TCCM'd.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['i1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].chop_moved, false);
	});
});
