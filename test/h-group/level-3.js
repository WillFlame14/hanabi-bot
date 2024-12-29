import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import { ACTION, CLUE } from '../../src/constants.js';
import HGroup from '../../src/conventions/h-group.js';
import logger from '../../src/tools/logger.js';

import { order_1s } from '../../src/conventions/h-group/action-helper.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { determine_focus } from '../../src/conventions/h-group/hanabi-logic.js';
import { produce } from '../../src/StateProxy.js';

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

	it('recognizes the correct focus of a 1 clue', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'r2', 'g3', 'r5', 'b3'],
			['r4', 'b1', 'g4', 'y1', 'p4']
		], {
			level: { min: 3 },
			starting: PLAYER.BOB
		});

		const clue = { type: CLUE.RANK, value: 1 };
		const list = game.state.clueTouched(game.state.hands[PLAYER.CATHY], clue);
		const { focus } = determine_focus(game, game.state.hands[PLAYER.CATHY], game.common, list, clue);

		// The focus of the clue is Cathy's slot 3.
		assert.equal(focus, game.state.hands[PLAYER.CATHY][3]);
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
			starting: PLAYER.CATHY,
			init: (game) => {
				const { common, state } = game;

				// pace = currScore (4) + state.cardsLeft (18) + state.numPlayers (3) - maxScore (25) = 0
				state.cardsLeft = 18;

				// Bob's y4 is clued yellow.
				const y4 = state.hands[PLAYER.BOB][3];
				let { inferred, possible } = common.thoughts[y4];

				state.deck = state.deck.with(y4, produce(state.deck[y4], (draft) => { draft.clued = true; }));
				common.updateThoughts(y4, (draft) => {
					draft.inferred = inferred.intersect(['y4'].map(expandShortCard));
					draft.possible = possible.intersect(['y1', 'y2', 'y3', 'y4'].map(expandShortCard));
					draft.clued = true;
				});

				// Bob's y5 is known.
				const y5 = state.hands[PLAYER.BOB][2];
				({ inferred, possible } = common.thoughts[y5]);

				state.deck = state.deck.with(y5, produce(state.deck[y4], (draft) => { draft.clued = true; }));
				common.updateThoughts(y5, (draft) => {
					draft.inferred = inferred.intersect(['y5'].map(expandShortCard));
					draft.possible = possible.intersect(['y5'].map(expandShortCard));
					draft.clued = true;
				});
			}
		});

		takeTurn(game, 'Cathy clues yellow to Alice (slot 5)');

		// Alice should play slot 5 instead of discarding for tempo.
		const action = await game.take_action(game);
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
			level: { min: 3 },
			play_stacks: [1, 1, 0, 1, 0],
			clue_tokens: 6
		});

		takeTurn(game, 'Alice clues 2 to Bob');
		takeTurn(game, 'Bob clues blue to Alice (slot 1)');
		takeTurn(game, 'Alice discards b2 (slot 1)');

		// Every 2 can still be inferred b2.
		assert.ok([1, 2, 4].every(index =>
			game.allPlayers[PLAYER.BOB].thoughts[game.state.hands[PLAYER.BOB][index]].inferred.has({ suitIndex: 3, rank:2 })));
	});

	it('preserves information lock after a sarcastic discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'g2', 'b2', 'r4', 'p2'],
			['y3', 'y1', 'b5', 'g3', 'r2']
		], {
			level: { min: 3 },
			play_stacks: [0, 1, 1, 2, 2],
			starting: PLAYER.BOB,
			clue_tokens: 6,
			init: (game) => {
				const { state } = game;

				const update = (draft) => {
					draft.clued = true;
					draft.clues = [{ giver: PLAYER.ALICE, turn: -1, type: CLUE.COLOUR, value: COLOUR.RED },
								   { giver: PLAYER.ALICE, turn: -1, type: CLUE.RANK, value: 2 }];
				};

				// Cathy's slot 5 is known r2.
				const c_slot5 = state.hands[PLAYER.CATHY][4];
				state.deck = state.deck.with(c_slot5, produce(state.deck[c_slot5], update));

				for (const player of game.allPlayers) {
					player.updateThoughts(c_slot5, (draft) => {
						update(draft);
						draft.inferred = draft.inferred.intersect(expandShortCard('r2'));
						draft.possible = draft.possible.intersect(expandShortCard('r2'));
					});
				}
			}
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 1,2)');
		takeTurn(game, 'Cathy discards r2', 'p5');

		// Alice's slot 1 should remain [y2,g2] and slot 2 should be known r2.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][0]], ['y2', 'g2']);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['r2']);
	});

	it('generates a link from a sarcastic discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'g2', 'b2', 'r4', 'b5'],
			['y4', 'y1', 'p2', 'g3', 'r2']
		], {
			level: { min: 3 },
			play_stacks: [1, 1, 0, 0, 0],
			starting: PLAYER.BOB,
			clue_tokens: 6,
			init: (game) => {
				const { state } = game;

				const update = (draft) => {
					draft.clued = true;
					draft.clues = [{ giver: PLAYER.ALICE, turn: -1, type: CLUE.COLOUR, value: COLOUR.RED },
								   { giver: PLAYER.ALICE, turn: -1, type: CLUE.RANK, value: 2 }];
				};

				// Cathy's slot 5 is known r2.
				const c_slot5 = state.hands[PLAYER.CATHY][4];
				state.deck = state.deck.with(c_slot5, produce(state.deck[c_slot5], update));

				for (const player of game.allPlayers) {
					player.updateThoughts(c_slot5, (draft) => {
						update(draft);
						draft.inferred = draft.inferred.intersect(expandShortCard('r2'));
						draft.possible = draft.possible.intersect(expandShortCard('r2'));
					});
				}
			}
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 3,4,5)');
		takeTurn(game, 'Cathy discards r2', 'g1');

		console.log(game.common.links);

		// ALice should have an r2 link between slots 3 and 4 (can't be slot 5, otherwise Bob wouldn't save).
		assert.ok(game.common.links.some(link =>
			link.orders.includes(1) && link.orders.includes(2) && link.identities.some(i => i.suitIndex === COLOUR.RED && i.rank === 2)));

		takeTurn(game, 'Alice clues 5 to Bob');
		takeTurn(game, 'Bob clues green to Alice (slot 3)');	// finessing Cathy's new g1

		// ALice's slot 4 should be known r2 now.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]], ['r2']);
	});

	it('correctly interprets a sarcastic discard against gtp', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g1', 'g4', 'p5', 'y4'],
			['y3', 'p3', 'r2', 'p2'],
			['p4', 'r3', 'r5', 'r1']
		], {
			level: { min: 3 },
			play_stacks: [0, 1, 1, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues green to Alice (slots 1,2)');		// getting g2 (and g4)
		takeTurn(game, 'Alice plays g2 (slot 1)');
		takeTurn(game, 'Bob clues 5 to Alice (slot 1)');
		takeTurn(game, 'Cathy clues 4 to Bob');						// Finessing Alice's y1, y2. Alice's g card is g3 by gtp.

		takeTurn(game, 'Donald clues 5 to Bob');
		takeTurn(game, 'Alice plays y2 (slot 3)');					// Playing into the finesse
		takeTurn(game, 'Bob discards g4', 'y1');

		// Alice's slot 3 is g4, not [g3,g4].
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][2]], ['g4']);
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
