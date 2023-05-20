import { Card } from './Card.js';
import { Hand } from './Hand.js';
import { handle_action } from '../action-handler.js';
import { cardCount } from '../variants.js';
import logger from '../logger.js';
import * as Utils from '../util.js';

/**
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../types.js').DiscardAction} DiscardAction
 * @typedef {import('../types.js').TurnAction} TurnAction
 * @typedef {import('../types.js').PlayAction} PlayAction
 * @typedef {import('../types.js').PerformAction} PerformAction
 * @typedef {import('../types.js').WaitingConnection} WaitingConnection
 */

export class State {
	turn_count = 0;
	clue_tokens = 8;
	strikes = 0;
	early_game = true;
	rewindDepth = 0;
	in_progress = false;

	hands = /** @type {Hand[]} */ ([]);

	play_stacks = /** @type {number[]} */ ([]);
	hypo_stacks = /** @type {number[]} */ ([]);
	discard_stacks = /** @type {number[][]} */ ([]);
	max_ranks = /** @type {number[]} */ ([]);

	all_possible = /** @type {Card[][]} */ ([]);

	actionList = /** @type {Action[]} */ ([]);
	last_actions = /** @type {Action[]} */ ([]);

	/**
	 * The orders of cards to ignore in the next play clue.
	 * @type {number[]}
	 */
	next_ignore = [];

	handle_action = handle_action;

	/**
     * @param {number} tableID
     * @param {string[]} playerNames
     * @param {number} ourPlayerIndex
     * @param {string[]} suits
     */
	constructor(tableID, playerNames, ourPlayerIndex, suits) {
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

		/** @type {WaitingConnection[]} */
		this.waiting_connections = [];

		/** @type {number} */
		this.cardsLeft = this.suits.reduce((acc, suit) => {
			let cards = 0;
			for (let rank = 1; rank <= 5; rank++) {
				cards += cardCount(suit, rank);
			}
			return acc + cards;
		}, 0);

		const all_possible = [];
		for (let suitIndex = 0; suitIndex < this.suits.length; suitIndex++) {
			this.play_stacks.push(0);
			this.hypo_stacks.push(0);
			this.discard_stacks.push([0, 0, 0, 0, 0]);
			this.max_ranks.push(5);

			for (let rank = 1; rank <= 5; rank++) {
				all_possible.push(new Card(suitIndex, rank));
			}
		}

		for (let i = 0; i < this.numPlayers; i++) {
			this.hands.push(new Hand());
			this.all_possible.push(Utils.objClone(all_possible));
		}
	}

	/**
	 * Returns a blank copy of the state, as if the game had restarted.
	 */
	createBlank() {
		return new State(this.tableID, this.playerNames, this.ourPlayerIndex, this.suits);
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
     * @param {Card} _card
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
		if (this.rewindDepth > 2) {
			throw new Error('attempted to rewind too many times!');
		}
		else if (action_index === undefined) {
			logger.error('tried to rewind before any reasoning was done!');
			return false;
		}
		this.rewindDepth++;

		const pivotal_action = /** @type {ClueAction} */ (this.actionList[action_index]);
		pivotal_action.mistake = mistake || this.rewindDepth > 1;
		logger.warn(`Rewinding to before ${JSON.stringify(pivotal_action)} to insert ${JSON.stringify(rewind_action)}`);

		const new_state = this.createBlank();
		const history = this.actionList.slice(0, action_index);

		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			// Get up to speed
			for (const action of history) {
				new_state.handle_action(action, true);
			}
		});

		// Rewrite and save as a rewind action
		new_state.handle_action(rewind_action, true);
		new_state.handle_action(pivotal_action, true);

		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			// Redo all the following actions
			const future = this.actionList.slice(action_index + 1);
			for (const action of future) {
				new_state.handle_action(action, true);
			}
		});

		logger.highlight('green', '------- REWIND COMPLETE -------');

		// Overwrite state
		Object.assign(this, new_state);
		Utils.globalModify({ state: this });

		this.rewindDepth = 0;
		return true;
	}

	navigate(turn) {
		logger.highlight('greenb', `------- NAVIGATING (turn ${turn}) -------`);

		const new_state = this.createBlank();
		Utils.globalModify({ state: new_state });

		// Remove special actions from the action list (they will be added back in when rewinding)
		const actionList = this.actionList.filter(action => action.type !== 'identify' && action.type !== 'ignore');

		let turn_count = 0, action_index = 0;

		// Don't log history
		logger.wrapLevel(logger.LEVELS.ERROR, () => {
			while (turn_count < turn - 1) {
				const action = actionList[action_index];
				new_state.handle_action(action, true);
				action_index++;

				if (action.type === 'turn') {
					turn_count++;
				}
			}
		});

		// Log the previous turn and the 'turn' action leading to the desired turn
		while (turn_count < turn) {
			const action = actionList[action_index];
			new_state.handle_action(action);
			action_index++;

			if (action.type === 'turn') {
				turn_count++;
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
		const hypo_state = Utils.objClone(this);

		if (options.simulatePlayerIndex !== undefined) {
			hypo_state.ourPlayerIndex = options.simulatePlayerIndex;
		}

		logger.wrapLevel(options.enableLogs ? logger.level : logger.LEVELS.ERROR, () => {
			hypo_state.interpret_clue(hypo_state, action);
		});

		return hypo_state;
	}
}
