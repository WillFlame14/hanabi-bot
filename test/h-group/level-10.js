import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import HGroup from '../../src/conventions/h-group.js';

import logger from '../../src/tools/logger.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { ACTION, CLUE } from '../../src/constants.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';

logger.setLevel(logger.LEVELS.ERROR);

describe(`gentleman's discards`, () => {
	it(`understands a gentleman's discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b4', 'b2'],
			['r1', 'y4', 'r4', 'y3'],
			['y5', 'r5', 'b1', 'g5']
		], {
			level: { min: 10 }
		});

		takeTurn(game, 'Alice clues blue to Donald');	// getting b1
		takeTurn(game, 'Bob clues red to Cathy');		// getting r1
		takeTurn(game, 'Cathy plays r1', 'b1');
		takeTurn(game, 'Donald discards b1', 'b3');

		// Donald performed a Gentleman's Discard on Cathy.
		const cathy_slot1 = game.common.thoughts[game.state.hands[PLAYER.CATHY][0]];
		ExAsserts.cardHasInferences(cathy_slot1, ['b1']);
		assert.equal(cathy_slot1.known, true);
	});

	it(`understands a gentleman's discard on us`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y1', 'g4', 'b4', 'b2'],
			['r1', 'y4', 'r4', 'y3'],
			['y5', 'r5', 'b1', 'g5']
		], {
			level: { min: 10 }
		});

		takeTurn(game, 'Alice clues yellow to Bob');	// getting y1
		takeTurn(game, 'Bob discards y1', 'y3');

		// Bob performed a Gentleman's Discard on us.
		const alice_slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0]];
		ExAsserts.cardHasInferences(alice_slot1, ['y1']);
		assert.equal(alice_slot1.known, true);

		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);
		assert.ok(playables.includes(game.state.hands[PLAYER.ALICE][0]));
	});

	it(`understands a layered gentleman's discard`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b4', 'b2'],
			['r1', 'b1', 'r4', 'y3'],
			['y5', 'r5', 'b1', 'g5']
		], {
			level: { min: 10 }
		});

		takeTurn(game, 'Alice clues blue to Donald');	// getting b1
		takeTurn(game, 'Bob clues red to Cathy');		// getting r1
		takeTurn(game, 'Cathy plays r1', 'r2');
		takeTurn(game, 'Donald discards b1', 'b3');

		// Donald performed a Layered Gentleman's Discard on Cathy.
		const cathy_slot1 = game.common.thoughts[game.state.hands[PLAYER.CATHY][0]];
		ExAsserts.cardHasInferences(cathy_slot1, ['r2']);
		assert.equal(cathy_slot1.known, true);

		const cathy_slot2 = game.common.thoughts[game.state.hands[PLAYER.CATHY][1]];
		ExAsserts.cardHasInferences(cathy_slot2, ['b1']);
		assert.equal(cathy_slot2.known, true);
	});

	it(`understands a layered gentleman's discard on us`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y1', 'g4', 'b4', 'b2'],
			['r1', 'y4', 'r4', 'y5'],
			['y3', 'r5', 'b1', 'g5']
		], {
			level: { min: 10 }
		});

		takeTurn(game, 'Alice clues yellow to Bob');	// getting y1
		takeTurn(game, 'Bob discards y1', 'y3');
		takeTurn(game, 'Cathy clues 5 to Donald');
		takeTurn(game, 'Donald clues 5 to Cathy');

		takeTurn(game, 'Alice plays b1 (slot 1)');

		// Bob performed a Layered Gentleman's Discard on us. y1 is now expected to be in slot 2.
		const alice_slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		ExAsserts.cardHasInferences(alice_slot2, ['y1']);
		assert.equal(alice_slot2.known, true);
	});

	it(`performs a gentleman's discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g4', 'y2', 'b4'],
			['r5', 'y4', 'r4', 'y3'],
			['b1', 'r4', 'b4', 'g3']
		], {
			level: { min: 10 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues blue to Alice (slots 3,4)');	// b1 in slot 4

		const action = await take_action(game);

		// We should discard b1 as a gentleman's discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });
	});

	it(`performs a layered gentleman's discard`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g4', 'y2', 'b4'],
			['r5', 'y4', 'r4', 'y3'],
			['r1', 'b1', 'r2', 'g3']
		], {
			level: { min: 10 },
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues blue to Alice (slots 3,4)');	// b1 in slot 4

		const action = await take_action(game);

		// We should discard b1 as a layered gentleman's discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][3] });
	});

	it(`doesn't perform a gentleman's discard when chop is trash`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'g4', 'y2', 'y1'],
			['r5', 'y4', 'r4', 'y3'],
			['b4', 'b1', 'r2', 'g3']
		], {
			level: { min: 10 },
			play_stacks: [4, 4, 3, 3, 3],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues blue to Alice (slots 3,4)');	// b1 in slot 4

		const action = await take_action(game);

		// We should just play b4 instead of performing a gentleman's discard.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][3] });
	});
});

