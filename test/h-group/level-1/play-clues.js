import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, expandShortCard, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import { CLUE } from '../../../src/constants.js';
import HGroup from '../../../src/conventions/h-group.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { get_result } from '../../../src/conventions/h-group/clue-finder/determine-clue.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('play clue', () => {
	it('can interpret a colour play clue touching one card', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r1', 'b5', 'p2', 'y1']
		], { level: { min: 1 } });

		takeTurn(game, 'Alice clues red to Bob');

		// Target card should be inferred as r1.
		const targetCard = game.state.hands[PLAYER.BOB][1];
		ExAsserts.cardHasInferences(game.common.thoughts[targetCard.order], ['r1']);
	});

	it('can interpret a colour play clue touching multiple cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r4', 'r3', 'p2', 'y1']
		], { level: { min: 1 } });

		takeTurn(game, 'Alice clues red to Bob');

		// Bob's slot 1 should be inferred as r1.
		const targetCard = game.state.hands[PLAYER.BOB][0];
		ExAsserts.cardHasInferences(game.common.thoughts[targetCard.order], ['r1']);
	});

	it('can interpret a colour play clue touching chop', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'r4', 'p2', 'b5', 'r1']
		], { level: { min: 1 } });

		takeTurn(game, 'Alice clues red to Bob');

		// Bob's slot 5 (chop) should be inferred as r1.
		const targetCard = game.state.hands[PLAYER.BOB][4];
		ExAsserts.cardHasInferences(game.common.thoughts[targetCard.order], ['r1']);
	});

	it('can interpret a colour play clue on a partial stack', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p2', 'b5', 'r3', 'y4', 'y3']
		], {
			level: { min: 1 },
			play_stacks: [2, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues red to Bob');

		// Bob's slot 3 should be inferred as r3.
		const targetCard = game.state.hands[PLAYER.BOB][2];
		ExAsserts.cardHasInferences(game.common.thoughts[targetCard.order], ['r3']);
	});

	it('can interpret a colour play clue through someone\'s hand', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p2', 'b5', 'r2', 'y4', 'y3'],
			['g1', 'r1', 'g4', 'y2', 'b2']
		], { level: { min: 1 } });

		const { state } = game;

		// Cathy's r1 is clued and inferred.
		state.hands[PLAYER.CATHY][1].clued = true;
		const card = game.common.thoughts[state.hands[PLAYER.CATHY][1].order];
		card.possible = card.possible.intersect(['r1', 'r2', 'r3', 'r4', 'r5'].map(expandShortCard));
		card.inferred = card.inferred.intersect(['r1'].map(expandShortCard));

		takeTurn(game, 'Alice clues red to Bob');

		// Bob's slot 3 should be inferred as r2.
		const targetOrder = state.hands[PLAYER.BOB][2].order;
		ExAsserts.cardHasInferences(game.common.thoughts[targetOrder], ['r2']);
	});

	it('can interpret a self-connecting colour play clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'r1', 'b2', 'p5', 'y4'],
		], { level: { min: 1 } });

		const { common, state } = game;

		// Bob has a 1 in slot 2.
		state.hands[PLAYER.BOB][1].clued = true;
		const card = common.thoughts[state.hands[PLAYER.BOB][1].order];
		card.possible = card.possible.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		card.inferred = card.inferred.intersect(['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		takeTurn(game, 'Alice clues red to Bob');

		// Bob's slot 1 should be inferred as r2.
		const targetOrder = state.hands[PLAYER.BOB][0].order;
		ExAsserts.cardHasInferences(common.thoughts[targetOrder], ['r2']);
	});

	it('correctly undoes a prompt after proven false', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'y2', 'r2', 'b3'],
			['y4', 'b3', 'g4', 'g3'],
			['r4', 'y2', 'r3', 'r1']
		], {
			level: { min: 1 },
			play_stacks: [3, 0, 2, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');
		takeTurn(game, 'Alice clues green to Cathy');
		takeTurn(game, 'Bob clues 5 to Alice (slot 4)');

		// Alice's slot 4 can be r5 (finesse on Donald) or g5 (prompt on Cathy).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r5', 'g5']);

		takeTurn(game, 'Cathy plays g3', 'p1');
		takeTurn(game, 'Donald plays r4', 'y3');

		// Alice's slot 4 should be exactly r5.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3].order], ['r5']);

		// Cathy's slot 4 (used to be slot 3) can still be g4,g5.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.CATHY][3].order], ['g4', 'g5']);
	});

	it('correctly writes inferences after playing when connecting on own playables', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'y2', 'r2', 'b3', 'r4'],
			['r4', 'y2', 'r3', 'r1', 'g1']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 1, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,4)');
		takeTurn(game, 'Cathy clues 2 to Bob');
		takeTurn(game, 'Alice plays r1 (slot 4)');

		takeTurn(game, 'Bob clues green to Cathy');
		takeTurn(game, 'Cathy plays g1', 'b1');
		takeTurn(game, 'Alice plays y1 (slot 3)');

		// Bob's 2 is [r2,y2,b2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][1].order], ['r2', 'y2', 'b2']);
	});
});

