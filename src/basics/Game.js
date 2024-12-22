import { IdentitySet } from './IdentitySet.js';
import { Player } from './Player.js';
import { ActualCard } from '../basics/Card.js';
import { State } from '../basics/State.js';
import { handle_action } from '../action-handler.js';
import * as Utils from '../tools/util.js';

import logger from '../tools/logger.js';
import { logCard, logPerformAction } from '../tools/log.js';
import { produce } from '../StateProxy.js';


/**
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../types.js').DiscardAction} DiscardAction
 * @typedef {import('../types.js').TurnAction} TurnAction
 * @typedef {import('../types.js').PlayAction} PlayAction
 * @typedef {import('../types.js').IdentifyAction} IdentifyAction
 * @typedef {import('../types.js').PerformAction} PerformAction
 */

export class Game {
	convention_name = '';
	in_progress = false;
	catchup = false;

	/** @type {State} */
	state;

	players = /** @type {Player[]} */ ([]);

	/** @type {Player} */
	common;

	last_actions = /** @type {((ClueAction | PlayAction | DiscardAction) & {lock?: boolean})[]} */ ([]);
	handHistory = /** @type {number[][]} */ ([]);

	notes = /** @type {{turn: number, last: string, full: string}[]} */ ([]);

	rewinds = 0;
	rewindDepth = 0;
	copyDepth = 0;

	/**
	 * The orders of cards to ignore in the next play clue.
	 * @type {{order: number, inference?: Identity}[][]}
	 */
	next_ignore = [];
	/**
	 * Information about the next finesse that reveals hidden layers.
	 * @type {{ list: number[], clue: BaseClue }[]}
	 */
	next_finesse = [];

	handle_action = handle_action;

	/**
	 * A function that executes after all cards have been drawn.
	 * @param {this} [_game]
	 */
	hookAfterDraws = (_game) => {};

	/**
	 * @param {number} tableID
	 * @param {State} state
	 * @param {boolean} in_progress
	 */
	constructor(tableID, state, in_progress) {
		/** @type {number} */
		this.tableID = tableID;
		this.state = state;
		this.in_progress = in_progress;

		const all_possible = new IdentitySet(state.variant.suits.length);

		for (let i = 0; i < state.numPlayers; i++)
			this.players[i] = new Player(i, all_possible, all_possible, Array.from({ length: state.variant.suits.length }, _ => 0));

		this.common = new Player(-1, all_possible, all_possible, Array.from({ length: state.variant.suits.length }, _ => 0));
	}

	/** @param {Game} json */
	static fromJSON(json) {
		const res = new Game(json.tableID, State.fromJSON(json.state), json.in_progress);

		for (const property of Object.getOwnPropertyNames(res)) {
			switch (property) {
				case 'players':
					res.players = json.players.map(Player.fromJSON);
					break;
				case 'common':
					res.common = Player.fromJSON(json.common);
					break;
				default:
					res[property] = Utils.objClone(json[property]);
					break;
			}
		}
		return res;
	}

	get me() {
		return this.players[this.state.ourPlayerIndex];
	}

	get allPlayers() {
		return this.players.concat(this.common);
	}

	get hash() {
		const { clue_tokens, turn_count, actionList } = this.state;
		const hands = this.state.hands.flat();
		const player_thoughts = this.common.thoughts.flatMap(c => c.inferred.map(logCard).join()).join();
		const deck = this.state.deck.map(logCard);

		return `${hands},${player_thoughts},${deck},${JSON.stringify(actionList.at(-1))},${clue_tokens},${turn_count}`;
	}

	/**
	 * Returns a blank copy of the game, as if it had restarted.
	 * @returns {this}
	 */
	createBlank() {
		const newGame = new /** @type {any} */ (this.constructor)(this.tableID, this.state.createBlank(), this.in_progress);
		newGame.notes = this.notes;
		newGame.rewinds = this.rewinds;
		return newGame;
	}

