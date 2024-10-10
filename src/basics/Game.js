import { IdentitySet } from './IdentitySet.js';
import { Hand } from './Hand.js';
import { Player } from './Player.js';
import { ActualCard } from '../basics/Card.js';
import { handle_action } from '../action-handler.js';

import logger from '../tools/logger.js';
import * as Utils from '../tools/util.js';
import { logCard, logPerformAction } from '../tools/log.js';

/**
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../types.js').DiscardAction} DiscardAction
 * @typedef {import('../types.js').TurnAction} TurnAction
 * @typedef {import('../types.js').PlayAction} PlayAction
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

	last_actions = /** @type {(Action & {card?: ActualCard, lock?: boolean})[]} */ ([]);
	handHistory = /** @type {Hand[]} */ ([]);

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

	ephemeral_rewind = false;

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

	get me() {
		return this.players[this.state.ourPlayerIndex];
	}

	get allPlayers() {
		return this.players.concat(this.common);
	}

	get hash() {
		const { clue_tokens, turn_count, actionList } = this.state;
		const player_thoughts = this.common.thoughts.flatMap(c => c.inferred.map(logCard).join()).join();
		const deck = this.state.deck.map(c => c.identity() !== undefined ? logCard(c.identity()) : 'xx');

		return `${player_thoughts},${deck},${JSON.stringify(actionList.at(-1))},${clue_tokens},${turn_count}`;
	}

	/**
	 * Returns a blank copy of the game, as if it had restarted.
	 */
	createBlank() {
		const newGame = new Game(this.tableID, this.state.createBlank(), this.in_progress);
		newGame.notes = this.notes;
		newGame.rewinds = this.rewinds;
		return newGame;
	}

	shallowCopy() {
		const newGame = new Game(this.tableID, this.state, this.in_progress);
		Object.assign(newGame, this);
		return newGame;
	}

	/**
	 * Returns a copy of the state with only minimal properties (cheaper than cloning).
	 */
	minimalCopy() {
		const newGame = new Game(this.tableID, this.state.minimalCopy(), this.in_progress);

		if (this.copyDepth > 100)
			throw new Error('Maximum recursive depth reached.');

		const minimalProps = ['players', 'common', 'last_actions', 'rewindDepth', 'next_ignore', 'next_finesse', 'handHistory', 'ephemeral_rewind'];

		for (const property of minimalProps)
			newGame[property] = Utils.objClone(this[property]);

		newGame.restoreCardBindings();

		newGame.copyDepth = this.copyDepth + 1;
		return newGame;
	}

	restoreCardBindings() {
		for (const player of this.allPlayers) {
			for (const card of this.state.hands.flat())
				player.thoughts[card.order].actualCard = card;
		}
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
	 * @param {ActualCard} _card
	 */
	interpret_discard(_game, _action, _card) {
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
	 * @returns {PerformAction}
	 */
	take_action(_game) {
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
	 * Rewinds the state to a particular action index, inserts the rewind actions just before it and then replays all future moves.
	 * @param {number} action_index
	 * @param {Action[]} rewind_actions	The rewind action to insert before the target action
	 * @param {boolean} [mistake] 		Whether the target action was a mistake
	 * @param {boolean} [ephemeral]		Whether the action should be saved in the action list
	 * @returns {this | undefined}
	 */
	rewind(action_index, rewind_actions, mistake = false, ephemeral = false) {
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
		Utils.globalModify({ game: newGame });

		let injected = false;

		/** @param {Action} action */
		const catchup_action = (action) => {
			if (!injected && action.type !== 'draw') {
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
			newGame.restoreCardBindings();

			newGame.handle_action(action);

			// Simulate the actual hand as well for replacement
			logger.collect();
			Utils.globalModify({ game: hypoGame });
			hypoGame.handle_action(action);
			Utils.globalModify({ game: newGame });
			logger.flush(false);

			newGame.state.hands[this.state.ourPlayerIndex] = hypoGame.state.hands[this.state.ourPlayerIndex];
			newGame.restoreCardBindings();
		};

		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			// Get up to speed
			for (const action of history)
				catchup_action(action);
		});

		if (!injected) {
			newGame.hookAfterDraws(newGame);
			injected = true;
		}

		// Rewrite and save as a rewind action
		for (const action of rewind_actions)
			newGame.handle_action(action);

		if (ephemeral) {
			newGame.state.actionList.pop();
			newGame.ephemeral_rewind = true;
		}
		newGame.handle_action(pivotal_action);

		// Redo all the following actions
		const future = actionList.slice(action_index + 1, -1);
		for (const action of future)
			catchup_action(action);

		logger.highlight('green', '------- REWIND COMPLETE -------');

		newGame.catchup = this.catchup;
		newGame.handle_action(actionList.at(-1));
		Utils.globalModify({ game: this });

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

			new_game.catchup = this.catchup;
			const suggested_action = new_game.take_action(new_game);
			logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action));
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
			const suggested_action = new_game.take_action(new_game);
			logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action));
		}

		// Copy over the full game history
		new_game.state.actionList = actionList;
		Utils.globalModify({ game: this });

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

		Utils.globalModify({ game: hypo_game });

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_game.interpret_clue(hypo_game, action);
		});

		Utils.globalModify({ game: this });

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

		Utils.globalModify({ game: hypo_game });

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_game.handle_action(action);

			if (action.type === 'play' || action.type === 'discard') {
				hypo_game.handle_action({ type: 'turn', num: hypo_game.state.turn_count, currentPlayerIndex: action.playerIndex });

				if (hypo_game.state.cardsLeft > 0) {
					const order = hypo_game.state.cardOrder + 1;
					const { suitIndex, rank } = hypo_game.state.deck[order] ?? new ActualCard(-1, -1, order, hypo_game.state.actionList.length);
					hypo_game.handle_action({ type: 'draw', playerIndex: action.playerIndex, order, suitIndex, rank });
				}
			}
		});

		Utils.globalModify({ game: this });

		hypo_game.catchup = false;
		return hypo_game;
	}
}
