import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, VARIANTS, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';
import { produce } from '../../src/StateProxy.js';
import { team_elim } from '../../src/basics/helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('tempo clue chop moves', () => {
	it(`doesn't tccm before level 6`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: { min: 5, max: 5 } });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'y5');
		takeTurn(game, 'Cathy clues 2 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].chop_moved, false);
	});

	it('understands a tccm', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: { min: 6 } });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'y5');
		takeTurn(game, 'Cathy clues 2 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][4]].chop_moved, true);
	});

	it('understands a tccm on self', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'y5', 'g4', 'r5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], {
			level: { min: 6 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 1,2)');
		takeTurn(game, 'Alice plays r1 (slot 1)');
		takeTurn(game, 'Bob clues 2 to Alice (slot 2)');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]].chop_moved, true);
	});

	it(`doesn't tccm if locked`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g2', 'r4', 'y3'],
			['b5', 'y5', 'g5', 'r5'],
			['b4', 'p3', 'g1', 'g1']
		], {
			level: { min: 6 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 5 to Cathy');
		takeTurn(game, 'Alice clues green to Bob');
		takeTurn(game, 'Bob plays g1 (slot 1)', 'y2');
		takeTurn(game, 'Cathy clues 2 to Bob');

		// TODO: This should work even if Cathy clues green, as long as a higher priority clue is available (level 9, stalling).

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][3]].chop_moved, false);
	});

	it(`doesn't tccm if getting a chop moved card`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g2', 'r1', 'y2'],
			['b2', 'y1', 'g5', 'r5'],
			['b4', 'p3', 'g1', 'g4']
		], {
			level: { min: 6 },
			play_stacks: [1, 1, 1, 1, 1],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 1 to Bob');
		takeTurn(game, 'Alice clues yellow to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][1]].chop_moved, false);
	});

	it(`doesn't tccm if getting a playable in other hand`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p1', 'p2', 'r1', 'y1'],
			['b2', 'y5', 'g3', 'y3'],
			['b4', 'p4', 'g1', 'g1']
		], {
			level: { min: 6 },
			play_stacks: [2, 2, 2, 2, 0],
			discarded: ['y3'],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues purple to Bob');
		takeTurn(game, 'Donald clues 3 to Cathy');

		// Gets p2 played, which unlocks touched g3 in Cathy's hand
		takeTurn(game, 'Alice clues 2 to Bob');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][3]].chop_moved, false);
	});

	it(`doesn't tccm if the card was already playing`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'r3', 'r1', 'y1'],
			['p1', 'y5', 'g3', 'y3'],
			['b4', 'p4', 'g1', 'g1']
		], { level: { min: 6 } });

		takeTurn(game, 'Alice clues purple to Cathy');
		takeTurn(game, 'Bob clues purple to Cathy');

		// Cathy's slot 4 should not be chop moved.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][3]].chop_moved, false);
	});

	it(`doesn't tccm if the card was already playing asymmetrically`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'r5', 'p4', 'p3'],
			['p5', 'y5', 'g3', 'y3'],
			['b4', 'p4', 'g1', 'g1']
		], {
			level: { min: 6 },
			play_stacks: [0, 0, 0, 0, 2],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues purple to Bob');
		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');

		const { stall_clues } = find_clues(game);

		// 4 to Bob is not a valid TCCM (p4 will play naturally).
		assert.ok(!stall_clues[1].some(clue => clue.target === PLAYER.BOB && clue.type === CLUE.RANK && clue.value === 4));
	});

	it(`doesn't tccm if the card was already playing asymmetrically 2`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['m1', 'r5', 'm4', 'y3'],
			['m2', 'y5', 'g3', 'y3'],
			['b4', 'm4', 'g1', 'g1']
		], {
			level: { min: 6 },
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.DONALD,
			variant: VARIANTS.RAINBOW,
			init: (game) => {
				const c_slot1 = game.state.hands[PLAYER.CATHY][0];
				const { inferred, possible } = game.common.thoughts[c_slot1];

				// Cathy's slot 1 is clued red and inferred to be [r2,m2].
				game.state.deck = game.state.deck.with(c_slot1, produce(game.state.deck[c_slot1], (draft) => {
					draft.clues = [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE, turn: -1 }];
					draft.clued = true;
				}));

				game.common.updateThoughts(c_slot1, (draft) => {
					draft.inferred = inferred.intersect(['r2', 'm2'].map(expandShortCard));
					draft.possible = possible.intersect(['r1', 'r2', 'r3', 'r4', 'r5', 'm1', 'm2', 'm3', 'm4', 'm5'].map(expandShortCard));
					draft.clues = [{ type: CLUE.COLOUR, value: COLOUR.RED, giver: PLAYER.ALICE, turn: -1 }];
					draft.clued = true;
				});
				team_elim(game);
			}
		});

		takeTurn(game, 'Donald clues green to Bob');

		const { stall_clues } = find_clues(game);

		// 2 to Cathy is not a valid TCCM (p4 will play naturally).
		assert.ok(!stall_clues[1].some(clue => clue.target === PLAYER.CATHY && clue.type === CLUE.RANK && clue.value === 2));
	});

	it(`doesn't tccm for a finesse touching no new cards`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p5', 'r5', 'p4', 'p3', 'g4'],
			['b1', 'y5', 'g3', 'y3', 'p4']
		], {
			level: { min: 6 },
			starting: PLAYER.BOB,
			init: (game) => {
				const a_slot1 = game.state.hands[PLAYER.ALICE][0];
				const { inferred, possible } = game.common.thoughts[a_slot1];

				game.state.deck = game.state.deck.with(a_slot1, produce(game.state.deck[a_slot1], (draft) => {
					draft.clues = [{ type: CLUE.COLOUR, value: COLOUR.BLUE, giver: PLAYER.BOB, turn: -1 }];
					draft.clued = true;
				}));

				game.common.updateThoughts(a_slot1, (draft) => {
					draft.inferred = inferred.intersect(['b2', 'b3', 'b4', 'b5'].map(expandShortCard));
					draft.possible = possible.intersect(['b2', 'b3', 'b4', 'b5'].map(expandShortCard));
					draft.clues = [{ type: CLUE.COLOUR, value: COLOUR.BLUE, giver: PLAYER.BOB, turn: -1 }];
					draft.clued = true;
				});
				team_elim(game);
			}
		});

		takeTurn(game, 'Bob clues blue to Alice (slot 1)');
		takeTurn(game, 'Cathy plays b1', 'g1');

		// Alice's slot 5 is not TCCM'd.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]].chop_moved, false);
	});

	it(`prefers tccm to cm a useful card`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'r4', 'b4', 'p2', 'p1'],
			['b2', 'y5', 'g4', 'y1', 'p4'],
		], {
			level: { min: 6 },
			play_stacks: [5, 2, 2, 2, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues purple to Bob');

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { target: PLAYER.BOB, type: ACTION.RANK, value: 2 });
	});
});