	/**
	 * @returns {this}
	 */
	shallowCopy() {
		const newGame = new /** @type {any} */ (this.constructor)(this.tableID, this.state.shallowCopy(), this.in_progress);

		for (const key of Object.getOwnPropertyNames(this)) {
			const val = this[key];

			if (Array.isArray(val))
				newGame[key] = val.slice();
			else if (typeof val !== 'object')
				newGame[key] = val;
		}

		newGame.common = this.common.shallowCopy();
		return newGame;
	}

	/**
	 * Returns a copy of the state with only minimal properties (cheaper than cloning).
	 * @returns {this}
	 */
	minimalCopy() {
		const newGame = new /** @type {any} */ (this.constructor)(this.tableID, this.state.minimalCopy(), this.in_progress);

		if (this.copyDepth > 100)
			throw new Error('Maximum recursive depth reached.');

		const minimalProps = ['players', 'common', 'last_actions', 'rewindDepth', 'next_ignore', 'next_finesse', 'handHistory'];

		for (const property of minimalProps)
			newGame[property] = Utils.objClone(this[property]);

		newGame.copyDepth = this.copyDepth + 1;
		return newGame;
	}

	/**
	 * @abstract
	 * @param {Game} _game
	 * @param {Omit<ClueAction, "type">} _action
	 */
	interpret_clue(_game, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {Game} _game
	 * @param {Omit<DiscardAction, "type">} _action
	 */
	interpret_discard(_game, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param  {Game} _game
	 * @param  {PlayAction} _action
	 */
	interpret_play(_game, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {Game} _game
	 * @returns {Promise<PerformAction>}
	 */
	async take_action(_game) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {Game} _game
	 * @param {Omit<TurnAction, "type">} _action
	 */
	update_turn(_game, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * Updates notes on cards.
	 */
	updateNotes() {
		if (this.state.options.speedrun)
			return;

		for (const order of this.state.hands.flat()) {
			const card = this.common.thoughts[order];

			if (!card.saved && !card.called_to_discard)
				continue;

			this.notes[order] ??= { last: '', turn: 0, full: '' };

			let note = card.getNote();

			const links = this.common.links.filter(link => link.promised && link.orders.includes(order));

			if (links.length > 0) {
				const link_note = links.flatMap(link => link.identities).map(logCard).join('? ') + '?';

				if (note.includes("]"))
					note += link_note;
				else
					note = `[${note}] ${link_note}`;
			}

			// Only write a new note if it's different from the last note and is a later turn
			if (note !== this.notes[order].last && this.state.turn_count > this.notes[order].turn) {
				this.notes[order].last = note;
				this.notes[order].turn = this.state.turn_count;

				if (this.notes[order].full !== '')
					this.notes[order].full += ' | ';

				this.notes[order].full += `t${this.state.turn_count}: ${note}`;

				if (!this.catchup && this.in_progress)
					Utils.sendCmd('note', { tableID: this.tableID, order, note: this.notes[order].full });
			}
		}
	}

	/**
	 * Rewinds the state to a particular action index, inserts the rewind actions just before it and then replays all future moves.
	 * @param {number} action_index
	 * @param {Action[]} rewind_actions	The rewind action to insert before the target action
	 * @param {boolean} [mistake] 		Whether the target action was a mistake
	 * @returns {this | undefined}
	 */
	rewind(action_index, rewind_actions, mistake = false) {
		const actionList = this.state.actionList.map(Utils.cleanAction);

		this.rewinds++;
		if (this.rewinds > 100)
			throw new Error('Attempted to rewind too many times!');

		if (this.rewindDepth > 3)
			throw new Error('Rewind depth went too deep!');

		if (action_index === undefined || (typeof action_index !== 'number') || action_index < 0 || action_index >= actionList.length) {
			logger.error(`Attempted to rewind to an invalid action index (${JSON.stringify(action_index)})!`);
			return;
		}
		this.rewindDepth++;

		const pivotal_action = /** @type {ClueAction} */ (actionList[action_index]);

		logger.highlight('cyan', `Rewinding to insert ${rewind_actions.map(a => JSON.stringify(a))}`);

		let offset = 0;
		let action = actionList[action_index - offset];

		while (action.type === 'ignore' || action.type === 'finesse' || action.type === 'identify' || offset === 0) {
			const double_rewinded = rewind_actions.find(a => Utils.objEquals(action, a));

			if (double_rewinded) {
				logger.error(`Attempted to rewind ${JSON.stringify(double_rewinded)} that was already rewinded!`);
				return;
			}

			offset++;
			action = actionList[action_index - offset];
		}

		if (pivotal_action.type === 'clue')
			pivotal_action.mistake = mistake || this.rewindDepth > 1;

		logger.highlight('green', '------- STARTING REWIND -------');

		const newGame = this.createBlank();
		newGame.catchup = true;
		const history = actionList.slice(0, action_index);

		const old_global_game = Utils.globals.game;
		Utils.globalModify({ game: newGame });

		let injected = false;

		/** @param {Action} action */
		const catchup_action = (action) => {
			if (!injected && action.type !== 'draw' && action.type !== 'identify') {
				newGame.hookAfterDraws(newGame);
				injected = true;
			}

			const our_action = action.type === 'clue' && action.giver === this.state.ourPlayerIndex;

			if (!our_action) {
				newGame.handle_action(action);
				return;
			}

			const hypoGame = newGame.minimalCopy();

			newGame.state.hands[this.state.ourPlayerIndex] = this.handHistory[newGame.state.turn_count];

			newGame.handle_action(action);

			// Simulate the actual hand as well for replacement
			logger.off();

			Utils.globalModify({ game: hypoGame });
			hypoGame.handle_action(action);
			Utils.globalModify({ game: newGame });

			logger.on();

			newGame.state.hands[this.state.ourPlayerIndex] = hypoGame.state.hands[this.state.ourPlayerIndex];
		};

		/** @param {Action} action */
		const after_action = (action) => {
			if (!injected && action.type !== 'draw' && action.type !== 'identify') {
				newGame.hookAfterDraws(newGame);
				injected = true;
			}
			newGame.handle_action(action);
		};

		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			// Get up to speed
			for (const action of history)
				catchup_action(action);
		});

		const remaining_id_actions = /** @type {IdentifyAction[]} */ ([]);

		// Rewrite and save as a rewind action
		for (const action of rewind_actions) {
			if (action.type === 'identify' && !newGame.state.hands[action.playerIndex].includes(action.order)) {
				remaining_id_actions.push(action);
			}
			else {
				after_action(action);

				if (action.type === 'draw' && action.order === remaining_id_actions[0]?.order)
					after_action(remaining_id_actions.shift());
			}
		}

		after_action(pivotal_action);

		// Redo all the following actions
		const future = actionList.slice(action_index + 1, -1);
		for (const action of future) {
			after_action(action);

			if (action.type === 'draw' && action.order === remaining_id_actions[0]?.order)
				after_action(remaining_id_actions.shift());
		}

		logger.highlight('green', '------- REWIND COMPLETE -------');

		newGame.catchup = this.catchup;
		after_action(actionList.at(-1));

		for (const [order, noteObj] of this.notes.entries())
			newGame.notes[order] = noteObj;

		Utils.globalModify({ game: old_global_game });

		return /** @type {this} */ (newGame);
	}

	/**
	 * Navigates the state to the beginning of a particular turn. Must be in 'replay' mode.
	 * @param {number} turn
	 */
	navigate(turn) {
		logger.highlight('greenb', `------- NAVIGATING (turn ${turn}) -------`);

		const new_game = this.createBlank();
		new_game.catchup = true;

		const old_global_game = Utils.globals.game;
		Utils.globalModify({ game: new_game });

		// Remove special actions from the action list (they will be added back in when rewinding)
		const actionList = this.state.actionList.filter(action => !['identify', 'ignore', 'finesse'].includes(action.type)).map(Utils.cleanAction);

		let action_index = 0;

		// Going first
		if (turn === 1 && new_game.state.ourPlayerIndex === 0) {
			let action = actionList[action_index];

			while(action.type === 'draw') {
				new_game.handle_action(action);
				action_index++;
				action = actionList[action_index];
			}
		}
		else {
			// Don't log history
			logger.wrapLevel(logger.LEVELS.ERROR, () => {
				while (new_game.state.turn_count < turn - 1) {
					new_game.handle_action(actionList[action_index]);
					action_index++;
				}
			});

			// Log the previous turn and the 'turn' action leading to the desired turn
			while (new_game.state.turn_count < turn && actionList[action_index] !== undefined) {
				new_game.handle_action(actionList[action_index]);
				action_index++;
			}
		}

		new_game.catchup = this.catchup;

		if (!new_game.catchup && new_game.state.currentPlayerIndex === this.state.ourPlayerIndex) {
			new_game.take_action(new_game).then(suggested_action =>
				logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action)));
		}

		// Copy over the full game history
		new_game.state.actionList = actionList;
		Utils.globalModify({ game: old_global_game });
		return new_game;
	}

