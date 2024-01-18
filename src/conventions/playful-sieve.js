import { State } from '../basics/State.js';
import { interpret_clue } from './playful-sieve/interpret-clue.js';
import { interpret_discard } from './playful-sieve/interpret-discard.js';
import { interpret_play } from './playful-sieve/interpret-play.js';
import { take_action } from './playful-sieve/take-action.js';
import { update_turn } from './playful-sieve/update-turn.js';

import * as Utils from '../tools/util.js';

export default class PlayfulSieve extends State {
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	/** @type {number[]} */
	locked_shifts = [];

	/**
	 * @param {number} tableID
	 * @param {string[]} playerNames
	 * @param {number} ourPlayerIndex
	 * @param {string[]} suits
	 * @param {boolean} in_progress
	 */
	constructor(tableID, playerNames, ourPlayerIndex, suits, in_progress) {
		super(tableID, playerNames, ourPlayerIndex, suits, in_progress);
	}

	createBlank() {
		const blank = new PlayfulSieve(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress);
		blank.notes = this.notes;
		blank.rewinds = this.rewinds;
		blank.locked_shifts = this.locked_shifts;
		return blank;
	}

	minimalCopy() {
		const newState = new PlayfulSieve(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress);

		if (this.copyDepth > 3) {
			throw new Error('Maximum recursive depth reached.');
		}

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'players', 'common', 'max_ranks', 'hands', 'last_actions',
			'turn_count', 'clue_tokens', 'strikes', 'rewindDepth', 'cardsLeft', 'locked_shifts', 'elims'];

		for (const property of minimalProps) {
			newState[property] = Utils.objClone(this[property]);
		}

		for (const player of newState.players.concat([newState.common])) {
			for (const c of newState.hands.flat()) {
				player.thoughts[c.order].actualCard = c;
			}
		}

		newState.copyDepth = this.copyDepth + 1;
		return newState;
	}
}
