import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as ExAsserts from '../extra-asserts.js';

import { ACTION } from '../../src/constants.js';
import { PLAYER, setup, takeTurn } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('positional discards', () => {
	it('plays from a positional discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy discards g1', 'b3');

		// Alice's slot 3 should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, true);

		// Alice should play slot 3.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][2].order });
	});

	it('does not play from a positional discard to someone after them', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy discards g1', 'b3');

		// Alice's slot 3 not should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, false);
	});

	it('does not play from a positional discard if someone before them played into it', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'p5', 'g1', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.BOB,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Bob discards r2', 'g3');

		// Cathy's slot 3 should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][2].order].finessed, true);

		takeTurn(game, 'Cathy plays p5', 'b3');

		// Alice's slot 3 should not be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, false);
	});

	it('does not play from a chop discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy discards p1', 'b3');

		// Alice's slot 5 not should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, false);
	});

	it('does not play from a normal discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy discards p1', 'b3');

		// Alice's slot 5 not should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, false);
	});

	it('plays from a positional discard if someone before them did not play into it', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'p5', 'g1', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.BOB,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Bob discards r2', 'g3');
		takeTurn(game, 'Cathy discards p1', 'b3');

		// Alice's slot 3 should be "finessed" from a positional discard.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, true);
	});

	it('recognizes a positional discard on the correct player', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'b5', 'b1'],
			['b1', 'b2', 'g5', 'g1'],
			['g1', 'g3', 'r3', 'p4'],
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.DONALD,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Donald discards r3', 'b3');

		// Cathy's slot 3 should be "finessed" from a positional discard, while Bob's should not.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.CATHY][2].order].finessed, true);
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.BOB][2].order].finessed, false);
	});

	it('performs a positional discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'b5', 'b1'],
			['b1', 'b2', 'r2', 'g1'],
			['g1', 'g3', 'r3', 'p4'],
		], {
			level: { min: 8 },
			play_stacks: [5, 5, 5, 4, 5],
			clue_tokens: 0,
			init: (game) => {
				game.state.cardsLeft = 0;
				game.state.early_game = false;
			}
		});

		const action = take_action(game);

		// Alice should discard slot 3 as a positional discard.
		ExAsserts.objHasProperties(action, { type: ACTION.DISCARD, target: game.state.hands[PLAYER.ALICE][2].order });
	});
});

describe('positional misplays', () => {
	it('plays from a positional misplay', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy bombs p1', 'b3');

		// Alice's slot 5 should be "finessed" from a positional misplay.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][4].order].finessed, true);

		// Alice should play slot 3.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][4].order });
	});

	it('plays from a double positional misplay', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'r4', 'p1']
		], {
			level: { min: 8 },
			play_stacks: [4, 4, 4, 4, 4],
			starting: PLAYER.CATHY,
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 2;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Cathy bombs g1', 'b3');

		// Alice's slot 3 should be "finessed" from a positional misplay.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][2].order].finessed, true);

		// Alice should play slot 3.
		const action = take_action(game);
		ExAsserts.objHasProperties(action, { type: ACTION.PLAY, target: game.state.hands[PLAYER.ALICE][2].order });
	});
});

describe('mistake discards', () => {
	it('does not bomb from a useless positional discard', () => {
		const game = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'b5', 'b4'],
			['g2', 'b3', 'r5', 'p2', 'p3']
		], {
			level: { min: 8 },
			play_stacks: [4, 5, 5, 4, 5],
			clue_tokens: 1,
			init: (game) => {
				game.state.cardsLeft = 1;
				game.state.early_game = false;
			}
		});

		takeTurn(game, 'Alice clues red to Cathy');
		takeTurn(game, 'Bob discards g4', 'r1');

		// Alice should not attempt to play with no known playables.
		assert.equal(game.common.thoughts[game.state.hands[PLAYER.ALICE][0].order].finessed, false);
	});
});
