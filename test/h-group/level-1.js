import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ACTION, CLUE } from '../../src/constants.js';
import { COLOUR, PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { early_game_clue } from '../../src/conventions/h-group/urgent-actions.js';
import { clue_safe } from '../../src/conventions/h-group/clue-finder/clue-safe.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';
import { produce } from '../../src/StateProxy.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('save clue', () => {
	it('prefers play over save with >1 clues', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b1', 'r2', 'r3', 'g5'],
			['g3', 'p1', 'b3', 'b4', 'b5']
		], {
			level: { min: 1 },
			play_stacks: [1, 5, 1, 0, 5],
			clue_tokens: 2,
			init: (game) => {
				const { state } = game;

				// Bob's last 3 cards are clued.
				for (const index of [2,3,4]) {
					const order = state.hands[PLAYER.BOB][index];
					state.deck = state.deck.with(order, produce(state.deck[order], (draft) => { draft.clued = true; }));
					for (const player of game.allPlayers)
						player.updateThoughts(order, (draft) => { draft.clued = true; });

				}

				// Cathy's last 2 cards are clued.
				for (const index of [3,4]) {
					const order = state.hands[PLAYER.CATHY][index];
					state.deck = state.deck.with(order, produce(state.deck[order], (draft) => { draft.clued = true; }));
					for (const player of game.allPlayers)
						player.updateThoughts(order, (draft) => { draft.clued = true; });

				}
			}
		});

		const action = await take_action(game);

		// Alice should give green to Cathy to finesse over save
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN }, `Expected (green to Cathy) but got ${logPerformAction(action)}`);
	});

	it('prefers touching less cards to save critical cards', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'g5', 'p2', 'p4', 'g4']
		], {
			level: { min: 1 },
			discarded: ['g4'],
			init: (game) => {
				const { state } = game;

				// Bob's p2 is clued.
				const order = state.hands[PLAYER.BOB][2];
				state.deck = state.deck.with(order, produce(state.deck[order], (draft) => { draft.clued = true; }));
			}
		});

		const action = await take_action(game);

		// Alice should give green to Bob instead of 4
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN });
	});

	it('generates correct inferences for a 2 Save', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'b2', 'y4'],
			['g5', 'b2', 'g2', 'y2'],
			['y3', 'g2', 'y1', 'b3']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');

		const { common, state } = game;

		// From the common perspective, the saved 2 can be any 2.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.CATHY][3]], ['r2', 'y2', 'g2', 'b2', 'p2']);
	});

	it('does not finesse from a 2 Save', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2'],
			['g5', 'b4', 'g1', 'y2', 'b3']
		], {
			level: { min: 1 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 2 to Bob');

		const { common, state } = game;

		// Our slot 1 should not only be y1.
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0]].inferred.length > 1, true);
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0]].finessed, false);
	});

	it('does not give 2 Saves when a duplicate is visible', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2'],
			['g5', 'b4', 'g1', 'y2', 'b3']
		], {
			level: { min: 1 },
			clue_tokens: 7
		});

		const { save_clues } = find_clues(game);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('prefers giving saves that fill in plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g2', 'p5', 'r2', 'y2'],
			['p3', 'g3', 'p2', 'p1', 'b4']
		], { level: { min: 1 } });

		takeTurn(game, 'Alice clues red to Bob');				// getting r1, touching r2
		takeTurn(game, 'Bob plays r1', 'b3');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');		// 5 Save

		const { save_clues } = find_clues(game);

		// We should save with 2 since it reveals r2 playable.
		ExAsserts.objHasProperties(save_clues[PLAYER.BOB], { type: CLUE.RANK, value: 2 });
	});

	it('does not give unsafe saves', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g2', 'y2', 'r1', 'p5'],
			['p3', 'g3', 'p2', 'b5', 'p1']
		], {
			level: { min: 1 },
			play_stacks: [3, 3, 3, 3, 3],
			starting: PLAYER.CATHY,
			clue_tokens: 0
		});

		takeTurn(game, 'Cathy discards p1', 'b1');

		// 5 to Bob is unsafe.
		const clue = { type: CLUE.RANK, value: 5, target: PLAYER.BOB };
		assert.equal(clue_safe(game, game.me, clue).safe, false);

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});

	it('sets up double saves', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g4', 'y2', 'r1', 'p4'],
			['p2', 'g3', 'p3', 'r4', 'b5']
		], {
			level: { min: 1 },
			discarded: ['r4'],
			starting: PLAYER.CATHY,
			clue_tokens: 3
		});

		takeTurn(game, 'Cathy clues green to Alice (slot 1)');

		// We should clue 5 to Cathy to set up the double save.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.CATHY, value: 5 });
	});
});

