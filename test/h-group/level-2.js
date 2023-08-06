import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, assertCardHasInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { CLUE } from '../../src/constants.js';
import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('self-finesse', () => {
	it('does not give bad self-finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'g2', 'g4', 'r4', 'g3'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], 2);

		state.play_stacks = [1, 3, 0, 1, 2];
		state.hypo_stacks = Array(3).fill([1, 3, 0, 1, 2]);

		// Bob clues Cathy green, touching slot 1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.GREEN }, giver: PLAYER.BOB, list: [14], target: PLAYER.CATHY });

		const { play_clues } = find_clues(state);

		// 3 to Bob is not a valid clue.
		assert.equal(play_clues[PLAYER.BOB].some(clue => clue.type === CLUE.RANK && clue.value === 3), false);
	});

	it('plays correctly into self-finesses', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g1', 'b3', 'r2', 'y3', 'p3']
		], 2);

		// Bob clues Alice 2, touching slot 2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [3], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays slot 1. It is g1.
		state.handle_action({ type: 'play', playerIndex: PLAYER.ALICE, suitIndex: COLOUR.GREEN, rank: 1, order: 4 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.ALICE, suitIndex: -1, rank: -1, order: 11 });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Slot 2 should be g2.
		assertCardHasInferences(state.hands[PLAYER.ALICE][1], ['g2']);
	});

	it('interprets self-finesses correctly when giver knows less', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r1', 'g4', 'b1', 'g3'],
			['g1', 'g2', 'r5', 'y3', 'p3']
		], 2);

		// Alice clues Bob 1, touching r1 and b1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6,8], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues Cathy 2, touching r2,g2 as a Self-Finesse.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [13], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

		// Cathy's slot 1 should be finessed.
		assert.equal(state.hands[PLAYER.CATHY][0].finessed, true);

		// Alice's slot 1 should not.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
	});
});

describe('asymmetric clues', () => {
	it('understands delayed play clues through asymetrically known cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['b2', 'b4', 'r4', 'r5'],
			['g4', 'y3', 'r4', 'p2'],
			['g3', 'g2', 'p3', 'b3']
		], 2);

		// b1 has been played. We hold a b2 in our hand.
		state.play_stacks = [0, 0, 0, 1, 0];
		state.hypo_stacks = Array(4).fill([0, 0, 0, 1, 0]);

		// Cathy clues blue to Donald, finessing b2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.BLUE }, giver: PLAYER.CATHY, list: [12], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.DONALD });

		// Donald clues 4 to Bob, getting b4. Donald knows that he has b3 and not b2 since he can see Bob's b2 and ours.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.DONALD, list: [5,6], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// We think we have b3 in slot 1, as a Certain Finesse. 
		assertCardHasInferences(state.hands[PLAYER.ALICE][0], ['b3']);

		// We clue 5 to Bob to save r5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.ALICE, list: [4], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

		// Bob plays b2 to satisfy the finesse and draws y5.
		state.handle_action({ type: 'play', playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 2, order: 7 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.BOB, suitIndex: COLOUR.YELLOW, rank: 5, order: 16 });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 5 to Bob.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [4,16], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.DONALD });

		// Donald plays b3 and draws r2.
		state.handle_action({ type: 'play', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.BLUE, rank: 3, order: 12 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 2, order: 17 });
		state.handle_action({ type: 'turn', num: 6, currentPlayerIndex: PLAYER.ALICE });

		// We should no longer think that we have b3 in slot 1.
		assert.equal(state.hands[PLAYER.ALICE][0].inferred.length > 1, true);
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);
	});

	it('understands multiple interpretations when connecting through multiple possible cards in other hand', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'b4', 'g3', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'g5', 'y1', 'b4']
		], 2);

		// Bob clues 1 to Donald.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [13,15], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 3 to Bob, connecting on g1 (Donald, playable) and g2 (Bob, finesse).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.CATHY, list: [5], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.DONALD });

		// Bob's slot 1 can be either g2 or y2, since he doesn't know which 1 is connecting.
		assertCardHasInferences(state.hands[PLAYER.BOB][0], ['y2', 'g2']);
	});

	it('prefers the least number of blind plays on target', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['y3', 'b2', 'y4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], 2);

		// y1 is played.
		state.play_stacks = [0, 1, 0, 0, 0];

		// Alice clues yellow to Donald, getting y2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.ALICE, list: [13,14], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues 1 to Donald, getting g1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [15], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 4 to Bob, connecting on y2 (Donald, known) and y3 (Bob, finesse).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.CATHY, list: [5], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.DONALD });

		// Bob's slot 1 must be y3, since it only requires one blind play (y3) instead of two (g2,g3).
		assertCardHasInferences(state.hands[PLAYER.BOB][0], ['y3']);
	});

	it('includes the correct interpretation, even if it requires more blind plays', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['g2', 'g3', 'g4', 'r3'],
			['g4', 'y3', 'r4', 'p2'],
			['g1', 'y2', 'y5', 'b4']
		], 2);

		// y1 is played.
		state.play_stacks = [0, 1, 0, 0, 0];

		// Alice clues yellow to Donald, getting y2.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.YELLOW }, giver: PLAYER.ALICE, list: [13,14], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });

		// Bob clues 1 to Donald, getting g1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [15], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });

		// Cathy clues 4 to Bob, connecting on g2 (Bob, finesse) and g3 (Bob, finesse).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 4 }, giver: PLAYER.CATHY, list: [5], target: PLAYER.BOB });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.DONALD });

		// Although y3 should still be preferred, the correct inference is g2 -> g3 double self-finesse.
		assertCardHasInferences(state.hands[PLAYER.BOB][0], ['g2','y3']);
	});

	it('connects when a card plays early', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
			['p5', 'y4', 'r1', 'b3'],
			['p1', 'p2', 'y3', 'y1'],
			['g1', 'g5', 'y1', 'b5']
		], 2);

		// Donald clues 2 to Alice, touching slot 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.DONALD, list: [0], target: PLAYER.ALICE });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice clues 1 to Donald, getting g1, y1.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [13,15], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.BOB });

		// Bob clues 3 to Cathy, connecting on y1 (Donald, playable) and y2 (Alice, prompt).
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 3 }, giver: PLAYER.BOB, list: [9], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.CATHY });

		// The clued card is likely g3 or y3, since that requires the least number of blind plays.
		assertCardHasInferences(state.hands[PLAYER.CATHY][2], ['y3', 'g3']);

		// Cathy gives a 5 Save to Donald.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [12], target: PLAYER.DONALD });
		state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.DONALD });

		// Donald plays y1 and draws r4.
		state.handle_action({ type: 'play', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.YELLOW, rank: 1, order: 13 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 4, order: 16 });
		state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

		// Alice plays y2 and draws b1.
		state.handle_action({ type: 'play', playerIndex: PLAYER.ALICE, suitIndex: COLOUR.YELLOW, rank: 2, order: 0 });
		state.handle_action({ type: 'draw', playerIndex: PLAYER.ALICE, suitIndex: COLOUR.BLUE, rank: 1, order: 17 });
		state.handle_action({ type: 'turn', num: 6, currentPlayerIndex: PLAYER.BOB });

		// y3 should be known, since y2 played before g1 played.
		assertCardHasInferences(state.hands[PLAYER.CATHY][2], ['y3']);
	});
});
