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
 * @typedef {import('../types.js').WaitingConnection} WaitingConnection
 */

export class State {
	turn_count = 0;
	clue_tokens = 8;
	early_game = true;
	rewindDepth = 0;

	hands = /** @type {Hand[]} */ ([]);

	play_stacks = /** @type {number[]} */ ([]);
	hypo_stacks = /** @type {number[]} */ ([]);
	discard_stacks = /** @type {number[][]} */ ([]);
	max_ranks = /** @type {number[]} */ ([]);

	all_possible = /** @type {Card[][]} */ ([]);

	actionList = /** @type {Action[]} */ ([]);
	last_actions = /** @type {Action[]} */ ([]);

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
     * @param {State} _state
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
	 * Rewinds the state to a particular action index, while rewriting the given card to its known identity.
     * @param {number} action_index
     * @param {number} playerIndex		The player that drew the rewinded card.
     * @param {number} order
     * @param {number} suitIndex
     * @param {number} rank
     * @param {boolean} finessed 		Whether the card was played as a finesse.
     */
	rewind(action_index, playerIndex, order, suitIndex, rank, finessed) {
		if (this.rewindDepth > 2) {
			throw new Error('attempted to rewind too many times!');
		}
		else if (action_index === undefined) {
			logger.error('tried to rewind before any reasoning was done!');
			return false;
		}
		this.rewindDepth++;

		logger.info(`card actually ${Utils.logCard({suitIndex, rank})}, rewinding to action_index ${action_index}`);
		const new_state = this.createBlank();
		const history = this.actionList.slice(0, action_index);

		logger.setLevel(logger.LEVELS.ERROR);

		// Get up to speed
		for (const action of history) {
			new_state.handle_action(action, true);
		}

		logger.setLevel(logger.LEVELS.INFO);

		// Rewrite and save as a rewind action
		const known_action = { type: 'rewind', order, playerIndex, suitIndex, rank };
		new_state.handle_action(known_action, true);
		logger.warn('Rewriting order', order, 'to', Utils.logCard({suitIndex, rank}));

		const pivotal_action = this.actionList[action_index];
		pivotal_action.mistake = finessed || this.rewindDepth > 1;
		logger.info('pivotal action', pivotal_action);
		new_state.handle_action(pivotal_action, true);

		logger.setLevel(logger.LEVELS.ERROR);

		// Redo all the following actions
		const future = this.actionList.slice(action_index + 1);
		for (const action of future) {
			new_state.handle_action(action, true);
		}

		logger.setLevel(logger.LEVELS.INFO);

		// Overwrite state
		Object.assign(this, new_state);
		this.rewindDepth = 0;
		return true;
	}

	/**
	 * Returns a hypothetical state where the provided clue was given.
	 * 
	 * The 'simulatePlayerIndex' option changes ourPlayerIndex to the given index.
	 * 
	 * The 'enableLogs' option causes all logs from the simulated state to be printed.
	 * Otherwise, only errors are printed from the simulated state.
     * @param {Omit<ClueAction, 'type'>} action
     * @param {{simulatePlayerIndex?: number, enableLogs?: boolean}} options
     */
	simulate_clue(action, options = {}) {
		const hypo_state = Utils.objClone(this);

		if (options.simulatePlayerIndex !== undefined) {
			hypo_state.ourPlayerIndex = options.simulatePlayerIndex;
		}

		if (!options.enableLogs) {
			logger.setLevel(logger.LEVELS.ERROR);
		}

		hypo_state.interpret_clue(hypo_state, action);
		logger.setLevel(logger.LEVELS.INFO);

		return hypo_state;
	}
}
