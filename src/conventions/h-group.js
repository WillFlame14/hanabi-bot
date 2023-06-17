import { State } from '../basics/State.js';
import { interpret_clue } from './h-group/clue-interpretation/interpret-clue.js';
import { interpret_discard } from './h-group/interpret-discard.js';
import { interpret_play } from './h-group/interpret-play.js';
import { take_action } from './h-group/take-action.js';
import { update_turn } from './h-group/update-turn.js';
import * as Utils from '../tools/util.js';

/** @extends State */
export default class HGroup extends State {
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	/**
     * @param {number} tableID
     * @param {string[]} playerNames
     * @param {number} ourPlayerIndex
     * @param {boolean} in_progress
     * @param {string[]} suits
     */
	constructor(tableID, playerNames, ourPlayerIndex, suits, in_progress, level = 1) {
		super(tableID, playerNames, ourPlayerIndex, suits, in_progress);

		this.level = level;
	}

	createBlank() {
		const blank = new HGroup(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress, this.level);
		blank.notes = this.notes;
		return blank;
	}

	minimalCopy() {
		const newState = new HGroup(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress, this.level);

		if (this.copyDepth > 3) {
			throw new Error('Maximum recursive depth reached.');
		}

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'max_ranks', 'hands',
			'turn_count', 'clue_tokens', 'strikes', 'early_game', 'rewindDepth', 'next_ignore'];

		for (const property of minimalProps) {
			newState[property] = Utils.objClone(this[property]);
		}
		newState.copyDepth = this.copyDepth + 1;
		return newState;
	}
}
