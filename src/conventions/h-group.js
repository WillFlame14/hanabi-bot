import { Game } from '../basics/Game.js';
import { interpret_clue } from './h-group/clue-interpretation/interpret-clue.js';
import { interpret_discard } from './h-group/interpret-discard.js';
import { interpret_play } from './h-group/interpret-play.js';
import { take_action } from './h-group/take-action.js';
import { update_turn } from './h-group/update-turn.js';

import { HGroup_Player } from './h-player.js';
import * as Utils from '../tools/util.js';

/**
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../variants.js').Variant} Variant
 * @typedef {import('../types-live.js').TableOptions} TableOptions
 * @typedef {import('../basics/Card.js').ActualCard} ActualCard
 * @typedef {typeof import('./h-group/h-constants.js').CLUE_INTERP} CLUE_INTERP
 * @typedef {typeof import('./h-group/h-constants.js').PLAY_INTERP} PLAY_INTERP
 * @typedef {typeof import('./h-group/h-constants.js').DISCARD_INTERP} DISCARD_INTERP
 * @typedef {CLUE_INTERP[keyof CLUE_INTERP] | PLAY_INTERP[keyof PLAY_INTERP] | DISCARD_INTERP[keyof DISCARD_INTERP]} INTERP
 */

export default class HGroup extends Game {
	convention_name = 'HGroup';
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	/** @type {{turn: number, move: INTERP}[]} */
	moveHistory;

	/**
	 * Identities of cards we are finessing while we are waiting to play into a finesse/
	 * @type {ActualCard[][]}
	 */
	finesses_while_finessed;

	/**
	 * @param {number} tableID
	 * @param {State} state
	 * @param {boolean} in_progress
	 * @param {number} [level] 	The convention level (defaults to 1).
	 */
	constructor(tableID, state, in_progress, level = 1) {
		super(tableID, state, in_progress);

		this.players = this.players.map(p =>
			new HGroup_Player(p.playerIndex, p.all_possible, p.all_inferred, p.hypo_stacks, p.thoughts, p.links, p.play_links, p.unknown_plays, p.waiting_connections, p.elims));

		const c = this.common;
		this.common = new HGroup_Player(c.playerIndex, c.all_possible, c.all_inferred, c.hypo_stacks, c.thoughts, c.links, c.play_links, c.unknown_plays, c.waiting_connections, c.elims);

		this.finesses_while_finessed = Array.from({ length: state.numPlayers }, _ => []);

		this.level = level;
		this.moveHistory = [];
	}

	get me() {
		return this.players[this.state.ourPlayerIndex];
	}

	createBlank() {
		const blank = new HGroup(this.tableID, this.state.createBlank(), this.in_progress, this.level);
		blank.notes = this.notes;
		blank.rewinds = this.rewinds;
		return blank;
	}

	shallowCopy() {
		const newGame = new HGroup(this.tableID, this.state, this.in_progress, this.level);
		Object.assign(newGame, this);
		return newGame;
	}

	minimalCopy() {
		const newGame = new HGroup(this.tableID, this.state.minimalCopy(), this.in_progress, this.level);

		if (this.copyDepth > 100)
			throw new Error('Maximum recursive depth reached.');

		const minimalProps = ['players', 'common', 'last_actions', 'rewindDepth', 'next_ignore', 'next_finesse', 'handHistory',
			'screamed_at', 'moveHistory', 'finesses_while_finessed'];

		for (const property of minimalProps)
			newGame[property] = Utils.objClone(this[property]);

		for (const player of newGame.players.concat([newGame.common])) {
			for (const c of newGame.state.hands.flat())
				player.thoughts[c.order].actualCard = c;
		}

		newGame.copyDepth = this.copyDepth + 1;
		return newGame;
	}

	/** @param {INTERP} interp */
	interpretMove(interp) {
		this.moveHistory.push({ turn: this.state.turn_count, move: interp });
	}
}
