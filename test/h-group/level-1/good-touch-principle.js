import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, setup, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';
import { logCard } from '../../../src/tools/log.js';
import { find_clues } from '../../../src/conventions/h-group/clue-finder/clue-finder.js';
import { CLUE } from '../../../src/constants.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('good touch principle', () => {
	it('eliminates from focus correctly (direct play)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'r4', 'r2', 'y4', 'y2']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 0, 4],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 4,5)');

		logger.info(game.common.thoughts[0].inferred.map(logCard).join());

		// Our slot 5 should be p5, and our slot 4 should be (global) trash.
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]], ['p5']);
		assert.ok(game.common.thinksTrash(game.state, PLAYER.ALICE).includes(game.state.hands[PLAYER.ALICE][3]));
	});

	it('eliminates from focus correctly (direct save)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 2, 0, 0],
			discarded: ['g4'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues green to Alice (slots 3,4,5)');

		// Our slot 5 should be g4, and our slots 2 and 3 should have no inferences (to us).
		ExAsserts.cardHasInferences(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][4]], ['g4']);
		const trash = game.players[PLAYER.ALICE].thinksTrash(game.state, PLAYER.ALICE);
		assert.ok([2,3].every(i => trash.includes(game.state.hands[PLAYER.ALICE][i])));
	});

	it('eliminates from indirect focus', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'b2', 'p2', 'r1'],
			['y3', 'r4', 'y2', 'p1', 'g3']
		], {
			level: { min: 1 },
			play_stacks: [5, 2, 5, 3, 5],
			discarded: ['y4'],
			starting: PLAYER.BOB
		});

		const { state } = game;

		takeTurn(game, 'Bob clues 4 to Alice (slots 3,5)');

		// The two 4's in Alice's hand should be inferred y4,b4.
		ExAsserts.cardHasInferences(game.common.thoughts[state.hands[PLAYER.ALICE][2]], ['y4', 'b4']);
		ExAsserts.cardHasInferences(game.common.thoughts[state.hands[PLAYER.ALICE][4]], ['y4', 'b4']);

		takeTurn(game, 'Cathy clues 4 to Bob');		// getting b4

		// Aice's slot 5 should be y4 only, and slot 3 should have no inferences.
		assert.ok(game.common.thinksTrash(state, PLAYER.ALICE).includes(state.hands[PLAYER.ALICE][2]));
		ExAsserts.cardHasInferences(game.common.thoughts[state.hands[PLAYER.ALICE][4]], ['y4']);
	});

	it('eliminates from focus and gets known trash', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'r4', 'y2', 'p1', 'g3']
		], {
			level: { min: 1 },
			play_stacks: [4, 0, 0, 0, 0],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues red to Alice (slots 4,5)');

		const trash = game.common.thinksTrash(game.state, PLAYER.ALICE);
		assert.ok(trash[0] === 1);
	});

	it('generates a link from GTP', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 0, 3],
			strikes: 2,
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5.
		const expected_links = [{ orders: [2, 1], identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(game.players[PLAYER.ALICE].links, expected_links);
		assert.deepEqual(game.common.links, expected_links);

		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);
		assert.deepEqual(playables, []);
	});

	it('cleans up links properly (indirect clue)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ orders: [2, 1], identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(game.players[PLAYER.ALICE].links, expected_links);

		takeTurn(game, 'Bob clues 5 to Alice (slot 3)');

		// Link should be gone now
		assert.deepEqual(game.players[PLAYER.ALICE].links, []);

		const trash = game.common.thinksTrash(game.state, PLAYER.ALICE);
		assert.deepEqual(trash, [2, 1]);
	});

	it('cleans up links properly (direct clue)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ orders: [2, 1], identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(game.players[PLAYER.ALICE].links, expected_links);

		takeTurn(game, 'Bob clues 5 to Alice (slot 5)');

		// Link should be gone now
		assert.deepEqual(game.players[PLAYER.ALICE].links, []);

		const trash = game.common.thinksTrash(game.state, PLAYER.ALICE);
		assert.deepEqual(trash, [2]);
	});

	it('cleans up links properly (card drawn)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r5', 'g3', 'g3', 'g5', 'y2'],
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 0, 0, 3],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice plays p4 (slot 5)');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p5 (see previous test).
		const expected_links = [{ orders: [2, 1], identities: ['p5'].map(expandShortCard), promised: false }];
		assert.deepEqual(game.players[PLAYER.ALICE].links, expected_links);

		takeTurn(game, 'Bob discards y2', 'p5');

		// Link should be gone now
		assert.deepEqual(game.players[PLAYER.ALICE].links, []);

		const trash = game.players[PLAYER.ALICE].thinksTrash(game.state, PLAYER.ALICE);
		assert.deepEqual(trash, [2, 1]);
	});

	it('cleans up links properly (card bombed)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p5', 'p4', 'p4', 'p3', 'p3'],
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues purple to Alice (slots 3,4,5)');
		takeTurn(game, 'Alice plays p1 (slot 5)');
		takeTurn(game, 'Bob discards p3 (slot 5)', 'p2');

		// There should be a link between slots 4 and 5 (previously 3 and 4) for p2.
		const expected_links = [{ orders: [2, 1], identities: ['p2'].map(expandShortCard), promised: false }];
		assert.deepEqual(game.players[PLAYER.ALICE].links, expected_links);

		takeTurn(game, 'Alice bombs p1 (slot 5)');

		// Link should be gone now, Alice's new slot 5 should be p2.
		assert.deepEqual(game.players[PLAYER.ALICE].links, []);
		ExAsserts.cardHasInferences(game.players[PLAYER.ALICE].thoughts[game.state.hands[PLAYER.ALICE][4]], ['p2']);
	});

	it('plays from focus (no link)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'r2', 'p4', 'p3', 'b1'],
		], {
			level: { min: 1 },
			play_stacks: [5, 5, 1, 5, 5],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 1,3)');

		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);
		assert.deepEqual(playables, [4]);
	});

	it('plays from focus (link)', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p1', 'r2', 'p4', 'p3', 'b1'],
		], {
			level: { min: 1 },
			play_stacks: [5, 5, 1, 5, 5],
			discarded: ['g2'],
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 2 to Alice (slots 1,3)');

		const playables = game.common.thinksPlayables(game.state, PLAYER.ALICE);
		assert.deepEqual(playables, [4]);
	});

	it('assumes good touch even when others are playing unknown cards', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y3', 'p2', 'g4', 'p1', 'g2']
		], {
			level: { min: 1 },
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slot 5)');
		takeTurn(game, 'Alice clues 1 to Bob');
		takeTurn(game, 'Bob plays p1', 'p4');

		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][4]], ['r1', 'y1', 'g1', 'b1']);
	});

	it('counts bad touch correctly', () => {
		const game =  setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'p2', 'g3', 'p1'],
			['g4', 'g3', 'r1', 'g4'],
			['r2', 'r5', 'p1', 'r3']
		], {
			level: { min: 1 },
			play_stacks: [0, 0, 2, 0, 0],
			starting: PLAYER.DONALD
		});

		takeTurn(game, 'Donald clues green to Bob');

		const { play_clues } = find_clues(game);

		// Green to Cathy has 2 bad touch.
		const green_cathy = play_clues[PLAYER.CATHY].find(clue => clue.type === CLUE.COLOUR && clue.value === COLOUR.GREEN);
		assert.ok(green_cathy !== undefined);
		assert.deepEqual(green_cathy.result.bad_touch, [0, 1].map(i => game.state.hands[PLAYER.CATHY][i]));
	});
});
