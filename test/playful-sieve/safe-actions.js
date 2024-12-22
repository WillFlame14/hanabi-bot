import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { COLOUR, expandShortCard, PLAYER, setup, takeTurn } from '../test-utils.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';
import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';
import { team_elim } from '../../src/basics/helper.js';

import logger from '../../src/tools/logger.js';
import { logPerformAction } from '../../src/tools/log.js';
import { produce } from '../../src/StateProxy.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('direct rank playables', () => {
	it('prefers to give direct ranks', async () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g1', 'b1', 'g3', 'g4']
		]);

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, value: 1 });
	});

	it('understands direct ranks are not referential', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3)');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]].called_to_discard, false);
	});

	it('eliminates direct ranks from focus', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 1, 0, 1, 1]
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3)');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]].called_to_discard, false);
		ExAsserts.cardHasInferences(game.common.thoughts[game.state.hands[PLAYER.ALICE][1]], ['g1']);

		// Alice's slot 3 should be trash
		const trash = game.common.thinksTrash(game.state, PLAYER.ALICE);
		assert.ok(trash.includes(game.state.hands[PLAYER.ALICE][2]));
	});

	it('understands playable fill-ins are not referential', () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Bob clues red to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays b1 (slot 4)');

		// Bob reveals r2 as a safe action.
		takeTurn(game, 'Bob clues 2 to Alice (slots 1,4)');

		// Alice's slot 2 should not be called to discard.
		const slot2 = game.common.thoughts[game.state.hands[PLAYER.ALICE][1]];
		assert.equal(slot2.called_to_discard, false);
	});
});

describe('connecting cards', () => {
	it('plays connections to cm cards', async () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'y4', 'g3', 'r4', 'r4']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Bob clues green to Alice (slot 1)');
		takeTurn(game, 'Alice plays b1 (slot 2)');
		takeTurn(game, 'Bob clues 2 to Alice (slot 2)');
		takeTurn(game, 'Alice discards r1 (slot 1)');
		// Alice now has known g2.

		takeTurn(game, 'Bob plays g1', 'r2');
		takeTurn(game, 'Alice clues 3 to Bob');
		takeTurn(game, 'Bob discards r4 (slot 4)', 'b1');
		takeTurn(game, 'Alice clues green to Bob');
		takeTurn(game, 'Bob discards b1', 'r5');
		// Bob now has known g3.

		// Alice should play g2 to automatically cm r5.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][1] }, logPerformAction(action));
	});

	it('plays connections to a 1-away chop', async () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'y4', 'g3', 'r4', 'r4']
		], {
			init: (game) => {
				const { common, state } = game;

				// Alice has a fully known g1 in slot 2
				const order = state.hands[PLAYER.ALICE][1];
				const { possible, inferred } = common.thoughts[order];
				common.updateThoughts(order, (draft) => {
					draft.clued = true;
					draft.possible = possible.intersect([{ suitIndex: 2, rank: 1 }]);
					draft.inferred = inferred.intersect([{ suitIndex: 2, rank: 1 }]);
				});
			}
		});

		team_elim(game);
		game.common.update_hypo_stacks(game.state);

		// Alice should play g1 to make g2 playable.
		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][1] }, logPerformAction(action));
	});
});

describe('urgency principle', () => {
	it('doesn\'t give unloaded clues that connect through own hand', async () => {
		const game = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'y5', 'g5', 'p3', 'r2']
		], {
			init: (game) => {
				// Alice has a fully known r1 in slot 2
				const order = game.state.hands[PLAYER.ALICE][1];
				const card = game.common.thoughts[order];
				const { possible, inferred } = card;

				game.state.deck = game.state.deck.with(order, produce(game.state.deck[order], (draft) => { draft.clued = true; }));

				game.common.updateThoughts(order, (draft) => {
					draft.clued = true;
					draft.possible = possible.intersect([expandShortCard('r1')]);
					draft.inferred = inferred.intersect([expandShortCard('r1')]);
				});

				team_elim(game);
				game.common.update_hypo_stacks(game.state);
			}
		});

		// Alice should not give purple.
		const action = await take_action(game);
		assert.ok(!(action.type === ACTION.COLOUR && action.value === COLOUR.PURPLE));
	});
});
