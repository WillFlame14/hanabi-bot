import { State } from '../basics/State.js';
import { interpret_clue } from './h-group/clue-interpretation/interpret-clue.js';
import { interpret_discard } from './h-group/interpret-discard.js';
import { interpret_play } from './h-group/interpret-play.js';
import { take_action } from './h-group/take-action.js';
import { update_turn } from './h-group/update-turn.js';

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
     * @param {string[]} suits
     */
	constructor(tableID, playerNames, ourPlayerIndex, suits, level = 1) {
		super(tableID, playerNames, ourPlayerIndex, suits);

		this.level = level;
	}

	createBlank() {
		return new HGroup(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.level);
	}
}
