import { strict as assert } from 'node:assert';
import * as Utils from '../src/tools/util.js';
import { logCard } from '../src/tools/log.js';
import { card_elim } from '../src/basics.js';
import { cardCount } from '../src/variants.js';

/**
 * @typedef {import ('../src/basics/State.js').State} State
 * 
 * @typedef SetupOptions
 * @property {number} level
 * @property {number[]} play_stacks
 * @property {string[]} discarded
 * @property {number} clue_tokens
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

	/** @param {State} new_state */
	const init_state = (new_state) => {
		if (options.play_stacks) {
			new_state.play_stacks = options.play_stacks;
			for (let i = 0; i < new_state.numPlayers; i++) {
				new_state.hypo_stacks[i] = options.play_stacks.slice();
			}
		}

		// Initialize discard stacks
		for (const short of options.discarded ?? []) {
			const { suitIndex, rank } = expandShortCard(short);

			new_state.discard_stacks[suitIndex][rank - 1]++;
			console.log('adding to discard stacks', suitIndex, rank);

			// Card is now definitely known to everyone - eliminate
			for (let i = 0; i < new_state.numPlayers; i++) {
				card_elim(new_state, i, suitIndex, rank);
				new_state.hands[i].refresh_links();
			}

			// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
			if (new_state.discard_stacks[suitIndex][rank - 1] === cardCount(new_state.suits[suitIndex], rank) && new_state.max_ranks[suitIndex] > rank - 1) {
				new_state.max_ranks[suitIndex] = rank - 1;
			}
		}

		new_state.clue_tokens = options.clue_tokens ?? 8;

		if (options.init) {
			options.init(new_state);
		}
	}

	init_state(state);
	console.log('reading dc stacks', state.discard_stacks[2]);

	/** @this {State} */
	function injectBlank() {
		this.createBlankDefault = this.createBlank;
		this.createBlank = function () {
			const new_state = this.createBlankDefault();
			init_state(new_state);
			injectBlank.bind(new_state)();
			return new_state;
		}
	}

	// Inject initialize statements into createBlank
	injectBlank.bind(state)();
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
 * @param  {import('../src/basics/Card.js').Card} card 	The card to check inferences of.
 * @param  {string[]} inferences 						The set of inferences to compare to.
 */
export function assertCardHasInferences(card, inferences) {
	const message = `Differing inferences. Expected ${inferences}, got ${card.inferred.map(c => logCard(c))}`;

	assert.ok(card.inferred.length === inferences.length && inferences.every(inf => {
		const { suitIndex, rank } = expandShortCard(inf);

		return card.inferred.some(c => c.matches(suitIndex, rank));
	}), message);
}
