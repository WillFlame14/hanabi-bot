import { BasicCard } from './Card.js';
import { Hand } from './Hand.js';
import { Player } from './Player.js';

import { handle_action } from '../action-handler.js';
import { cardCount } from '../variants.js';
import logger from '../tools/logger.js';
import * as Utils from '../tools/util.js';
import { logPerformAction } from '../tools/log.js';

/**
 * @typedef {import('../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../types.js').DiscardAction} DiscardAction
 * @typedef {import('../types.js').TurnAction} TurnAction
 * @typedef {import('../types.js').PlayAction} PlayAction
 * @typedef {import('../types.js').PerformAction} PerformAction
 */

export class State {
	convention_name = '';
	turn_count = 1;
	clue_tokens = 8;
	strikes = 0;
	early_game = true;
	in_progress = false;

	players = /** @type {Player[]} */ ([]);
	deck = /** @type {Identity[]} */ ([]);
	hands = /** @type {Hand[]} */ ([]);

	play_stacks = /** @type {number[]} */ ([]);
	discard_stacks = /** @type {number[][]} */ ([]);
	max_ranks = /** @type {number[]} */ ([]);

	actionList = /** @type {Action[]} */ ([]);
	last_actions = /** @type {(Action & {card?: ActualCard, lock?: boolean})[]} */ ([]);
	handHistory = /** @type {Hand[]} */ ([]);

	notes = /** @type {{turn: number, last: string, full: string}[]} */ ([]);

	rewinds = 0;
	rewindDepth = 0;
	copyDepth = 0;

	currentPlayerIndex = 0;
	cardOrder = 0;

	/**
	 * The orders of cards to ignore in the next play clue.
	 * @type {number[][]}
	 */
	next_ignore = [];
	/**
	 * Information about the next finesse that reveals hidden layers.
	 * @type {{ list: number[], clue: BaseClue }[]}
	 */
	next_finesse = [];

	handle_action = handle_action;

	/**
	 * @param {number} tableID
	 * @param {string[]} playerNames
	 * @param {number} ourPlayerIndex
	 * @param {string[]} suits
	 * @param {boolean} in_progress
	 */
	constructor(tableID, playerNames, ourPlayerIndex, suits, in_progress) {
		/** @type {number} */
		this.tableID = tableID;
		/** @type {string[]} */
		this.playerNames = playerNames;
		/** @type {number} */
		this.numPlayers = playerNames.length;
		/** @type {number} */
		this.ourPlayerIndex = ourPlayerIndex;

		/** @type {string[]} */
		this.suits = suits;

		this.in_progress = in_progress;

		/** @type {number} */
		this.cardsLeft = this.suits.reduce((acc, _, suitIndex) =>
			acc + [1, 2, 3, 4, 5].reduce((cards, rank) => cards + cardCount(suits, { suitIndex, rank }), 0), 0);

		const all_possible = [];
		for (let suitIndex = 0; suitIndex < this.suits.length; suitIndex++) {
			this.play_stacks.push(0);
			this.discard_stacks.push([0, 0, 0, 0, 0]);
			this.max_ranks.push(5);

			for (let rank = 1; rank <= 5; rank++)
				all_possible.push(Object.freeze(new BasicCard(suitIndex, rank)));
		}

		for (let i = 0; i < this.numPlayers; i++) {
			this.hands.push(new Hand());
			this.players[i] = new Player(i, all_possible.slice(), all_possible.slice(), Array.from({ length: this.suits.length }, _ => 0));
		}

		this.common = new Player(-1, all_possible.slice(), all_possible.slice(), Array.from({ length: this.suits.length }, _ => 0));
	}

	get me() {
		return this.players[this.ourPlayerIndex];
	}

	get score() {
		return this.play_stacks.reduce((sum, stack) => sum + stack);
	}

	get allPlayers() {
		return this.players.concat(this.common);
	}

	/**
	 * Returns a blank copy of the state, as if the game had restarted.
	 */
	createBlank() {
		const newState = new State(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress);
		newState.notes = this.notes;
		newState.rewinds = this.rewinds;
		return newState;
	}

	/**
	 * Returns a copy of the state with only minimal properties (cheaper than cloning).
	 */
	minimalCopy() {
		const newState = new State(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits, this.in_progress);

		if (this.copyDepth > 3)
			throw new Error('Maximum recursive depth reached.');

		const minimalProps = ['play_stacks', 'hypo_stacks', 'discard_stacks', 'players', 'common', 'max_ranks', 'hands', 'turn_count', 'clue_tokens', 'last_actions',
			'strikes', 'early_game', 'rewindDepth', 'unknown_plays', 'next_ignore', 'next_finesse', 'cardsLeft', 'elims'];

		for (const property of minimalProps)
			newState[property] = Utils.objClone(this[property]);

		newState.restoreCardBindings();

		newState.copyDepth = this.copyDepth + 1;
		return newState;
	}

	restoreCardBindings() {
		for (const player of this.allPlayers) {
			for (const card of this.hands.flat())
				player.thoughts[card.order].actualCard = card;
		}
	}