describe('baton discards', () => {
	it('understands a baton discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b4', 'g4', 'y2', 'b2'],
			['r1', 'y4', 'r4', 'y3'],
			['y1', 'r4', 'b4', 'b1']
		], {
			level: { min: 10 },
			discarded: ['r4']
		});

		takeTurn(game, 'Alice clues blue to Donald');	// getting b1
		takeTurn(game, 'Bob clues 4 to Donald');		// saving r4
		takeTurn(game, 'Cathy clues yellow to Donald'); // getting y1
		takeTurn(game, 'Donald discards b4', 'b3');

		// Donald performed a Baton Discard on Bob.
		const bob_slot1 = game.common.thoughts[game.state.hands[PLAYER.BOB][0]];
		ExAsserts.cardHasInferences(bob_slot1, ['b4']);
		assert.equal(bob_slot1.known, true);
	});

	it('understands a baton discard on us', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g4', 'y2', 'b2'],
			['r1', 'y4', 'r4', 'y3'],
			['y1', 'r4', 'b4', 'b1']
		], {
			level: { min: 10 },
			discarded: ['r4']
		});

		takeTurn(game, 'Alice clues blue to Donald');	// getting b1
		takeTurn(game, 'Bob clues 4 to Donald');		// saving r4
		takeTurn(game, 'Cathy clues yellow to Donald'); // getting y1
		takeTurn(game, 'Donald discards b4', 'b3');

		// Donald performed a Baton Discard on us.
		const alice_slot1 = game.common.thoughts[game.state.hands[PLAYER.ALICE][0]];
		ExAsserts.cardHasInferences(alice_slot1, ['b4']);
		assert.equal(alice_slot1.known, true);
	});

	it('performs a baton discard', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b3', 'g4', 'y2', 'b2'],
			['r5', 'y4', 'r4', 'y3'],
			['y3', 'r4', 'b4', 'b1']
		], {
			level: { min: 10 },
			discarded: ['r3'],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues blue to Alice (slots 3,4)');	// b1 in slot 4
		takeTurn(game, 'Donald clues 3 to Alice (slots 2,3)');		// r3 save in slot 2, filling in b3 on slot 3

		const action = await take_action(game);

		// We should discard b3 as a baton discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][2] });
	});

	it(`doesn't perform a baton discard to a full player`, async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r4', 'g4', 'y2', 'b4'],
			['b3', 'g5', 'r5', 'y5'],
			['y3', 'r4', 'r2', 'b1']
		], {
			level: { min: 10 },
			discarded: ['r3'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 5 to Cathy');
		takeTurn(game, 'Cathy clues blue to Alice (slots 3,4)');	// b1 in slot 4
		takeTurn(game, 'Donald clues 3 to Alice (slots 2,3)');		// r3 save in slot 2, filling in b3 on slot 3

		const action = await take_action(game);

		// We should not discard b3 as a baton discard.
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][3] });
	});
});

describe('composition finesse', () => {
	it('understands a certain discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'g4', 'y2', 'r4', 'b3'],
			['r3', 'b1', 'r2', 'b5', 'y3']
		], {
			level: { min: 10 },
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays r2 (slot 5)');
		takeTurn(game, 'Bob clues blue to Cathy');

		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');
		takeTurn(game, 'Alice clues red to Bob');				// Composition finesse, getting r3 on Cathy's finesse
		takeTurn(game, 'Bob discards b3', 'y1');

		takeTurn(game, 'Cathy discards r3', 'g2');

		// ALice's red card in slot 5 should be r3.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]], ['r3']);
	});

	it('performs a certain discard', async () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p3', 'p3', 'p5', 'r3', 'r2'],
			['y3', 'g4', 'y2', 'r4', 'b3'],
		], {
			level: { min: 10 },
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Alice clues red to Bob (slots 4,5)');
		takeTurn(game, 'Bob plays r2', 'g2');
		takeTurn(game, 'Cathy clues 5 to Alice (slot 5)');

		takeTurn(game, 'Alice clues 5 to Bob');
		takeTurn(game, 'Bob clues red to Cathy');				// Composition finesse, getting r3 on our finesse
		takeTurn(game, 'Cathy discards b3', 'y1');

		const action = await take_action(game);

		// We should certain discard slot 1 as r3.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][0] });
	});

	it(`doesn't perform an illegal layered certain finesse`, () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'g4', 'y2', 'r4', 'b3'],
			['b1', 'r3', 'r2', 'g3', 'b5']
		], {
			level: { min: 10 },
			play_stacks: [1, 0, 0, 0, 0],
			starting: PLAYER.CATHY
		});

		takeTurn(game, 'Cathy clues red to Alice (slots 4,5)');
		takeTurn(game, 'Alice plays r2 (slot 5)');
		takeTurn(game, 'Bob clues 5 to Cathy');

		takeTurn(game, 'Cathy clues 5 to Alice (slot 4)');

		const { play_clues } = find_clues(game);

		// ALice cannot clue red to Bob, since Bob cannot perform a Certain Discard.
		assert.ok(!play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.RED));
	});
});
