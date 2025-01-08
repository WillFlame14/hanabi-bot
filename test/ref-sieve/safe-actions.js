import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { COLOUR, expandShortCard, PLAYER, setup, takeTurn } from '../test-utils.js';
import RefSieve from '../../src/conventions/ref-sieve.js';
import { ACTION } from '../../src/constants.js';
import { take_action } from '../../src/conventions/playful-sieve/take-action.js';
import { team_elim } from '../../src/basics/helper.js';

import logger from '../../src/tools/logger.js';
import { produce } from '../../src/StateProxy.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('direct rank playables', () => {
	it('prefers to give direct ranks', async () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g1', 'b1', 'g3', 'g4']
		]);

		const action = await take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.RANK, value: 1 });
	});

	it('understands direct ranks are not referential', () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(game, 'Bob clues 1 to Alice (slots 2,3)');

		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][3]].called_to_discard, false);
	});

	it('eliminates direct ranks from focus', () => {
		const game = setup(RefSieve, [
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
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b5', 'y4', 'g2', 'r4', 'y3']
		], {
			starting: PLAYER.BOB,
			play_stacks: [1, 0, 0, 0, 0]
		});

		takeTurn(game, 'Bob clues red to Alice (slots 2,3)');
		takeTurn(game, 'Alice plays b1 (slot 1)');

		// Bob reveals r2 as a safe action.
		takeTurn(game, 'Bob clues 2 to Alice (slots 1,3)');

		// Alice's slot 4 should not be called to discard.
		const slot4 = game.common.thoughts[game.state.hands[PLAYER.ALICE][3]];
		assert.equal(slot4.called_to_discard, false);
	});
});

describe('urgency principle', () => {
	it('doesn\'t give unloaded clues that connect through own hand', async () => {
		const game = setup(RefSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g2', 'y5', 'g5', 'r2', 'p3']
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
