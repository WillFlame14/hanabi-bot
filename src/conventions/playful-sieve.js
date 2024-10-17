import { Game } from '../basics/Game.js';
import { interpret_clue } from './playful-sieve/interpret-clue.js';
import { interpret_discard } from './playful-sieve/interpret-discard.js';
import { interpret_play } from './playful-sieve/interpret-play.js';
import { take_action } from './playful-sieve/take-action.js';
import { update_turn } from './playful-sieve/update-turn.js';

import * as Utils from '../tools/util.js';

/**
 * @typedef {import('../variants.js').Variant} Variant
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types-live.js').TableOptions} TableOptions
 */

export default class PlayfulSieve extends Game {
	convention_name = 'PlayfulSieve';
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	/** @type {number[]} */
	locked_shifts = [];

	/**
	 * @param {number} tableID
	 * @param {State} state
	 * @param {boolean} in_progress
	 */
	constructor(tableID, state, in_progress) {
		super(tableID, state, in_progress);
	}

	createBlank() {
		const blank = new PlayfulSieve(this.tableID, this.state.createBlank(), this.in_progress);
		blank.notes = this.notes;
		blank.rewinds = this.rewinds;
		blank.locked_shifts = this.locked_shifts;
		return blank;
	}

	minimalCopy() {
		const newGame = new PlayfulSieve(this.tableID, this.state.minimalCopy(), this.in_progress);

		if (this.copyDepth > 100)
			throw new Error('Maximum recursive depth reached.');

		const minimalProps = ['players', 'common', 'last_actions', 'rewindDepth', 'locked_shifts'];

		for (const property of minimalProps)
			newGame[property] = Utils.objClone(this[property]);

		newGame.copyDepth = this.copyDepth + 1;
		return newGame;
	}
}
