import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, VARIANTS, setup, takeTurn } from '../test-utils.js';
import { ACTION, CLUE } from '../../src/constants.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { clue_safe } from '../../src/conventions/h-group/clue-finder/clue-safe.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('reverse finesse', () => {
	it('prefers play over save when saved cards could be touched', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b1', 'r2', 'r3', 'g2'],
			['b2', 'p1', 'p2', 'y4', 'b3']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY,
			clue_tokens: 0
		});

		takeTurn(game, 'Cathy discards b3', 'g1');

		const action = await take_action(game);

		// // Alice should give green to Bob to finesse over save
		ExAsserts.objHasProperties(action, { type: ACTION.COLOUR, target: PLAYER.BOB, value: COLOUR.GREEN }, `Expected (green to Bob), got ${logPerformAction(action)}`);
	});

	it('understands a continuing finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y5', 'r5', 'b1', 'p3'],
			['p4', 'b3', 'r2', 'p1'],
			['r3', 'r1', 'y4', 'p1']
		], {
			level: { min: 2 }
		});

		takeTurn(game, 'Alice clues 1 to Donald');
		takeTurn(game, 'Bob clues red to Cathy');				// r2 connection
		takeTurn(game, 'Cathy clues 4 to Alice (slots 2,3)');	// r4, finessing Donald's r3
		takeTurn(game, 'Donald clues red to Bob');				// r5

		// We don't need to finesse anything.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, false);
		assert.equal(game.common.hypo_stacks[COLOUR.RED], 5);
	});

	it('correctly recognizes bad touch on play clues that touch copies of finessed cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y5', 'r5', 'b1', 'p2'],
			['p1', 'b3', 'r2', 'p4'],
			['r3', 'p1', 'y4', 'r1']
		], {
			level: { min: 2 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues purple to Bob');	// Reverse finessing p1

		const { play_clues } = find_clues(game);

		// 1 to Donald is a valid play clue, but it bad touches one card.
		const donald_1 = play_clues[PLAYER.DONALD].find(clue => clue.type === CLUE.RANK && clue.type === 1);
		assert.ok(donald_1);
		assert.equal(donald_1.result.bad_touch.length, 1);
	});
});

