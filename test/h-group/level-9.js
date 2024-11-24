import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('stalling', () => {
	it('understands a play clue when there are better clues available', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3'],
			['y5', 'r5', 'b5', 'g5']
		], {
			level: { min: 9 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues purple to Alice (slot 4)');

		// Can't be a locked hand stall, because getting b1 is available.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['p1']);
	});

	it('understands a finesse when there are better clues available', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b1', 'g4', 'b4', 'g2'],
			['y4', 'y4', 'r4', 'r3'],
			['y5', 'r5', 'b5', 'g5']
		], {
			level: { min: 9 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues green to Bob');

		// Can't be a locked hand stall, because getting b1 is available.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['g1']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it('understands a finesse when there are better clues available 2', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g4', 'g2', 'b4'],
			['y4', 'y4', 'r4', 'p5'],
			['y5', 'r5', 'b5', 'g5']
		], {
			level: { min: 9 },
			play_stacks: [2, 0, 0, 0, 0],
			discarded: ['r4'],
		});

		takeTurn(game, 'Alice clues 5 to Cathy');
		takeTurn(game, 'Bob clues red to Cathy');	// r4 save
		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues red to Cathy');

		// Can't be a hard burn, because filling in p5 is available.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r3']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it('understands a play clue when not in stalling situation', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'r2', 'b4', 'g4'],
			['y4', 'y4', 'r4', 'r3'],
			['y5', 'r5', 'b5', 'g5']
		], {
			level: { min: 9 },
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 5 to Donald');
		takeTurn(game, 'Cathy clues red to Donald');
		takeTurn(game, 'Donald clues green to Alice (slot 4)');

		// Can't be a locked hand stall, because Donald has a play.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['g1']);
	});

	it('correctly finds all clues in stalling situations', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'r4', 'b2', 'b2', 'r1'],
			['y4', 'y4', 'r4', 'r3', 'g2']
		], { level: { min: 9 } });

		takeTurn(game, 'Alice clues 2 to Cathy');
		takeTurn(game, 'Bob clues 5 to Alice (slots 1,2,3,4,5)');
		takeTurn(game, 'Cathy clues red to Bob');

		const { stall_clues } = find_clues(game);

		// 3,4 to Bob are both valid Fill-In Clues
		assert.ok(stall_clues[2].some(clue => clue.target === PLAYER.BOB && clue.type === CLUE.RANK && clue.value === 3));
		assert.ok(stall_clues[2].some(clue => clue.target === PLAYER.BOB && clue.type === CLUE.RANK && clue.value === 4));

		// 3 to Cathy is also a valid Locked Hand Stall.
		assert.ok(stall_clues[3].some(clue => clue.target === PLAYER.CATHY && clue.type === CLUE.RANK && clue.value === 3));

		// However, 2 to Cathy is not a valid Hard Burn (Cathy will play as r2).
		assert.ok(!stall_clues[3].some(clue => clue.target === PLAYER.CATHY && clue.type === CLUE.RANK && clue.value === 2));
	});

	it('gives a bad touch save clue in stalling situations', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r4', 'b3', 'r2', 'p2'],
			['y5', 'y4', 'r4', 'g2', 'r3']
		], {
			level: { min: 9 },
			starting: PLAYER.BOB,
			play_stacks: [2, 2, 2, 0, 0],
			clue_tokens: 4
		});

		takeTurn(game, 'Bob clues 5 to Cathy');			// 5 Stall
		takeTurn(game, 'Cathy discards r3', 'p4');

		// Alice is in DDA, she should clue 2 to Bob even though it bad touches.
		const action = await take_action(game);

		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 2});
	});
});

