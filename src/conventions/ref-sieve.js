import { CLUE_INTERP } from './ref-sieve/rs-constants.js';
import { Game } from '../basics/Game.js';
import { State } from '../basics/State.js';
import { RS_Player } from './rs-player.js';
import { interpret_clue } from './ref-sieve/interpret-clue.js';
import { interpret_discard } from './ref-sieve/interpret-discard.js';
import { interpret_play } from './ref-sieve/interpret-play.js';
import { take_action } from './ref-sieve/take-action.js';
import { update_turn } from './ref-sieve/update-turn.js';
import * as Utils from '../tools/util.js';

/**
 * @typedef {import('../variants.js').Variant} Variant
 * @typedef {import('../types-live.js').TableOptions} TableOptions
 * @typedef {typeof import('./ref-sieve/rs-constants.js').CLUE_INTERP} CLUE_INTERP
 * @typedef {typeof import('./ref-sieve/rs-constants.js').PLAY_INTERP} PLAY_INTERP
 * @typedef {typeof import('./ref-sieve/rs-constants.js').DISCARD_INTERP} DISCARD_INTERP
 * @typedef {CLUE_INTERP[keyof CLUE_INTERP] | PLAY_INTERP[keyof PLAY_INTERP] | DISCARD_INTERP[keyof DISCARD_INTERP]} INTERP
 */

export default class RefSieve extends Game {
	convention_name = 'RefSieve';
	interpret_clue = interpret_clue;
	interpret_discard = interpret_discard;
	take_action = take_action;
	update_turn = update_turn;
	interpret_play = interpret_play;

	/** @type {number[]} */
	locked_shifts = [];

	/** @type {{turn: number, move: INTERP}[]} */
	moveHistory = [];

	/**
	 * @param {number} tableID
	 * @param {State} state
	 * @param {boolean} in_progress
	 */
	constructor(tableID, state, in_progress) {
		super(tableID, state, in_progress);

		this.players = this.players.map(p =>
			new RS_Player(p.playerIndex, p.all_possible, p.all_inferred, p.hypo_stacks, p.hypo_plays, p.thoughts, p.links, p.play_links, p.unknown_plays, p.waiting_connections, p.elims));

		const c = this.common;
		this.common = new RS_Player(c.playerIndex, c.all_possible, c.all_inferred, c.hypo_stacks, c.hypo_plays, c.thoughts, c.links, c.play_links, c.unknown_plays, c.waiting_connections, c.elims);
	}

	/** @param {RefSieve} json */
	static fromJSON(json) {
		const res = new RefSieve(json.tableID, State.fromJSON(json.state), json.in_progress);

		for (const property of Object.getOwnPropertyNames(res)) {
			if (typeof res[property] === 'function')
				continue;

			switch (property) {
				case 'state':
					continue;

				case 'players':
					res.players = json.players.map(RS_Player.fromJSON);
					break;

				case 'common':
					res.common = RS_Player.fromJSON(json.common);
					break;

				default:
					res[property] = Utils.objClone(json[property]);
					break;
			}
		}

		res.moveHistory = json.moveHistory.slice();
		return res;
	}

	createBlank() {
		const blank = super.createBlank();
		blank.notes = this.notes;
		blank.rewinds = this.rewinds;
		blank.locked_shifts = this.locked_shifts;
		return blank;
	}

	minimalCopy() {
		const newGame = super.minimalCopy();
		newGame.locked_shifts = this.locked_shifts.slice();
		newGame.copyDepth = this.copyDepth + 1;
		return newGame;
	}

	get lastMove() {
		return this.moveHistory.at(-1)?.move ?? CLUE_INTERP.NONE;
	}

	/** @param {INTERP} interp */
	interpretMove(interp) {
		this.moveHistory.push({ turn: this.state.turn_count, move: interp });
	}
}