describe('self-finesse', () => {
	it('does not give bad self-finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'r4', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 2 },
			play_stacks: [1, 3, 0, 1, 2],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Cathy');

		const { play_clues } = find_clues(game);

		// 3 to Bob is not a valid clue.
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});

	it('plays correctly into self-finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 2 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slot 2)');
		takeTurn(game, 'Alice plays g1 (slot 1)');

		const { common, state } = game;

		// Slot 2 should be g2.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1]], ['g2']);
	});

	it('interprets self-finesses correctly when giver knows less', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r1', 'g4', 'b1', 'g3'],
			['g1', 'g2', 'r5', 'y3', 'p3']
		], { level: { min: 2 } });

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob clues 2 to Cathy');

		const { common, state } = game;

		// Cathy's slot 1 should be finessed, Alice's slot 1 should not.
		assert.equal(common.thoughts[state.hands[PLAYER.CATHY][0]].finessed, true);
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0]].finessed, false);
	});

	it('interprets self-finesses correctly when other possibilities are impossible', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'b4', 'g4', 'p1'],
			['b2', 'b3', 'p1', 'g3'],
			['b5', 'b2', 'r4', 'p5']
		], {
			level: { min: 2 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues purple to Alice (slot 2)');	// p1 play
		takeTurn(game, 'Alice plays p1 (slot 2)');
		takeTurn(game, 'Bob clues blue to Cathy');					// b2 reverse finesse on us
		takeTurn(game, 'Cathy clues 5 to Donald');

		takeTurn(game, 'Donald clues 4 to Bob');					// connect b4
		takeTurn(game, 'Alice plays b1 (slot 1)');					// b1, p1 on stacks
		takeTurn(game, 'Bob clues 2 to Alice (slot 3)');			// 2 is neg purple, b2 is clued in Cathy's hand

		// Alice's slot 1 should be finessed.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r2','y2','g2']);
	});

	it(`doesn't give self-finesses that look like prompts`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'b4', 'g4', 'p1'],
			['b2', 'b3', 'p1', 'g3'],
			['y2', 'b2', 'r5', 'r1']
		], {
			level: { min: 2 },
			play_stacks: [0, 1, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Donald');
		takeTurn(game, 'Donald plays r1', 'y3');

		const { play_clues } = find_clues(game);

		// 3 to Donald is not a valid clue (r5 will prompt as r2).
		assert.ok(!play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.RANK && clue.value === 3));
	});

	it('gives self-finesses that cannot look like prompts', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'b3', 'g1', 'p1', 'y2'],
			['g2', 'b3', 'p1', 'g3', 'b2']
		], {
			level: { min: 2 },
			play_stacks: [2, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues 3 to Bob');
		takeTurn(game, 'Bob plays r3', 'g3');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');

		const { play_clues } = find_clues(game);

		// 3 to Bob is a valid play clue (connecting through g1 self-finesse on Bob, g2 finesse on Cathy).
		const expected_clue = play_clues[PLAYER.BOB].find(clue => clue.type === CLUE.RANK && clue.value === 3);
		assert.ok(expected_clue !== undefined);
		assert.ok(expected_clue.result.playables.length === 3);
	});

	it('maintains a self-finesse even as inferences are reduced', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y1', 'b4', 'b1', 'g1'],
			['r1', 'r3', 'r1', 'b4'],
			['y1', 'r4', 'p3', 'g1']
		], { level: { min: 2 } });

		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays y1', 'p4');
		takeTurn(game, 'Cathy clues 3 to Alice (slot 2)');

		const slot1_order = game.state.hands[PLAYER.ALICE][0];

		// All of these are valid self-finesse possibilities.
		ExAsserts.cardHasInferences(game.common.thoughts[slot1_order], ['y2', 'g2', 'b2']);
		assert.equal(game.common.thoughts[slot1_order].finessed, true);

		takeTurn(game, 'Donald clues green to Alice (slot 4)');

		// After knowing we have g2 in slot 4, the finesse should still be on.
		ExAsserts.cardHasInferences(game.common.thoughts[slot1_order], ['y2', 'b2']);
		assert.equal(game.common.thoughts[slot1_order].finessed, true);
	});

	it('prefers prompting over self-finessing', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'p4', 'g1', 'g4'],
			['p3', 'g5', 'p4', 'g2'],
			['p1', 'g2', 'p1', 'g4']
		], {
			level: { min: 2 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues yellow to Alice (slots 2,4)');
		takeTurn(game, 'Alice plays y1 (slot 4)');
		takeTurn(game, 'Bob clues purple to Alice (slot 4)');
		takeTurn(game, 'Cathy clues 3 to Alice (slot 1)');

		// y3 is the simplest possibility.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['y3']);
	});

	it(`doesn't give self-finesses that are not symmetrically the simplest interpretation`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'p3', 'r3', 'g3'],
			['p3', 'g5', 'p4', 'g2'],
			['b1', 'b2', 'p1', 'g4']
		], {
			level: { min: 2 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 2 to Cathy');

		const { play_clues } = find_clues(game);

		// 3 to Bob is not a valid clue (looks like blue 3).
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3));
	});

	it('prefers the simplest connection even when needing to self-finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'y2', 'y3', 'g4'],
			['p3', 'g5', 'p4', 'g3'],
			['p1', 'b4', 'g1', 'b2']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY,
			play_stacks: [1, 1, 1, 0, 1]
		});

		takeTurn(game, 'Cathy clues yellow to Bob');			// getting y2, touching y3
		takeTurn(game, 'Donald clues 1 to Alice (slot 3)');		// getting b1
		takeTurn(game, 'Alice clues 2 to Donald');				// 2 Save
		takeTurn(game, 'Bob plays y2', 'b1');
		takeTurn(game, 'Cathy clues 4 to Alice (slot 1)');		// y3 (prompt) -> y4 is simpler than b2 (playable) -> b3 (self-finesse) -> b4

		// y4 is the simplest possibility.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['y4']);
	});

	it('trusts the clue giver to give asymmetric self-finesses', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'r5', 'y3', 'g4'],
			['r4', 'g5', 'p4', 'g3'],
			['p1', 'b4', 'g1', 'b2']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY,
			play_stacks: [2, 0, 0, 4, 0]
		});

		takeTurn(game, 'Cathy clues 5 to Bob');		// 5 Stall
		takeTurn(game, 'Donald clues 5 to Bob');	// r3, r4, r5 finesse (but could look like g5 direct)

		// Assume Donald is not making a mistake, and we have g5. Then Bob will know to play into the finesse.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][0]], ['r3']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][0]].finessed, true);
	});

	it('correctly realizes self-finesses after symmetric possibilities are directly stomped', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'r5', 'y3', 'g4'],
			['g4', 'p1', 'g1', 'r1'],
			['r3', 'b4', 'g1', 'b2']
		], {
			level: { min: 2 },
			starting: PLAYER.BOB,
			play_stacks: [0, 1, 0, 0, 0]
		});

		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy plays r1', 'r2');
		takeTurn(game, 'Donald clues 4 to Alice (slot 3)');		// could be red (most likely), or green, or purple

		takeTurn(game, 'Alice discards y3 (slot 4)');
		takeTurn(game, 'Bob clues red to Donald');				// finessing r2, proving the earlier finesse wasn't red

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['y4', 'g4', 'p4']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].finessed, true);
	});
});