/*
describe('multiple tempo clues', () => {
	it('understands a double tempo clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'g5', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: { min: 6 } });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'y5');
		takeTurn(game, 'Cathy clues red to Bob');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][2]], ['r3']);
	});

	it('understands a triple tempo clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'r4', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: { min: 6 } });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'y5');
		takeTurn(game, 'Cathy clues red to Bob');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3]], ['r4']);
	});

	it('gives a triple tempo clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r2', 'r3', 'r4', 'b4'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], { level: { min: 6 } });

		takeTurn(game, 'Alice clues red to Bob');
		takeTurn(game, 'Bob plays r1', 'y5');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');

		const { play_clues } = find_clues(game);

		const tempo_clue = play_clues[PLAYER.BOB].find(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED);
		assert.ok(tempo_clue);

		// The tempo clue gets r2, r3 and r4 to play.
		assert.equal(tempo_clue.result.playables.length, 3);
	});

	it(`doesn't give invalid multiple tempo clues`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'b2', 'g4', 'y2', 'r2'],
			['g4', 'r2', 'b1', 'r3', 'p1']
		], {
			level: { min: 6 },
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues 2 to Bob');		// 2 Save
		takeTurn(game, 'Alice clues 1 to Cathy');	// getting b1, p1
		takeTurn(game, 'Bob clues 5 to Alice (slot 5)');

		takeTurn(game, 'Cathy plays p1 (slot 5)', 'r5');

		const { play_clues } = find_clues(game);

		// 2 to Bob is not a valid tempo clue, since y1 is nowhere to be found.
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 2));
	});
});
*/