	/**
	 * Returns a hypothetical state where the provided clue was given.
	 * This is slightly different from simulate_action() in that the normal "clue cleanup" actions are not taken.
	 * 
	 * The 'enableLogs' option causes all logs from the simulated state to be printed.
	 * Otherwise, only errors are printed from the simulated state.
	 * @param {ClueAction} action
	 * @param {{enableLogs?: boolean}} options
	 */
	simulate_clue(action, options = {}) {
		const hypo_game = /** @type {this} */ (this.minimalCopy());
		hypo_game.catchup = true;
		hypo_game.rewind = () => undefined;

		// Remove all existing newly clued notes
		for (const o of this.state.hands.flat()) {
			const { deck } = hypo_game.state;
			hypo_game.state.deck = deck.with(o, produce(deck[o], (draft) => { draft.newly_clued = false; }));

			for (const player of hypo_game.allPlayers)
				player.updateThoughts(o, (draft) => { draft.newly_clued = false; });
		}

		const old_global_game = Utils.globals.game;
		Utils.globalModify({ game: hypo_game });

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_game.interpret_clue(hypo_game, action);
		});

		Utils.globalModify({ game: old_global_game });

		hypo_game.catchup = false;
		hypo_game.state.turn_count++;
		return hypo_game;
	}

	/**
	 * Returns a hypothetical state where the provided action was taken.
	 * 
	 * The 'enableLogs' option causes all logs from the simulated state to be printed.
	 * Otherwise, only errors are printed from the simulated state.
	 * @param {Action} action
	 * @param {{enableLogs?: boolean}} options
	 */
	simulate_action(action, options = {}) {
		const hypo_game = /** @type {this} */ (this.minimalCopy());
		hypo_game.catchup = true;
		hypo_game.rewind = () => undefined;

		// Remove all existing newly clued notes
		for (const o of this.state.hands.flat()) {
			hypo_game.state.deck[o].newly_clued = false;

			for (const player of hypo_game.allPlayers)
				player.updateThoughts(o, (draft) => { draft.newly_clued = false; });
		}

		const old_global_game = Utils.globals.game;
		Utils.globalModify({ game: hypo_game });

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_game.handle_action(action);

			if (action.type === 'play' || action.type === 'discard') {
				hypo_game.handle_action({ type: 'turn', num: hypo_game.state.turn_count, currentPlayerIndex: action.playerIndex });

				if (hypo_game.state.cardsLeft > 0) {
					const order = hypo_game.state.cardOrder + 1;
					const { suitIndex, rank } = hypo_game.state.deck[order] ?? Object.freeze(new ActualCard(-1, -1, order, hypo_game.state.actionList.length));
					hypo_game.handle_action({ type: 'draw', playerIndex: action.playerIndex, order, suitIndex, rank });
				}
			}
		});

		Utils.globalModify({ game: old_global_game });

		hypo_game.catchup = false;
		return hypo_game;
	}
}