describe('direct clues', () => {
	it(`doesn't self-prompt when a clue could be direct`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g5', 'b4', 'r4', 'r5', 'g2'],
			['b2', 'y3', 'r4', 'p2', 'p3']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays b1 (slot 5)');
		takeTurn(game, 'Bob clues blue to Alice (slots 1,5)');

		const { common, state } = game;

		// Alice's slot 1 should only be [b2,b3], not [b2,b3,b4].
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][0]], ['b2', 'b3']);
	});

	it('allows finesses to look direct if someone else plays into it first', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b2', 'y4', 'r3', 'r5'],
			['g5', 'y3', 'r4', 'p2', 'r3']
		], {
			level: { min: 2 },
			play_stacks: [0, 2, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slot 2)');

		const { common, state } = game;

		// While ALice's slot 2 could be y3, it could also be g3 (reverse finesse on Bob + self-finesse).
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1]], ['y3', 'g3']);
	});

	it(`assumes direct play over a "stomped" finesse involving a self-component`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'b2', 'y4', 'r3'],
			['g5', 'y3', 'r4', 'p2'],
			['g1', 'r3', 'y2', 'b3']
		], {
			level: { min: 2 },
			play_stacks: [0, 2, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 3 to Alice (slot 4)');	// Could be direct play on y3 or finesse on g3
		takeTurn(game, 'Cathy clues green to Donald');		// "stomping" on the g3 finesse
		takeTurn(game, 'Donald plays g1', 'g4');

		// Alice should assume the simpler explanation that she doesn't have to play g2.
		const slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0]];
		assert.equal(slot1.finessed, false);
		assert.ok(slot1.inferred.length > 1);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['y3']);
	});
});