describe('anxiety plays', () => {
	it('plays into anxiety', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y5', 'y2', 'b4', 'g4'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [4, 0, 0, 0, 0],
			clue_tokens: 2,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Alice (slots 2,3,4)');
		takeTurn(game, 'Donald clues 2 to Alice (slot 1)');

		// Alice should play slot 2 as r5.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target:game.state.hands[PLAYER.ALICE][1] }, `Expected (play slot 2), got ${logPerformAction(action)} instead`);
	});

	it(`doesn't assume anxiety if there are clues available`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y5', 'y2', 'b4', 'g4'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 5 to Alice (slots 1,2,3,4)');

		// Alice should clue instead of playing/discarding.
		const action = await take_action(game);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});

	it(`doesn't play into impossible anxiety`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'y2', 'b4', 'g4'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [4, 0, 0, 0, 0],
			clue_tokens: 1,
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 5 to Alice (slots 1,2,3,4)');

		// Alice should discard, since it isn't possible to play any card.
		const action = await take_action(game);
		assert.ok(action.type === ACTION.DISCARD, `Expected discard, got ${logPerformAction(action)} instead`);
	});

	it('forces the next player into anxiety', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'y5', 'b5', 'g5'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [3, 0, 0, 0, 0],
			clue_tokens: 2,
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Bob');
		takeTurn(game, 'Donald clues red to Alice (slot 1)');

		// Alice should play slot 1 as r4.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][0] });
	});

	/*it('gives an anxiety clue to the next player', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'y5', 'b5', 'g5'],
			['b1', 'g4', 'b4', 'b1'],
			['y4', 'y4', 'p4', 'p3']
		], {
			level: { min: 9 },
			play_stacks: [2, 0, 0, 0, 0],
			discarded: ['r3', 'r4', 'b3'],
			clue_tokens: 2,
			starting: PLAYER.CATHY,
			init: (game) => {
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy clues 5 to Bob');
		takeTurn(game, 'Donald clues green to Alice (slot 1)');

		// Alice should clue red/3 to Bob as anxiety.
		const action = await take_action(game);
		const { type, target, value } = action;
		assert.ok((type === ACTION.COLOUR && target === PLAYER.BOB && value === COLOUR.RED) ||
			(type === ACTION.RANK && target === PLAYER.BOB && value === 3), `Expected (3/red to Bob), got ${logPerformAction(action)}`);
	});*/
});

describe('double discard avoidance', async () => {
	it(`understands a clue from a player on double discard avoidance may be a stall`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y5', 'y5', 'b4', 'g4'],
			['b1', 'g4', 'b4', 'b2'],
			['y4', 'y4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [2, 2, 2, 2, 2],
			starting: PLAYER.DONALD
		});
		const { state } = game;
		takeTurn(game, 'Donald discards r3', 'p4'); // Ends early game

		// A discard of a useful card means Alice is in a DDA situation.
		ExAsserts.objHasProperties(game.state.dda, {suitIndex: COLOUR.RED, rank: 3});
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, target: PLAYER.BOB, value: 5 });
		takeTurn(game, 'Alice clues 5 to Bob');

		// No one should be finessed by this as Alice was simply stalling.
		const finessed = state.hands.filter(hand => hand.some(o => game.common.thoughts[o].finessed));
		assert.equal(finessed.length, 0);
		assert.equal(game.common.waiting_connections.length, 0);
	});

	it(`will discard while on double discard avoidance if it can see the card`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'y5', 'b2', 'g4'],
			['b3', 'b5', 'b4', 'b2'],
			['y4', 'b4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.DONALD,
			clue_tokens: 0
		});
		const { state } = game;
		takeTurn(game, 'Donald discards r3', 'p3'); // Ends early game

		// A discard of a useful card means common knowledge is Alice is in a DDA situation.
		ExAsserts.objHasProperties(state.dda, {suitIndex: COLOUR.RED, rank: 3});

		// However, since Alice can see the other r3, Alice can discard.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: state.hands[PLAYER.ALICE][3] });
	});

	it(`will give a fill-in clue on double discard avoidance`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r4', 'y4', 'b3', 'g2'],
			['b3', 'g2', 'b4', 'b5'],
			['y4', 'b4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});
		const { state } = game;
		takeTurn(game, 'Bob clues 5 to Cathy');
		takeTurn(game, 'Cathy clues 2 to Bob');
		takeTurn(game, 'Donald discards r3', 'p3'); // Ends early game

		// A discard of a useful card means common knowledge is Alice is in a DDA situation.
		ExAsserts.objHasProperties(state.dda, {suitIndex: COLOUR.RED, rank: 3});

		// Alice gives a fill-in clue as the highest priority stall clue.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN });
		takeTurn(game, 'Alice clues green to Bob');

		// No one should be finessed by this as Alice was simply stalling.
		const finessed = state.hands.filter(hand => hand.some(o => game.common.thoughts[o].finessed));
		assert.equal(finessed.length, 0);
		assert.equal(game.common.waiting_connections.length, 0);
	});

	it(`doesn't treat a sarcastic discard as triggering DDA`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'y5', 'b2', 'g4'],
			['b3', 'b1', 'g1', 'b3'],
			['b1', 'b4', 'r4', 'r3']
		], {
			level: { min: 9 },
			play_stacks: [0, 0, 0, 0, 0],
			starting: PLAYER.BOB,
			clue_tokens: 0,
			discarded: ['b1']
		});
		const { state } = game;
		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy clues blue to Donald');
		takeTurn(game, 'Donald discards b1', 'p3'); // Ends early game

		// The sarcastic discard doesn't trigger dda.
		assert.equal(state.dda, undefined);
	});

});
