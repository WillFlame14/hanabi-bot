import { strict as assert } from 'node:assert';
import * as Utils from '../src/tools/util.js';
import { logAction, logCard } from '../src/tools/log.js';
import { card_elim } from '../src/basics.js';
import { cardCount } from '../src/variants.js';

/**
 * @typedef {import ('../src/basics/State.js').State} State
 * @typedef {import('../src/basics/Card.js').Card} Card
 * @typedef {import('../src/types.js').Action} Action
 * 
 * @typedef SetupOptions
 * @property {number} level
 * @property {number[]} play_stacks
 * @property {string[]} discarded
 * @property {number} clue_tokens
 * @property {number} starting
 * @property {(state: State) => void} init
 */

export const COLOUR = /** @type {const} */ ({
	RED: 0,
	YELLOW: 1,
	GREEN: 2,
	BLUE: 3,
	PURPLE: 4
});

export const PLAYER = /** @type {const} */ ({
	ALICE: 0,
	BOB: 1,
	CATHY: 2,
	DONALD: 3,
	EMILY: 4
});

const names = ['Alice', 'Bob', 'Cathy', 'Donald', 'Emily'];
const suits = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'];

/**
 * Initializes the state according to the options provided.
 * @param {State} state
 * @param {Partial<SetupOptions>} options
 */
function init_state(state, options) {
	if (options.play_stacks) {
		state.play_stacks = options.play_stacks;
		for (let i = 0; i < state.numPlayers; i++) {
			state.hypo_stacks[i] = options.play_stacks.slice();
		}
	}

	// Initialize discard stacks
	for (const short of options.discarded ?? []) {
		const { suitIndex, rank } = expandShortCard(short);

		state.discard_stacks[suitIndex][rank - 1]++;

		// Card is now definitely known to everyone - eliminate
		for (let i = 0; i < state.numPlayers; i++) {
			card_elim(state, i, suitIndex, rank);
			state.hands[i].refresh_links();
		}

		// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
		if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank) && state.max_ranks[suitIndex] > rank - 1) {
			state.max_ranks[suitIndex] = rank - 1;
		}
	}

	state.currentPlayerIndex = options.starting ?? 0;
	state.clue_tokens = options.clue_tokens ?? 8;

	if (options.init) {
		options.init(state);
	}
}

/**
 * Injects extra statements into state functions for ease of testing.
 * @this {State}
 * @param {Partial<SetupOptions>} options
 */
function injectFuncs(options) {
	this.createBlankDefault = this.createBlank;
	this.createBlank = function () {
		const new_state = this.createBlankDefault();
		init_state(new_state, options);
		injectFuncs.bind(new_state)(options);
		return new_state;
	};
}

/**
 * Helper function for taking an action.
 * @param {State} state
 * @param {Action} action
 * @param {string} [draw] 		The card to draw after taking an action (can be omitted if we are drawing).
 */
export function takeTurn(state, action, draw = 'xx') {
	// We only care about the turn taker of these 3 actions
	const turnTaker = action.type === 'clue' ? action.giver :
						action.type === 'play' ? action.playerIndex :
						action.type === 'discard' ? action.playerIndex : state.currentPlayerIndex;

	if (turnTaker !== state.currentPlayerIndex) {
		const expectedPlayer = state.playerNames[state.currentPlayerIndex];
		throw new Error(`Expected ${expectedPlayer}'s turn for action (${logAction(action)}), test written incorrectly?`);
	}

	state.handle_action(action);

	if (action.type === 'play' || action.type === 'discard') {
		if (draw === 'xx' && state.currentPlayerIndex !== state.ourPlayerIndex) {
			throw new Error(`Missing draw for ${state.playerNames[state.currentPlayerIndex]}'s action (${logAction(action)}).`);
		}

		const { suitIndex, rank } = expandShortCard(draw);
		state.handle_action({ type: 'draw', playerIndex: state.currentPlayerIndex, order: state.cardOrder + 1, suitIndex, rank });
	}

	const nextPlayerIndex = (state.currentPlayerIndex + 1) % state.numPlayers;
	state.handle_action({ type: 'turn', num: state.turn_count + 1, currentPlayerIndex: nextPlayerIndex });
}

/**
 * @template {State} A
 * @param {{new(...args: any[]): A}} StateClass
 * @param {string[][]} hands
 * @param {Partial<SetupOptions>} options
 * @returns {A}
 */
export function setup(StateClass, hands, options = {}) {
	const playerNames = names.slice(0, hands.length);

	const state = new StateClass(-1, playerNames, 0, suits, false, options.level ?? 1);
	Utils.globalModify({state});

	let orderCounter = 0;

	// Draw all the hands
	for (let playerIndex = 0; playerIndex < hands.length; playerIndex++) {
		const hand = hands[playerIndex];
		for (const short of hand.reverse()) {
			const { suitIndex, rank } = expandShortCard(short);

			state.handle_action({ type: 'draw', order: orderCounter, playerIndex, suitIndex, rank });
			orderCounter++;
		}
	}

	init_state(state, options);
	injectFuncs.bind(state)(options);

	return state;
}

/**
 * @param {string} short
 */
export function expandShortCard(short) {
	return {
		suitIndex: ['x', 'r', 'y', 'g', 'b', 'p'].indexOf(short[0]) - 1,
		rank: Number(short[1]) || -1
	};
}

/**
 * @param  {Card} card 				The card to check inferences of.
 * @param  {string[]} inferences 	The set of inferences to compare to.
 */
export function assertCardHasInferences(card, inferences) {
	const message = `Differing inferences. Expected ${inferences}, got ${card.inferred.map(c => logCard(c))}`;

	assert.ok(card.inferred.length === inferences.length && inferences.every(inf => {
		const { suitIndex, rank } = expandShortCard(inf);

		return card.inferred.some(c => c.matches(suitIndex, rank));
	}), message);
}