describe('asymmetric clues', () => {
	it('understands delayed play clues through asymmetrically known cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'r4', 'r5'],
			['g4', 'y3', 'r4', 'p2'],
			['g3', 'g2', 'p3', 'b3']
		], {
			level: { min: 2 },
			play_stacks: [0, 0, 0, 1, 0],	// b1 has been played. We hold a b2 in our hand.
			starting: PLAYER.CATHY
		});
		takeTurn(game, 'Cathy clues blue to Donald');	// finessing b2
		takeTurn(game, 'Donald clues 4 to Bob'); 	// Donald knows that he has b3, not b2 since he can see Bob's b2 and ours.

		// We think we have b3 in slot 1, as a Certain Finesse. 
		// ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][0]], ['b3']);

		takeTurn(game, 'Alice clues 5 to Bob');	// 5 Save
		takeTurn(game, 'Bob plays b2', 'y5');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');	// 5 Save
		takeTurn(game, 'Donald plays b3', 'r2');

		const { common, state } = game;

		// We should no longer think that we have b3 in slot 1.
		const slot1 = common.thoughts[state.hands[PLAYER.ALICE][0]];
		assert.equal(slot1.inferred.length > 1, true);
		assert.equal(slot1.finessed, false);
	});

	it('understands multiple interpretations when connecting through multiple possible cards in other hand', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b4', 'g3', 'r4'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'g5', 'y1', 'b4']
		], {
			level: { min: 2 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Donald');
		takeTurn(game, 'Cathy clues 3 to Bob');	// connecting on g1 (Donald, playable) and g2 (Bob, finesse)

		// There should be y2 -> y3 and g2 -> g3 waiting connections.
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.GREEN && wc.inference.rank === 3));
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.YELLOW && wc.inference.rank === 3));
	});

	it('prefers the least number of blind plays on target', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], {
			level: { min: 2 },
			play_stacks: [0, 1, 0, 0, 0]	// y1 is played.
		});

		takeTurn(game, 'Alice clues yellow to Donald');	// getting y2
		takeTurn(game, 'Bob clues 1 to Donald');			// getting g1
		takeTurn(game, 'Cathy clues 4 to Bob');			// connecting on y2 (Donald, known) and y3 (Bob, finesse)

		const { common, state } = game;

		// Bob's slot 1 must be y3, since it only requires one blind play (y3) instead of two (g2,g3).
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.BOB][0]], ['y3']);
	});

	it('prefers not starting with self, even if there are known playables before', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g1', 'y3', 'r4', 'p2'],
			['g2', 'p4', 'y5', 'b4']
		], {
			level: { min: 2 },
			play_stacks: [0, 2, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues green to Donald');
		takeTurn(game, 'Bob clues 4 to Alice (slot 2)');

		const { common, state } = game;

		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.ALICE][1]], ['y4']);

		// Alice's slot 1 should not be finessed.
		assert.equal(common.thoughts[state.hands[PLAYER.ALICE][0]].finessed, false);
	});

	it('prefers not starting with self (symmetrically), even if there are known playables before', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'y2', 'r4', 'p2'],
			['g5', 'p4', 'y5', 'y3'],
			['b2', 'b2', 'y4', 'r3']
		], {
			level: { min: 2 },
			play_stacks: [0, 2, 1, 0, 0],
			discarded: ['r3', 'y3'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 3 to Cathy');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');
		takeTurn(game, 'Donald clues green to Bob');
		takeTurn(game, 'Alice clues 4 to Donald');

		const { common, state } = game;

		// g4 (g2 known -> g3 finesse, self) requires a self-component, compared to y3 (prompt) which does not.
		ExAsserts.cardHasInferences(common.thoughts[state.hands[PLAYER.DONALD][2]], ['y4']);
	});

	it('includes the correct interpretation, even if it requires more blind plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'g3', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'b4', 'y5', 'y2']
		], {
			level: { min: 2 },
			play_stacks: [0, 1, 0, 0, 0],	// y1 is played.
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Donald');
		takeTurn(game, 'Cathy clues 4 to Bob');			// connecting on g2 (Bob, finesse) and g3 (Bob, finesse)

		// There should be y3 -> y4 and g2 -> g3 -> g4 waiting connections.
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.GREEN && wc.inference.rank === 4));
		assert.ok(game.common.waiting_connections.some(wc => wc.inference.suitIndex === COLOUR.YELLOW && wc.inference.rank === 4));
	});

	it('connects when a card plays early', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p5', 'y4', 'r1', 'b3'],
			['p1', 'g5', 'y3', 'y1'],
			['g1', 'p2', 'y1', 'b5']
		], {
			level: { min: 2 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 2 to Alice (slot 4)');	// 2 Save
		takeTurn(game, 'Alice clues 1 to Donald');				// getting g1, y1
		takeTurn(game, 'Bob clues 3 to Cathy');				// connecting on y1 (Donald, playable) and y2 (Alice, prompt)

		// The clued card is likely g3 or y3, since that requires the least number of blind plays.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][2]], ['y3', 'g3']);

		takeTurn(game, 'Cathy clues 5 to Donald');		// 5 Save
		takeTurn(game, 'Donald plays y1', 'r4');

		// Note that at level 5, Alice cannot play y2, since it could be a hidden finesse.
		takeTurn(game, 'Alice plays y2 (slot 4)');

		// y3 should be known, since y2 played before g1 played.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][2]], ['y3']);
	});

	it('connects to a finesse after a fake finesse was just disproven', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'y4', 'r1', 'b3', 'y1'],
			['g1', 'y3', 'p4', 'y1', 'b5']
		], {
			level: { min: 2 },
			play_stacks: [2, 1, 1, 1, 2],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 3 to Alice (slots 2,5)'); 	// Could be b3 reverse finesse or r3, p3 
		takeTurn(game, 'Alice clues 5 to Cathy');
		takeTurn(game, 'Bob clues purple to Cathy');

		// Alice's slot 2 can be any 3 (not prompted to be p3).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r3', 'y3', 'g3', 'b3', 'p3']);
	});

	it(`doesn't consider already-finessed possibilities`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'y4', 'r1', 'b5'],
			['r3', 'y3', 'p4', 'y1'],
			['y1', 'b3', 'b2', 'r4'],
			['p4', 'p1', 'r1', 'y2']
		], {
			level: { min: 2 },
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues red to Emily');	// known r1
		takeTurn(game, 'Emily clues red to Donald'); 	// r4 double finesse
		takeTurn(game, 'Alice clues 5 to Bob');
		takeTurn(game, 'Bob clues 2 to Alice (slot 2)');

		// Alice's slot 2 should be [y2,g2] (not r2).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y2', 'g2']);
	});

	it('prefers to self-finesse over assuming asymmetric information', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r1', 'y5', 'r2', 'b4'],
			['r3', 'g3', 'b2', 'b3', 'm4']
		], {
			level: { min: 2 },
			play_stacks: [0, 0, 2, 0, 3],
			discarded: ['r3', 'm4'],
			variant: VARIANTS.RAINBOW
		});

		takeTurn(game, 'Alice clues red to Cathy');				// r1,r3,m4
		takeTurn(game, 'Bob clues 5 to Alice (slot 5)');		// 5 Save
		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');

		// Alice's slot 1 should be finessed as g3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['g3']);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].finessed, true);
	});

	it('accepts asymmetric information when directly clued a critical', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y1', 'r4', 'b2', 'r2'],
			['r3', 'y4', 'r1', 'b5'],
			['b4', 'y3', 'p4', 'y1']
		], {
			level: { min: 2 },
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues red to Bob');				// r2 play, touching r4
		takeTurn(game, 'Bob plays r2', 'p1');
		takeTurn(game, 'Cathy clues yellow to Donald');
		takeTurn(game, 'Donald clues 3 to Cathy');				// getting r3

		takeTurn(game, 'Alice clues 5 to Cathy');
		takeTurn(game, 'Bob clues red to Alice (slot 1)');

		// We should assume this is r5 and not r4.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['r5']);
	});
});

