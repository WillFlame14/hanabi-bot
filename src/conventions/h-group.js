import { State } from '../basics/State.js';
import { interpret_clue } from './h-group/clue-interpretation/interpret-clue.js';
import { interpret_discard } from './h-group/interpret-discard.js';
import { interpret_play } from './h-group/interpret-play.js';
import { take_action } from './h-group/take-action.js';
import { update_turn } from './h-group/update-turn.js';

import { HGroup_Hand } from './h-hand.js';
import * as Utils from '../tools/util.js';

export default class HGroup extends State {
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	hand_history = /** @type {HGroup_Hand[]} */ ([]);
	hands = /** @type {HGroup_Hand[]} */ ([]);

	/**
	 * @param {number} tableID
	 * @param {string[]} playerNames
	 * @param {number} ourPlayerIndex
	 * @param {string[]} suits
	 * @param {boolean} in_progress
	 * @param {number} [level] 	The convention level (defaults to 1).
	 */
	constructor(tableID, playerNames, ourPlayerIndex, suits, in_progress, level = 1) {
		super(tableID, playerNames, ourPlayerIndex, suits, in_progress);

		this.hands = [];
		for (let i = 0; i < playerNames.length; i++) {
			this.hands.push(new HGroup_Hand(this, i));
		}

		this.level = level;
	}

	createBlank() {
		const blank = new HGroup(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress, this.level);
		blank.notes = this.notes;
		blank.rewinds = this.rewinds;
		return blank;
	}

	minimalCopy() {
		const newState = new HGroup(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress, this.level);

		if (this.copyDepth > 3) {
			throw new Error('Maximum recursive depth reached.');
		}

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'max_ranks', 'hands',
			'turn_count', 'clue_tokens', 'strikes', 'early_game', 'rewindDepth', 'next_ignore', 'next_finesse', 'cardsLeft'];

		for (const property of minimalProps) {
			newState[property] = Utils.objClone(this[property]);

			// Rewrite reference to state in new hands
			if (property === 'hands') {
				for (const hand of newState.hands) {
					hand.state = newState;
				}
			}
		}
		newState.copyDepth = this.copyDepth + 1;
		return newState;
	}
}
