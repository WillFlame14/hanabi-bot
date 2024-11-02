import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PLAYER, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import { ACTION } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import logger from '../../src/tools/logger.js';

import { order_1s } from '../../src/conventions/h-group/action-helper.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('playing 1s in the correct order', () => {
	it('plays 1s from right to left', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: { min: 3 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 3,4)');

		const { common, state } = game;
		const ordered_1s = order_1s(state, common, state.hands[PLAYER.ALICE]);
		assert.deepEqual(ordered_1s, [1, 2]);
	});

	it('plays fresh 1s', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], { level: { min: 3 } });

		// Slot 1 is a new card
		takeTurn(game, 'Alice bombs b5 (slot 1)');
		takeTurn(game, 'Bob clues 1 to Alice (slots 1,4)');

		const { common, state } = game;
		const ordered_1s = order_1s(state, common, state.hands[PLAYER.ALICE]);
		assert.deepEqual(ordered_1s, [10, 1]);
	});

	it('plays chop focus', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], { level: { min: 3 } });

		// Slot 1 is a new card
		takeTurn(game, 'Alice bombs b5 (slot 1)');
		takeTurn(game, 'Bob clues 1 to Alice (slots 1,2,5)');

		const { common, state } = game;
		const ordered_1s = order_1s(state, common, state.hands[PLAYER.ALICE]);
		assert.deepEqual(ordered_1s, [0, 10, 3]);
	});

	it('does not prompt playable 1s', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'r2', 'g3', 'r5', 'b3'],
			['r4', 'b4', 'g4', 'y3', 'p4']
		], {
			level: { min: 3 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3)');
		takeTurn(game, 'Cathy clues red to Bob');				// getting r2

		const { common, state } = game;

		// Alice's slot 2 should still be any 1 (not prompted to be r1).
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1]], ['r1', 'y1', 'g1', 'b1', 'p1']);
	});
});

describe('sarcastic discard', () => {
	it('prefers sarcastic discard over playing', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y1', 'p4']
		], { level: { min: 3 } });

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob clues yellow to Alice (slot 5)');

		// Alice should discard slot 5 as a Sarcastic Discard.
		const action = await game.take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});

	it('understands a sarcastic discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'g4', 'y3', 'y1']
		], {
			level: { min: 3 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 4)');
		takeTurn(game, 'Alice clues yellow to Bob');		// getting y1
		takeTurn(game, 'Bob discards y1', 'r1');			// sarcastic discard

		// Alice's slot 4 should be y1 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['y1']);
	});

	it('prefers playing if that would reveal duplicate is trash in endgame', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'y5', 'y4', 'p4'],
			['g4', 'b2', 'y1', 'y2', 'p1']
		], {
			level: { min: 3 },
			play_stacks: [0, 3, 0, 0, 1],
			starting: PLAYER.CATHY
		});
		const { common, state } = game;

		// pace = currScore (4) + state.cardsLeft (18) + state.numPlayers (3) - maxScore (25) = 0
		state.cardsLeft = 18;

		// Bob's y4 is clued yellow.
		const y4 = common.thoughts[state.hands[PLAYER.BOB][3]];
		y4.inferred = y4.inferred.intersect(['y4'].map(expandShortCard));
		y4.possible = y4.possible.intersect(['y1', 'y2', 'y3', 'y4'].map(expandShortCard));
		y4.clued = true;

		// Bob's y5 is known.
		const y5 = common.thoughts[state.hands[PLAYER.BOB][2]];
		y5.inferred = y5.inferred.intersect(['y5'].map(expandShortCard));
		y5.possible = y5.possible.intersect(['y5'].map(expandShortCard));
		y5.clued = true;

		takeTurn(game, 'Cathy clues yellow to Alice (slot 5)');

		// Alice should play slot 5 instead of discarding for tempo.
		const action = await game.take_action(game);
		console.log('e?');
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 0 });
	});

	it('prefers playing when holding both copies in endgame', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'b4', 'y1', 'g4', 'p4'],
			['g4', 'b2', 'y1', 'y2', 'p1']
		], {
			level: { min: 3 },
			play_stacks: [0, 3, 0, 0, 5],
			starting: PLAYER.BOB
		});
		const { state } = game;

		// pace = currScore (8) + state.cardsLeft (14) + state.numPlayers (3) - maxScore (25) = 0
		state.cardsLeft = 14;

		takeTurn(game, 'Bob clues yellow to Alice (slots 4,5)');
		takeTurn(game, 'Cathy clues 4 to Alice (slots 4,5)');

		// Alice should play slot 4 instead of discarding for tempo.
		const action = await game.take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: 1 });
	});

	it('sarcastic discards without assuming position', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g2', 'b2', 'r4', 'p2'],
		], {
			level: { min: 7 },
			play_stacks: [1, 1, 0, 1, 0],
			clue_tokens: 6
		});

		takeTurn(game, "Alice clues 2 to Bob");
		takeTurn(game, "Bob clues blue to Alice (slot 1)");
		takeTurn(game, "Alice discards b2 (slot 1)");

		// Every 2 can still be inferred b2.
		assert.ok([1, 2, 4].every(index =>
			game.allPlayers[PLAYER.BOB].thoughts[game.state.hands[PLAYER.BOB][index]].inferred.has({ suitIndex: 3, rank:2 })));
	});
});

describe('fix clues', () => {
	it(`doesn't try to fix symmetric self-finesses connecting through self`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y2', 'g1', 'r2', 'p3'],
			['y3', 'p3', 'y4', 'r2'],
			['p4', 'r3', 'y4', 'r5']
		], {
			level: { min: 3 },
			play_stacks: [1, 1, 1, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues blue to Alice (slot 2)');		// b1
		takeTurn(game, 'Cathy clues 5 to Donald');				// 5 save
		takeTurn(game, 'Donald clues 3 to Cathy');				// y3 finesse

		const { fix_clues } = find_clues(game);

		// Alice does not need to fix y4.
		assert.equal(fix_clues[PLAYER.CATHY].length, 0);
	});
});