describe('continuation clues', () => {
	it(`doesn't give continuation clues when cards are in a superposition`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r2'],
			['r3', 'g3', 'p2', 'p1'],
			['b4', 'y2', 'r4', 'p1']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 3,4)');
		takeTurn(game, 'Donald clues 5 to Bob');

		// Red to Donald is not a valid play clue.
		const { play_clues } = find_clues(game);
		assert.ok(!play_clues[PLAYER.DONALD].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED));
	});
});

describe('safe clues', () => {
	it('recognizes when a critical save is required over an ambiguous play', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r5', 'g1', 'r4', 'b5'],
			['g1', 'y3', 'p4', 'p3'],
			['y2', 'p3', 'b4', 'g4'],
		], {
			level: { min: 2 },
			clue_tokens: 1
		});

		// Green to Bob is not a safe play clue, since it may look g2.
		const clue = { target: PLAYER.BOB, type: CLUE.COLOUR, value: COLOUR.GREEN };
		assert.equal(clue_safe(game, game.players[PLAYER.ALICE], clue).safe, false);
	});
});

describe(`occam's razor`, () => {
	it('correctly identifies the simplest connection when a prompt makes the difference', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'y3', 'p4', 'g1'],
			['r3', 'p3', 'b1', 'r5'],
			['b1', 'g3', 'y2', 'p4'],
		], {
			level: { min: 2 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy plays b1', 'g1');
		takeTurn(game, 'Donald clues 2 to Alice (slots 1,3)');		// g1 reverse finesse on Cathy
		takeTurn(game, 'Alice clues 5 to Cathy');

		takeTurn(game, 'Bob clues 3 to Donald');			// g3 delayed play (could look like b3 if we have b2 clued)
		takeTurn(game, 'Cathy plays g1', 'b1');
		takeTurn(game, 'Donald clues 4 to Alice (slot 2)');

		// Even if Donald has [g3,b3], Alice's slot 2 should be g4 (g3 self-finesse) rather than b4 (b2 prompt + b3 finesse on Bob)
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['g4']);
		assert.ok(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]].inferred.length > 1);
	});
});

describe('early game', () => {
	it('will not 5 stall on a trash 5', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r5', 'r4', 'y4', 'b3'],
		], {
			level: { min: 2 },
			discarded: ['r4', 'r4'],
			clue_tokens: 7
		});

		const action = await game.take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: 0 });
	});

	it('gives a bad touch play clue on turn 1 rather than something random', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'y4', 'p4', 'b3', 'g3'],
			['b4', 'r2', 'y1', 'b3', 'y1']
		], { level: { min: 2 } });

		const action = await take_action(game);

		assert.ok(action.type === ACTION.RANK && action.value === 1 && action.target === PLAYER.CATHY ||
			action.type === ACTION.COLOUR && action.value === COLOUR.YELLOW && action.target === PLAYER.CATHY,
		`Expected 1 or yellow to Cathy, got ${logPerformAction(action)}`);
	});

	it('discards rather than giving a bad touch play clue in the early game', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'y4', 'p4', 'b3', 'g3'],
			['b4', 'r2', 'y1', 'b3', 'y1']
		], {
			level: { min: 2 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Bob');

		const action = await take_action(game);
		assert.ok(action.type === ACTION.DISCARD);
	});

	it('gives a bad touch save clue in the early game', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'y4', 'p4', 'p2', 'g3'],
			['b4', 'r2', 'y1', 'b3', 'y3']
		], {
			level: { min: 2 },
			play_stacks: [0, 2, 0, 4, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 5 to Bob');

		const action = await take_action(game);
		assert.ok(action.type === ACTION.RANK || action.type === ACTION.COLOUR);
	});
});