	/**
	 * @abstract
	 * @param {State} _state
	 * @param {Omit<ClueAction, "type">} _action
	 */
	interpret_clue(_state, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {State} _state
	 * @param {Omit<DiscardAction, "type">} _action
	 * @param {ActualCard} _card
	 */
	interpret_discard(_state, _action, _card) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param  {State} _state
	 * @param  {PlayAction} _action
	 */
	interpret_play(_state, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {State} _state
	 * @returns {PerformAction}
	 */
	take_action(_state) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * @abstract
	 * @param {State} _state
	 * @param {Omit<TurnAction, "type">} _action
	 */
	update_turn(_state, _action) {
		throw new Error('must be implemented by subclass!');
	}

	/**
	 * Rewinds the state to a particular action index, inserts the rewind action just before it and then replays all future moves.
	 * @param {number} action_index
	 * @param {Action} rewind_action	The rewind action to insert before the target action
	 * @param {boolean} [mistake] 		Whether the target action was a mistake
	 */
	rewind(action_index, rewind_action, mistake = false) {
		this.rewinds++;
		if (this.rewinds > 50)
			throw new Error('Attempted to rewind too many times!');

		if (this.rewindDepth > 2)
			throw new Error('Rewind depth went too deep!');

		if (action_index === undefined || (typeof action_index !== 'number') || action_index < 0 || action_index >= this.actionList.length) {
			logger.error(`Attempted to rewind to an invalid action index (${JSON.stringify(action_index)})!`);
			return false;
		}
		this.rewindDepth++;

		const pivotal_action = /** @type {ClueAction} */ (this.actionList[action_index]);

		logger.highlight('cyan', `Rewinding to insert ${JSON.stringify(rewind_action)}`);
		if ([-1, 0].some(offset => Utils.objEquals(this.actionList[action_index + offset], rewind_action)))
			throw new Error(`Attempted to rewind ${JSON.stringify(rewind_action)} that was already rewinded!`);

		if (pivotal_action.type === 'clue')
			pivotal_action.mistake = mistake || this.rewindDepth > 1;

		logger.highlight('green', '------- STARTING REWIND -------');

		const new_state = this.createBlank();
		const history = this.actionList.slice(0, action_index);

		/** @param {Action} action */
		const catchup_action = (action) => {
			const our_action = action.type === 'clue' && action.giver === this.ourPlayerIndex;

			const hypo_state = new_state.minimalCopy();

			if (our_action) {
				new_state.hands[this.ourPlayerIndex] = this.handHistory[new_state.turn_count];
				new_state.restoreCardBindings();
			}

			new_state.handle_action(action, true);

			// Simulate the actual hand as well for replacement
			logger.collect();
			hypo_state.handle_action(action, true);
			logger.flush(false);

			if (our_action) {
				new_state.hands[this.ourPlayerIndex] = hypo_state.hands[this.ourPlayerIndex];
				new_state.restoreCardBindings();
			}
		};

		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			// Get up to speed
			for (const action of history)
				catchup_action(action);
		});

		// Rewrite and save as a rewind action
		new_state.handle_action(rewind_action, true);
		new_state.handle_action(pivotal_action, true);

		// Redo all the following actions
		const future = this.actionList.slice(action_index + 1, -1);
		for (const action of future)
			catchup_action(action);

		logger.highlight('green', '------- REWIND COMPLETE -------');

		new_state.handle_action(this.actionList.at(-1));

		// Overwrite state
		Object.assign(this, new_state);
		Utils.globalModify({ state: this });

		this.rewindDepth = 0;
		return true;
	}

	/**
	 * Navigates the state to the beginning of a particular turn. Must be in 'replay' mode.
	 * @param {number} turn
	 */
	navigate(turn) {
		logger.highlight('greenb', `------- NAVIGATING (turn ${turn}) -------`);

		const new_state = this.createBlank();
		Utils.globalModify({ state: new_state });

		// Remove special actions from the action list (they will be added back in when rewinding)
		const actionList = this.actionList.filter(action => !['identify', 'ignore', 'finesse'].includes(action.type));

		let action_index = 0;

		// Going first
		if (turn === 1 && new_state.ourPlayerIndex === 0) {
			let action = actionList[action_index];

			while(action.type === 'draw') {
				new_state.handle_action(action, true);
				action_index++;
				action = actionList[action_index];
			}

			const suggested_action = new_state.take_action(new_state);
			logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action));
		}
		else {
			// Don't log history
			logger.wrapLevel(logger.LEVELS.ERROR, () => {
				while (new_state.turn_count < turn - 1) {
					const action = actionList[action_index];

					if (action.type === 'clue' && action.mistake)
						action.mistake = false;

					new_state.handle_action(action, true);
					action_index++;
				}
			});

			// Log the previous turn and the 'turn' action leading to the desired turn
			while (new_state.turn_count < turn && actionList[action_index] !== undefined) {
				const action = actionList[action_index];

				if (action.type === 'clue' && action.mistake)
					action.mistake = false;

				new_state.handle_action(action);
				action_index++;
			}
		}

		// Copy over the full game history
		new_state.actionList = actionList;
		Object.assign(this, new_state);

		Utils.globalModify({ state: this });
	}

	/**
	 * Returns a hypothetical state where the provided clue was given.
	 * 
	 * The 'simulatePlayerIndex' option changes ourPlayerIndex to the given index.
	 * 
	 * The 'enableLogs' option causes all logs from the simulated state to be printed.
	 * Otherwise, only errors are printed from the simulated state.
	 * @param {ClueAction} action
	 * @param {{simulatePlayerIndex?: number, enableLogs?: boolean}} options
	 */
	simulate_clue(action, options = {}) {
		const hypo_state = /** @type {this} */ (this.minimalCopy());

		Utils.globalModify({ state: hypo_state });

		if (options.simulatePlayerIndex !== undefined)
			hypo_state.ourPlayerIndex = options.simulatePlayerIndex;

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_state.interpret_clue(hypo_state, action);
		});

		Utils.globalModify({ state: this });

		return hypo_state;
	}
}