describe('early game', () => {
	it(`doesn't try to save in early game when clues are available`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r2', 'r4', 'p4', 'y2'],
			['r3', 'b4', 'r1', 'y4', 'b3'],
		], {
			level: { min: 1 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Alice (slot 2)');

		// Bob can clue Cathy's r1.
		assert.equal(early_game_clue(game, PLAYER.BOB), true);
	});

	it(`doesn't try to save in early game when duplicated clues are available`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g4', 'r2', 'r4', 'b4'],
			['r1', 'b4', 'y4', 'r1'],
			['y2', 'b3', 'b3', 'r1']
		], {
			level: { min: 11 },
			clue_tokens: 7,
			variant: VARIANTS.BLACK		// Necessary so that cluing (potential) k1 is treated as a save clue
		});

		// Bob can must clue at least one r1.
		assert.equal(early_game_clue(game, PLAYER.BOB), true);
	});

	it(`saves double chop 2s in early game`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g4', 'r5', 'r4', 'b4'],
			['r3', 'b4', 'y4', 'r2'],
			['y2', 'b3', 'b3', 'r2']
		], {
			level: { min: 11 },
			clue_tokens: 7
		});

		// Bob can must clue at least one r1.
		assert.equal(early_game_clue(game, PLAYER.ALICE), true);

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, value: 2 });
	});
});

describe('sacrifice discards', () => {
	it('discards a non-critical card when locked with no clues', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r2', 'r4', 'p4', 'b3'],
			['r3', 'b4', 'r2', 'y4', 'y2'],
		], {
			level: { min: 1 },
			discarded: ['r4'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 5 to Alice (slots 1,3,5)');
		takeTurn(game, 'Cathy clues 4 to Alice (slots 2,4)');

		const { common, state } = game;

		// Alice should discard slot 2.
		assert.equal(common.lockedDiscard(state, state.hands[PLAYER.ALICE]), 3);
	});

	it('discards the farthest critical card when locked with crits', () => {
		const game = setup(HGroup, [
			['r4', 'b4', 'r5', 'b2', 'y5'],
		], {
			level: { min: 1 },
			play_stacks: [2, 1, 0, 0, 0],
			discarded: ['r4', 'b2', 'b4']
		});
		const { common, state } = game;

		// Alice knows all of her cards (all crit).
		['r4', 'b4', 'r5', 'b2', 'y5'].forEach((short, index) => {
			const order = state.hands[PLAYER.ALICE][index];
			const card = common.thoughts[order];
			common.updateThoughts(state.hands[PLAYER.ALICE][index], (draft) => {
				draft.inferred = card.inferred.intersect(expandShortCard(short));
			});
		});

		// Alice should discard y5.
		assert.equal(common.lockedDiscard(state, state.hands[PLAYER.ALICE]), 0);
	});
});

describe('strategy', async () => {
	it('does not give clues that may be better given by someone else', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g3', 'y3', 'b4'],
			['p5', 'g3', 'p4', 'p3'],
			['r3', 'p4', 'b3', 'y4']
		], {
			level: { min: 1 },
			play_stacks: [0, 1, 1, 1, 1],
			starting: PLAYER.DONALD,
			clue_tokens: 0
		});
		takeTurn(game, 'Donald discards y4', 'r1');

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});
});
