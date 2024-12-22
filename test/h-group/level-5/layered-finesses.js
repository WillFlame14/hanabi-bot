import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, expandShortCard, PLAYER, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../../src/constants.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { clue_safe } from '../../../src/conventions/h-group/clue-finder/clue-safe.js';
import { take_action } from '../../../src/conventions/h-group/take-action.js';

import logger from '../../../src/tools/logger.js';
import { produce } from '../../../src/StateProxy.js';
logger.setLevel(logger.LEVELS.ERROR);

describe('layered finesse', () => {
	it('understands a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'y1', 'r2', 'y3', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues yellow to Alice (slot 3)');

		// Alice's slot 3 should be [y1,y2].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['y1', 'y2']);

		takeTurn(game, 'Cathy plays g1', 'b1');		// expecting y1 finesse
		takeTurn(game, 'Alice discards b1 (slot 5)');
		takeTurn(game, 'Bob discards b4', 'r1');

		takeTurn(game, 'Cathy plays y1', 'y1');

		// Alice's slot 4 (used to be slot 3) should be y2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['y2']);
	});

	it('writes correct notes for a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'b4'],
			['g1', 'g2', 'y1', 'y2', 'p3']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues yellow to Alice (slot 3)');

		// Cathy's hand should be marked correctly.
		assert.ok(game.state.hands[PLAYER.CATHY].every(o => game.common.thoughts[o].inferred.has(game.state.deck[o])));
	});

	it('writes correct notes for a fake asymmetric layered finesse', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'r1', 'r4', 'r3'],
			['g2', 'g3', 'g1', 'b1'],
			['b5', 'y4', 'r4', 'b2']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Cathy');
		takeTurn(game, 'Cathy plays b1', 'r5');
		takeTurn(game, 'Donald clues 4 to Alice (slots 2,3)');

		// Globally, we could have b4 or r4. However, we can see both r4s visible.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['b4', 'r4']);

		takeTurn(game, 'Alice clues 2 to Cathy');
		takeTurn(game, 'Bob plays b2', 'b1');
		takeTurn(game, 'Cathy plays g1', 'y2');
		takeTurn(game, 'Donald clues 3 to Cathy');

		// We should play slot 1 as b3.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.common.thoughts[game.state.hands[PLAYER.ALICE][0]].order });
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['b3']);
	});

	it('understands playing into a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3', 'r3'],
			['r4', 'r4', 'g4', 'r5', 'b4']
		], {
			level: { min: 5, max: 10 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues yellow to Bob');

		// Alice's slot 1 should be [y1].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['y1']);

		takeTurn(game, 'Alice plays g1 (slot 1)');		// expecting y1 finesse

		// Alice's slot 2 should be [y1] now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y1']);
	});

	it('understands playing into a complex layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b5', 'p4', 'y2', 'g3'],
			['g1', 'r4', 'g4', 'r5'],
			['g2', 'r4', 'b4', 'g1']
		], {
			level: { min: 5 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 4 to Alice (slot 4)');	// touching g4
		takeTurn(game, 'Cathy plays g1 (slot 1)', 'p3');
		takeTurn(game, 'Donald plays g2 (slot 1)', 'r5');
		takeTurn(game, 'Alice plays p1 (slot 1)');

		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		ExAsserts.cardHasInferences(slot2, ['g3']);
		assert.equal(slot2.finessed, true);

		// Double-check that Alice also thinks slot 2 is g3 and finessed
		const alice_slot2 = game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][1]];
		ExAsserts.cardHasInferences(alice_slot2, ['g3']);
		assert.equal(alice_slot2.finessed, true);
	});

	it('understands when it dupes a card in its own layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r2', 'b4', 'g2', 'r5'],
			['g1', 'b2', 'y3', 'r4'],
			['p1', 'r3', 'r1', 'g3']
		], {
			level: { min: 5 },
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 4 to Cathy');		// r2 on Cathy, r3 on us
		takeTurn(game, 'Alice clues green to Bob');		// reverse finesse for g1
		takeTurn(game, 'Bob plays r2', 'b4');
		takeTurn(game, 'Cathy plays g1', 'g4');

		takeTurn(game, 'Donald clues 5 to Alice (slot 4)');
		takeTurn(game, 'Alice bombs g1 (slot 1)');		// We try to play r3, but end up bombing a copy of g1 that was layered.

		// Slot 2 should still be finessed as r3.
		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		ExAsserts.cardHasInferences(slot2, ['r3']);
		assert.equal(slot2.finessed, true);
	});

	it('does not try giving layered finesses on the same card', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'y1', 'p1', 'r5', 'b4'],
			['r2', 'y4', 'p2', 'g3', 'r3']
		], { level: { min: 5, max: 10 } });

		const { play_clues } = find_clues(game);

		// Purple does not work as a layered finesse
		assert.equal(play_clues[PLAYER.CATHY].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.PURPLE), false);
	});

	it('gracefully handles clues that reveal layered finesses (non-matching)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b5', 'r2', 'y1', 'p4'],
			['r4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: { min: 5, max: 10 },
			starting: PLAYER.CATHY,
			discarded: ['y4']
		});

		takeTurn(game, 'Cathy clues red to Bob');			// r2 layered finesse on us
		takeTurn(game, 'Alice plays b1 (slot 1)');			// expecting r1 finesse
		takeTurn(game, 'Bob clues yellow to Alice (slots 2,5)');		// y4 save
		takeTurn(game, 'Cathy discards b4', 'b1');

		// Alice's slot 2 (the yellow card) should be finessed as y1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r1']);

		takeTurn(game, 'Alice plays r1 (slot 3)');

		// y1 inference should remain (now on slot 3).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['y1']);
	});

	it('gracefully handles clues that reveal layered finesses (matching)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'b5', 'r2', 'y1', 'p4'],
			['y4', 'g2', 'g4', 'r5', 'b4']
		], {
			level: { min: 5, max: 10 },
			starting: PLAYER.CATHY,
			discarded: ['r4']
		});

		takeTurn(game, 'Cathy clues red to Bob'); 			// r2 layered finesse on us
		takeTurn(game, 'Alice plays b1 (slot 1)');			// expecting r1 finesse
		takeTurn(game, 'Bob clues red to Alice (slots 3,5)');		// r4 save

		// Alice's slot 2 should be finessed as [y1, g1, b2, p1].
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y1', 'g1', 'b2', 'p1']);

		// Alice's slot 3 should be finessed as the missing r1.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]].finessed, true);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r1']);
	});

	it('plays correctly into layered finesses with self-connecting cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y2', 'r5', 'r4'],
			['g1', 'r1', 'b5', 'g4', 'b4']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues yellow to Bob');		// y2 layered finesse on us
		takeTurn(game, 'Alice plays p1 (slot 1)');			// expecting y1 finesse
		takeTurn(game, 'Bob discards r4', 'b2');

		takeTurn(game, 'Cathy discards b4', 'b3');
		takeTurn(game, 'Alice plays p2 (slot 2)');			// expecting y1 finesse

		// y1 should be in slot 3 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['y1']);
	});

	it(`doesn't try to connect on others inside a self-layered finesse`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b1', 'b4', 'y2', 'r5'],
			['p2', 'y1', 'b5', 'g4'],
			['g1', 'r4', 'b4', 'g3']
		], {
			level: { min: 5 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues yellow to Bob');		// y2 layered finesse on us
		takeTurn(game, 'Alice plays p1 (slot 1)');			// expecting y1 finesse

		// We should connect with y1 in slot 2, not using Bob's y1 .
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['y1']);
	});

	it('recognizes unsafe players when they cannot play into a layered finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y1', 'r3', 'r5', 'g5', 'p4'],
			['r1', 'r2', 'g4', 'y3', 'b4']
		], {
			level: { min: 6 },
			clue_tokens: 6
		});

		takeTurn(game, 'Alice clues 3 to Bob');
		takeTurn(game, 'Bob discards p4', 'b4');
		takeTurn(game, 'Cathy plays r1', 'g1');

		// Green to Cathy is not safe, Bob cannot play into the r3 layer.
		assert.equal(clue_safe(game, game.me, { type: CLUE.COLOUR, target: PLAYER.CATHY, value: COLOUR.GREEN }).safe, false);
	});

	it(`doesn't give finesses to a player who may need to demonstrate a finesse to us`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r3', 'b5', 'p2', 'p1'],
			['r1', 'g3', 'r2', 'b4'],
			['g1', 'g5', 'p1', 'y4']
		], {
			level: { min: 5 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues 2 to Alice (slots 2,4)');		// 2 Save
		takeTurn(game, 'Alice clues 1 to Donald');					// getting g1, p1
		takeTurn(game, 'Bob clues green to Alice (slots 1,4)');		// revealing g2, and touching g3 (direct) or g4 (r1, g3 reverse layer)
		takeTurn(game, 'Cathy clues 5 to Donald');

		const { play_clues } = find_clues(game);

		// 3 to Bob does not work, since we may have g3
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});

	it(`doesn't accomodate impossible layers`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g2', 'b2', 'g4'],
			['g5', 'p2', 'g1', 'p1'],
			['p4', 'r4', 'y5', 'y3']
		], {
			level: { min: 5 },
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Bob');				// Finessing ALice's b1 in slot 1
		takeTurn(game, 'Donald clues 4 to Alice (slot 2)');

		// The simplest interpretation is g3 behind b1 (note that g3 cannot be in front of b1)
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['b1']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['g3']);
	});

	it('writes correct notes after a fake layered finesse is disproven', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'b4'],
			['g5', 'p2', 'g2', 'b3'],
			['p4', 'y3', 'y5', 'r2']
		], {
			level: { min: 5 },
			play_stacks: [0, 0, 0, 1, 0],
			discarded: ['b3', 'b4']
		});

		takeTurn(game, 'Alice clues 3 to Cathy');		// b3 save
		takeTurn(game, 'Bob clues red to Donald');		// r1 reverse finesse on us
		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues blue to Bob');		// b4 save (could be b2 play)

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3]], ['b2', 'b4']);

		takeTurn(game, 'Alice plays r1 (slot 1)');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.BOB][3]], ['b2', 'b4']);
	});

	it('allows layered players to unintentionally stomp on a finesse', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'b2', 'p4'],
			['b2', 'r2', 'g2', 'b3', 'y3']
		], {
			level: { min: 5 },
			play_stacks: [0, 0, 0, 1, 0],
			starting: PLAYER.BOB,
			init: (game) => {
				const { state } = game;

				// Alice has a known r1 in slot 5.
				const a_slot5 = state.hands[PLAYER.ALICE][4];
				state.deck = state.deck.with(a_slot5, produce(state.deck[a_slot5], (draft) => { draft.clued = true; }));

				for (const player of game.allPlayers) {
					player.updateThoughts(a_slot5, (draft) => {
						draft.clued = true;
						draft.inferred = draft.inferred.intersect(expandShortCard('r1'));
						draft.possible = draft.possible.intersect(['r1', 'r2', 'r3', 'r4', 'r5'].map(expandShortCard));
					});
				}
			}
		});

		takeTurn(game, 'Bob clues red to Alice (slot 2,5)');		// r2 direct, or r3 layered
		takeTurn(game, 'Cathy clues blue to Bob');					// Cathy, not knowing about the layer, clues a dupe b2
		takeTurn(game, 'Alice plays r1 (slot 5)');

		takeTurn(game, 'Bob clues 5 to Alice (slot 5)');
		takeTurn(game, 'Cathy plays b2', 'p2');

		// r3 layered finesse is confirmed (not r2).
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['r3']);
	});
});