describe('counting playables', () => {
	it('considers ambiguous play clues to still be plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'p4', 'g4', 'g4', 'r4'],
			['y5', 'r2', 'y3', 'p1', 'y1']
		], {
			level: { min: 1 },
			play_stacks: [5, 0, 5, 5, 5]
		});

		const { play_clues } = find_clues(game);
		const clue = play_clues[PLAYER.CATHY].find(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.YELLOW);

		assert.ok(clue !== undefined);
		assert.equal(clue.result.playables.length, 1);
	});

	it('correctly counts the number of playables when also cluing known trash', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'g1', 'p4', 'r2', 'r3']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB,
			play_stacks: [2, 5, 5, 5, 5]
		});

		const clue = { type: CLUE.RANK, target: PLAYER.BOB, value: 3 };
		const list = game.state.hands[PLAYER.BOB].clueTouched(clue, game.state.variant).map(c => c.order);
		const hypo_state = game.simulate_clue({ type: 'clue', clue, list, giver: PLAYER.ALICE, target: PLAYER.BOB });
		const { playables, trash } = get_result(game, hypo_state, clue, PLAYER.ALICE);

		// There should be 1 playable and 1 trash.
		assert.equal(playables.length, 1);
		assert.equal(trash, 1);
	});

	it('correctly counts the number of playables when connecting on unknown plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'g1', 'p5', 'r2', 'y2'],
			['g2', 'g3', 'p2', 'p1', 'b4']
		], {
			level: { min: 1 },
			starting: PLAYER.CATHY
		});
		const { state } = game;

		takeTurn(game, 'Cathy clues 1 to Bob');

		const clue = { type: CLUE.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN };
		const list = state.hands[PLAYER.CATHY].clueTouched(clue, state.variant).map(c => c.order);
		const hypo_state = game.simulate_clue({ type: 'clue', clue, list, giver: PLAYER.ALICE, target: PLAYER.CATHY });
		const { playables } = get_result(game, hypo_state, clue, PLAYER.ALICE);

		// g2 should be counted as newly playable.
		assert.equal(playables.length, 1);
	});

	it('correctly maintains the number of playables when a linked card is played', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p1', 'g1', 'r1', 'r2'],
			['g4', 'g3', 'p2', 'b3'],
			['y2', 'b4', 'r5', 'r1']
		], {
			level: { min: 1 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 1 to Bob');
		takeTurn(game, 'Alice clues purple to Cathy');		// Link between p1, g1 and r1 for p1
		takeTurn(game, 'Bob plays r1', 'y4');

		// The hypo stacks should not change except for r1 becoming known.
		assert.ok([1, 0, 0, 0, 2].every((stack_rank, suitIndex) => game.common.hypo_stacks[suitIndex] === stack_rank),
			`Expected hypo stacks ${[1, 0, 0, 0, 2]}, got ${game.common.hypo_stacks}`);
	});

	it('correctly counts the number of playables when connecting on unknown plays 2', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'b3', 'p5', 'r4', 'y4'],
			['g2', 'g3', 'p2', 'p1', 'b4']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3)');
		takeTurn(game, 'Cathy clues 2 to Bob');

		// Bob's g2 is unknown playable.
		assert.ok(game.common.unknown_plays.has(game.state.hands[PLAYER.BOB][0].order));
	});

	it('correctly counts the number of playables when connecting on unknown plays 3', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'y2', 'r2', 'b3', 'g1'],
			['y4', 'b3', 'p3', 'p2', 'y2']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Cathy');
		takeTurn(game, 'Cathy clues 1 to Alice (slots 2,3,5)');
		takeTurn(game, 'Alice clues green to Bob');

		takeTurn(game, 'Bob clues purple to Cathy');		// We are promised p1
		takeTurn(game, 'Cathy clues 2 to Bob');				// We are promised y1

		// Purple stack is known up to 3.
		assert.equal(game.common.hypo_stacks[COLOUR.PURPLE], 3);

		// Bob's y2 is unknown playable.
		assert.ok(game.common.unknown_plays.has(game.state.hands[PLAYER.BOB][1].order));
	});

	it('correctly counts the number of playables when fake connecting on unknown plays', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'y2', 'g1', 'b3'],
			['r3', 'r2', 'p3', 'p1'],
			['y4', 'b5', 'b2', 'y2']
		], {
			level: { min: 1 },
			starting: PLAYER.DONALD,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Donald clues 1 to Bob');

		const { play_clues } = find_clues(game);
		const clue = play_clues[PLAYER.CATHY].find(clue => clue.type === CLUE.RANK && clue.value === 2);

		assert.ok(clue !== undefined);
		assert.equal(clue.result.playables.length, 1);
	});
});
