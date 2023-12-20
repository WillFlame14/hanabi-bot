import { State } from '../basics/State.js';
import { interpret_clue } from './h-group/clue-interpretation/interpret-clue.js';
import { interpret_discard } from './h-group/interpret-discard.js';
import { interpret_play } from './h-group/interpret-play.js';
import { take_action } from './h-group/take-action.js';
import { update_turn } from './h-group/update-turn.js';

import { HGroup_Player } from './h-player.js';
import * as Utils from '../tools/util.js';

export default class HGroup extends State {
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	player_history = /** @type {HGroup_Player[]} */ ([]);
	players = /** @type {HGroup_Player[]} */ ([]);

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

		this.players = [];
		for (let i = 0; i < playerNames.length; i++) {
			this.players.push(new HGroup_Player(i));
		}

		this.common = new HGroup_Player(
			this.common.playerIndex,
			this.common.thoughts,
			this.common.links,
			this.common.hypo_stacks,
			this.common.all_possible,
			this.common.all_inferred,
			this.common.unknown_plays);

		this.level = level;
	}

	get me() {
		return this.players[this.ourPlayerIndex];
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

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'players', 'common', 'max_ranks', 'hands', 'players', 'last_actions',
			'turn_count', 'clue_tokens', 'strikes', 'early_game', 'rewindDepth', 'next_ignore', 'next_finesse', 'cardsLeft'];

		for (const property of minimalProps) {
			newState[property] = Utils.objClone(this[property]);
		}
		newState.copyDepth = this.copyDepth + 1;
		return newState;
	}
}
