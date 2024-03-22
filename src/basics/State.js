import { CLUE, HAND_SIZE } from '../constants.js';
import { Hand } from './Hand.js';
import { cardCount } from '../variants.js';

import * as Utils from '../tools/util.js';

/**
 * @typedef {import('../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../types.js').DiscardAction} DiscardAction
 * @typedef {import('../types.js').TurnAction} TurnAction
 * @typedef {import('../types.js').PlayAction} PlayAction
 * @typedef {import('../types.js').PerformAction} PerformAction
 * @typedef {import('../variants.js').Variant} Variant
 * @typedef {import('../types-live.js').TableOptions} TableOptions
 */

export class State {
	turn_count = 1;
	clue_tokens = 8;
	strikes = 0;
	early_game = true;

	hands = /** @type {Hand[]} */ ([]);
	deck = /** @type {ActualCard[]} */ ([]);

	actionList = /** @type {Action[]} */ ([]);

	play_stacks = /** @type {number[]} */ ([]);
	discard_stacks = /** @type {number[][]} */ ([]);
	max_ranks = /** @type {number[]} */ ([]);

	currentPlayerIndex = 0;
	cardOrder = 0;

	/**
	 * @param {string[]} playerNames
	 * @param {number} ourPlayerIndex
	 * @param {Variant} variant
	 * @param {TableOptions} options
	 */
	constructor(playerNames, ourPlayerIndex, variant, options) {
		/** @type {string[]} */
		this.playerNames = playerNames;
		/** @type {number} */
		this.numPlayers = playerNames.length;
		/** @type {number} */
		this.ourPlayerIndex = ourPlayerIndex;

		/** @type {Variant}} */
		this.variant = variant;

		/** @type {TableOptions} */
		this.options = options;

		/** @type {number} */
		this.cardsLeft = this.variant.suits.reduce((acc, _, suitIndex) =>
			acc + [1, 2, 3, 4, 5].reduce((cards, rank) => cards + cardCount(variant, { suitIndex, rank }), 0), 0);

		for (let suitIndex = 0; suitIndex < this.variant.suits.length; suitIndex++) {
			this.play_stacks.push(0);
			this.discard_stacks.push([0, 0, 0, 0, 0]);
			this.max_ranks.push(5);
		}

		for (let i = 0; i < this.numPlayers; i++)
			this.hands.push(new Hand());
	}

	/**
	 * Returns the hand size.
	 */
	get handSize() {
		return HAND_SIZE[this.numPlayers] + (this.options?.oneLessCard ? -1 : this.options?.oneExtraCard ? 1 : 0);
	}

	get score() {
		return this.play_stacks.reduce((sum, stack) => sum + stack);
	}

	/**
	 * Returns the current pace (current score + cards left + # of players - max score).
	 */
	get pace() {
		const maxScore = this.max_ranks.reduce((acc, curr) => acc + curr);
		return this.score + this.cardsLeft + this.numPlayers - maxScore;
	}

	/**
	 * Returns whether the state is in the endgame.
	 */
	inEndgame() {
		return this.pace < this.numPlayers;
	}

	/**
	 * Returns a blank copy of the state, as if the game had restarted.
	 */
	createBlank() {
		return new State(this.playerNames, this.ourPlayerIndex, this.variant, this.options);
	}

	shallowCopy() {
		const newState = new State(this.playerNames, this.ourPlayerIndex, this.variant, this.options);
		Object.assign(newState, this);
		return newState;
	}

	/**
	 * Returns a copy of the state with only minimal properties (cheaper than cloning).
	 */
	minimalCopy() {
		const newState = new State(this.playerNames, this.ourPlayerIndex, this.variant, this.options);

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'max_ranks', 'hands', 'turn_count', 'clue_tokens',
			'strikes', 'early_game', 'cardsLeft', 'actionList', 'deck'];

		for (const property of minimalProps)
			newState[property] = Utils.objClone(this[property]);

		return newState;
	}

	/**
	 * Returns the number of cards matching an identity on either the play stacks or the discard stacks.
	 * @param {Identity} identity
	 */
	baseCount({ suitIndex, rank }) {
		return (this.play_stacks[suitIndex] >= rank ? 1 : 0) + this.discard_stacks[suitIndex][rank - 1];
	}

	/**
	 * Returns whether the given identity is basic trash (has been played already or can never be played).
	 * @param {Identity} identity
	 */
	isBasicTrash({ suitIndex, rank }) {
		return rank <= this.play_stacks[suitIndex] || rank > this.max_ranks[suitIndex];
	}

	/**
	 * Returns whether the given suitIndex and rank is currently critical.
	 * @param {Identity} identity
	 */
	isCritical({ suitIndex, rank }) {
		return this.discard_stacks[suitIndex][rank - 1] === (cardCount(this.variant, { suitIndex, rank }) - 1);
	}

	/**
	 * Returns how far the given identity are from playable. 0 means it is currently playable.
	 * @param {Identity} identity
	 */
	playableAway({ suitIndex, rank }) {
		return rank - (this.play_stacks[suitIndex] + 1);
	}

	/**
	 * Returns whether the given identity is currently playable on the stacks.
	 * @param {Identity} identity
	 */
	isPlayable(identity) {
		return this.playableAway(identity) === 0;
	}

	/**
	 * Returns whether a card's order was part of the starting hands.
	 * @param {number} order
	 */
	inStartingHand(order) {
		return order < this.numPlayers * this.handSize;
	}

	/**
	 * @param {number} target
	 */
	allValidClues(target) {
		const hand = this.hands[target];
		const clues = /** @type {Clue[]} */ ([]);

		for (let rank = 1; rank <= 5; rank++)
			clues.push({ type: CLUE.RANK, value: rank, target });

		for (let suitIndex = 0; suitIndex < this.variant.suits.length; suitIndex++)
			clues.push({ type: CLUE.COLOUR, value: suitIndex, target });

		return clues.filter(clue => hand.clueTouched(clue, this.variant).length > 0);
	}
}
