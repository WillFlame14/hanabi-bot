import { CLUE, MAX_H_LEVEL } from '../src/constants.js';
import { State } from '../src/basics/State.js';
import { cardCount, shortForms } from '../src/variants.js';
import * as Utils from '../src/tools/util.js';

import { logAction, logCard, logClue } from '../src/tools/log.js';
import { team_elim } from '../src/basics/helper.js';

/**
 * @typedef {import('../src/basics/Game.js').Game} Game
 * @typedef {import('../src/types.js').Action} Action
 * @typedef {import('../src/variants.js').Variant} Variant
 * 
 * @typedef SetupOptions
 * @property {{min?: number, max?: number}} level
 * @property {number} ourPlayerIndex
 * @property {number[]} play_stacks
 * @property {string[]} discarded
 * @property {number} strikes
 * @property {number} clue_tokens
 * @property {number} starting
 * @property {Variant} variant
 * @property {(game: Game) => void} init
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

export const VARIANTS = /** @type {Record<string, Variant>} */ ({
	NO_VARIANT: { id: 0, name: 'No Variant', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Purple'] },
	SIX_SUITS: { id: 1, name: '6 Suits', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Teal'] },
	RAINBOW: { id: 16,  name: 'Rainbow (5 Suits)', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Rainbow'] },
	BLACK: { id: 21,  name: 'Black (5 Suits)', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Black'] },
	WHITE: { id: 22,  name: 'White (5 Suits)', suits: ['Red', 'Yellow', 'Green', 'Blue', 'White'] },
	BROWN: { id : 70,  name: "Brown (5 Suits)", suits: ["Red", "Yellow", "Green", "Blue", "Brown"] },
	PINK: { id: 107, name: 'Pink (5 Suits)', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Pink'] },
	PRISM: { id: 1465, name: 'Prism (5 Suits)', suits: ['Red', 'Yellow', 'Green', 'Blue', 'Prism'] }
});

const DEFAULT_LEVEL = parseInt(process.env['HANABI_LEVEL'] ?? '1');

const sampleColours = /** @type {const} */ ({
	'Rainbow': 'm',
	'Muddy Rainbow': 'm',
	'Light Pink': 'i',
	'Prism': 'i',
	'Dark Rainbow': 'm',
	'Dark Pink': 'i',
	'Gray': 'a',
	'Dark Brown': 'n',
	'Dark Omni': 'o',
	'Dark Null': 'u',
	'Cocoa Rainbow': 'm',
	'Gray Pink': 'i',
	'Dark Prism': 'i',
	'Forest': 'r',
	'Sapphire EA': 'a',
	'Forest AD': 'r'
});

const names = ['Alice', 'Bob', 'Cathy', 'Donald', 'Emily'];

/** @type {string[]} */
let testShortForms;

/**
 * @param {string} short
 */
export function expandShortCard(short) {
	return {
		suitIndex: testShortForms.indexOf(short[0]) - 1,
		rank: Number(short[1]) || -1
	};
}

/**
 * Initializes the game according to the options provided.
 * @param {Game} game
 * @param {Partial<SetupOptions>} options
 */
function init_game(game, options) {
	const { common, state } = game;

	if (options.play_stacks) {
		state.play_stacks = options.play_stacks.slice();
		for (let i = 0; i < state.numPlayers; i++)
			game.players[i].hypo_stacks = options.play_stacks.slice();

		common.hypo_stacks = options.play_stacks.slice();
	}

	// Initialize discard stacks
	for (const short of options.discarded ?? []) {
		const identity = expandShortCard(short);
		const { suitIndex, rank } = identity;

		state.discard_stacks[suitIndex][rank - 1]++;

		// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
		if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, identity) && state.max_ranks[suitIndex] > rank - 1)
			state.max_ranks[suitIndex] = rank - 1;
	}

	for (const player of game.allPlayers)
		player.card_elim(state);

	state.currentPlayerIndex = options.starting ?? 0;
	state.clue_tokens = options.clue_tokens ?? 8;
	state.strikes = options.strikes ?? 0;

	if (options.init)
		game.hookAfterDraws = options.init;
}

/**
 * Injects extra statements into state functions for ease of testing.
 * @this {Game}
 * @param {Partial<SetupOptions>} options
 */
function injectFuncs(options) {
	// @ts-ignore
	this.createBlankDefault = this.createBlank;
	this.createBlank = function () {
		// @ts-ignore
		const new_game = this.createBlankDefault();

		init_game(new_game, options);
		injectFuncs.bind(new_game)(options);
		return new_game;
	};

	// @ts-ignore
	this.minimalCopyDefault = this.minimalCopy;
	this.minimalCopy = function () {
		// @ts-ignore
		const new_game = this.minimalCopyDefault();

		injectFuncs.bind(new_game)(options);
		return new_game;
	};
}

/**
 * @template {Game} A
 * @param {{new(...args: any[]): A}} GameClass
 * @param {string[][]} hands
 * @param {Partial<SetupOptions>} test_options
 * @returns {A}
 */
export function setup(GameClass, hands, test_options = {}) {
	const playerNames = names.slice(0, hands.length);
	const variant = test_options.variant ?? VARIANTS.NO_VARIANT;

	// Overwrite the global short forms
	shortForms.length = 0;

	for (const suitName of variant.suits) {
		if (['Black', 'Pink', 'Brown'].includes(suitName)) {
			shortForms.push(['k', 'i', 'n'][['Black', 'Pink', 'Brown'].indexOf(suitName)]);
		}
		else {
			const abbreviation = sampleColours[suitName] ?? suitName.charAt(0).toLowerCase();
			if (shortForms.includes(abbreviation))
				shortForms.push(suitName.toLowerCase().split('').find(char => !shortForms.includes(char)));
			else
				shortForms.push(abbreviation);
		}
	}

	testShortForms = shortForms.toSpliced(0, 0, 'x');

	const state = new State(playerNames, test_options.ourPlayerIndex ?? PLAYER.ALICE, variant, {});
	const [minLevel, maxLevel] = [test_options?.level?.min ?? 1, test_options?.level?.max ?? MAX_H_LEVEL];
	const game = new GameClass(-1, state, false, Math.min(Math.max(minLevel, DEFAULT_LEVEL), maxLevel));
	game.catchup = true;
	Utils.globalModify({ game, cache: new Map() });

	let orderCounter = 0;

	// Draw all the hands
	for (let playerIndex = 0; playerIndex < hands.length; playerIndex++) {
		const hand = hands[playerIndex];
		for (const short of hand.toReversed()) {
			const { suitIndex, rank } = expandShortCard(short);

			game.handle_action({ type: 'draw', order: orderCounter, playerIndex, suitIndex, rank });
			orderCounter++;
		}
	}

	init_game(game, test_options);
	injectFuncs.bind(game)(test_options);

	game.hookAfterDraws(game);

	for (const player of game.players)
		player.card_elim(state);

	team_elim(game);

	return game;
}

/**
 * Helper function for taking an action.
 * @param {Game} game
 * @param {string} rawAction
 * @param {string} [draw] 		The card to draw after taking an action (can be omitted if we are drawing).
 */
export function takeTurn(game, rawAction, draw = 'xx') {
	const { state } = game;
	const action = parseAction(state, rawAction);

	// We only care about the turn taker of these 3 actions
	const turnTaker = action.type === 'clue' ? action.giver :
						action.type === 'play' ? action.playerIndex :
						action.type === 'discard' ? action.playerIndex : state.currentPlayerIndex;

	if (turnTaker !== state.currentPlayerIndex) {
		const expectedPlayer = state.playerNames[state.currentPlayerIndex];
		throw new Error(`Expected ${expectedPlayer}'s turn for action (${logAction(action)}), test written incorrectly?`);
	}

	game.catchup = true;
	game.handle_action(action);

	if (action.type === 'play' || action.type === 'discard') {
		if (draw === 'xx' && state.currentPlayerIndex !== state.ourPlayerIndex)
			throw new Error(`Missing draw for ${state.playerNames[state.currentPlayerIndex]}'s action (${logAction(action)}).`);

		const { suitIndex, rank } = expandShortCard(draw);
		game.handle_action({ type: 'draw', playerIndex: state.currentPlayerIndex, order: state.cardOrder + 1, suitIndex, rank });
	}

	const nextPlayerIndex = state.nextPlayerIndex(state.currentPlayerIndex);
	game.handle_action({ type: 'turn', num: state.turn_count, currentPlayerIndex: nextPlayerIndex });

	game.catchup = false;
}

/**
 * Parses slot numbers from the separated parts.
 * @param {State} state
 * @param {string[]} parts
 * @param {number} partsIndex 		The index to start parsing from.
 * @param {boolean} expectOne 		A flag saying whether to only expect one slot.
 * @param {string} insufficientMsg 	An additional message to show if insufficient arguments are provided.
 */
function parseSlots(state, parts, partsIndex, expectOne, insufficientMsg = '') {
	const original = parts[partsIndex - 1] + ' ' + parts[partsIndex];

	if (parts.length < partsIndex + 1)
		throw new Error(`Not enough arguments provided ${insufficientMsg} in '${parts.join(' ')}', needs '(slot x)'.`);

	const slots = parts[partsIndex].slice(0, parts[partsIndex].length - 1).split(',').map(Number);

	if (slots.length === 0 || slots.some(slot => isNaN(slot) || slot < 1 && slot > state.ourHand.length))
		throw new Error(`Failed to parse ${original}.`);

	if (expectOne && slots.length > 1)
		throw new Error(`Expected only 1 slot, parsed ${slots.length} in string ${original}.`);

	return slots;
}

/**
 * Parses an action from a string.
 * @param {State} state
 * @param {string} rawAction
 * @returns {Action}
 */
export function parseAction(state, rawAction) {
	const parts = rawAction.split(' ');

	const playerName = parts[0];
	const playerIndex = state.playerNames.findIndex(name => name === playerName);

	if (playerIndex === -1)
		throw new Error(`Couldn't parse giver ${playerName}, not in list of players ${state.playerNames}`);

	switch(parts[1]) {
		case 'clues': {
			const clue = ('12345'.indexOf(parts[2]) !== -1) ?
				{ type: CLUE.RANK, value: Number(parts[2]) } :
				{ type: CLUE.COLOUR, value: state.variant.suits.findIndex(suit => suit.toLowerCase() === parts[2].toLowerCase()) };

			if (clue.type === CLUE.COLOUR && clue.value === -1)
				throw new Error(`Unable to parse clue ${parts[2]}`);

			const targetName = parts[4];
			const target = state.playerNames.findIndex(name => name === targetName);
			if (target === -1)
				throw new Error(`Couldn't parse target ${playerName}, not in list of players ${state.playerNames}.`);

			if (target !== state.ourPlayerIndex) {
				const list = state.clueTouched(state.hands[target], clue);

				if (list.length === 0)
					throw new Error(`Clue ${logClue(Object.assign({}, clue, { target }))} touches no cards.`);

				return { type: 'clue', clue, giver: playerIndex, target, list };
			}
			else {
				// e.g. "Bob clues 2 to Alice (slots 2,4)"
				const slots = parseSlots(state, parts, 6, false, '(clue to us)');
				const list = slots.map(slot => state.ourHand[slot - 1]);

				return { type: 'clue', clue, giver: playerIndex, target, list };
			}
		}
		case 'plays': {
			const { suitIndex, rank } = expandShortCard(parts[2]);

			if (playerIndex !== state.ourPlayerIndex) {
				const matching = state.hands[playerIndex].filter(o => state.deck[o].matches({ suitIndex, rank }));

				if (matching.length === 0) {
					throw new Error(`Unable to find card ${parts[2]} to play in ${playerName}'s hand.`);
				}
				else if (matching.length === 1) {
					// Brief check to make sure that if slot provided, it is correct
					if (parts.length >= 4) {
						const slot = parseSlots(state, parts, 4, true)[0];
						if (state.hands[playerIndex][slot - 1] !== matching[0])
							throw new Error(`Identity ${parts[2]} is not in slot ${slot}, test written incorrectly?`);

					}
					return { type: 'play', playerIndex, suitIndex, rank, order: matching[0] };
				}
				else {
					// e.g. "Bob plays b3 (slot 1)"
					const slot = parseSlots(state, parts, 4, true, '(ambiguous identity)')[0];
					const order = state.hands[playerIndex][slot - 1];

					if (!state.deck[order].matches({ suitIndex, rank }))
						throw new Error(`Identity ${parts[2]} is not in slot ${slot}, test written incorrectly?`);

					return { type: 'play', playerIndex, suitIndex, rank, order };
				}
			}
			else {
				// e.g. "Alice plays y5 (slot 1)"
				const slot = parseSlots(state, parts, 4, true, '(play from us)')[0];
				const order = state.ourHand[slot - 1];

				return { type: 'play', playerIndex, suitIndex, rank, order };
			}
		}
		case 'discards':
		case 'bombs': {
			const { suitIndex, rank } = expandShortCard(parts[2]);
			if (playerIndex !== state.ourPlayerIndex) {
				const orders = state.hands[playerIndex].filter(o => state.deck[o].matches({ suitIndex, rank }));

				if (orders.length === 0)
					throw new Error(`Unable to find card ${parts[2]} to discard in ${playerName}'s hand.`);

				if (orders.length === 1)
					return { type: 'discard', playerIndex, suitIndex, rank, order: orders[0], failed: parts[1] === 'bombs' };

				// e.g. "Bob discards b3 (slot 1)"
				const slot = parseSlots(state, parts, 4, true, '(ambiguous identity)')[0];
				const order = state.hands[playerIndex][slot - 1];
				const card = state.deck[order];

				if (!card.matches({ suitIndex, rank }))
					throw new Error(`Identity ${parts[2]} is not in slot ${slot} (found ${logCard(card)}), test written incorrectly?`);

				return { type: 'discard', playerIndex, suitIndex, rank, order, failed: parts[1] === 'bombs' };
			}
			else {
				// e.g. "Alice discards y5 (slot 1)"
				if (parts.length < 5)
					throw new Error(`Not enough arguments provided for a discard action from us, needs '(slot x)' at the end.`);

				const slot = parseSlots(state, parts, 4, true, '(discard from us)')[0];
				const order = state.ourHand[slot - 1];

				return { type: 'discard', playerIndex, suitIndex, rank, order, failed: parts[1] === 'bombs' };
			}
		}
	}
}
