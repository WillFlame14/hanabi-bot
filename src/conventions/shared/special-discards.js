import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 */

/**
 * Interprets a gentleman's discard.
 * 
 * Impure! (modifies common)
 * @param {Game} game
 * @param {DiscardAction} discardAction
 * @param {(state: State, playerIndex: number, connected?: number[]) => number} find_finesse
 * @returns {number[]} 					The target(s) for the gentleman's discard
 */
export function interpret_gd(game, discardAction, find_finesse) {
	const { common, state } = game;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	/** @param {number} index */
	const gd_target = (index) => {
		/** @param {number} order */
		const matches = (order) =>
			state.deck[order].matches(identity) ||
			(index === state.ourPlayerIndex && state.deck[order].identity() === undefined && common.thoughts[order].possible.has(identity));

		let finesse = find_finesse(state, index);

		if (finesse !== undefined && matches(finesse))
			return [finesse];

		const finessed = /** @type {number[]} */ ([]);

		while (finesse !== undefined && state.isPlayable(state.deck[finesse])) {
			finessed.push(finesse);
			finesse = find_finesse(state, index, finessed);

			if (finesse !== undefined && matches(finesse))
				return finessed.concat(finesse);
		}

		return [];
	};

	// Discarder cannot gd to themselves, and we always try to assume on others before self.
	const player_precedence = Utils.range(0, state.numPlayers).filter(i => i !== playerIndex && i !== state.ourPlayerIndex).concat(state.ourPlayerIndex);
	const orders = player_precedence.map(gd_target).find(orders => orders.length > 0) ?? [];

	if (orders.length === 0) {
		logger.warn(`couldn't find a valid target for gentleman's discard`);
		return [];
	}

	for (const order of orders) {
		common.updateThoughts(order, (draft) => {
			draft.inferred = common.thoughts[order].inferred.intersect(order === orders.at(-1) ? identity : state.deck[order].identity());
			draft.known = true;
			draft.trash = false;
		});
	}

	logger.highlight('yellow', `writing ${logCard(identity)} from gentleman's discard on ${orders} ${state.playerNames[state.hands.findIndex(hand => hand.includes(orders[0]))]}`);
	return orders;
}

/**
 * Interprets a baton discard.
 * 
 * Impure! (modifies common)
 * @param {Game} game
 * @param {DiscardAction} discardAction
 * @param {(state: State, playerIndex: number) => number[]} baton_targets
 * @returns {number[]} 					The target(s) for the baton discard
 */
export function interpret_baton(game, discardAction, baton_targets) {
	const { common, state } = game;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	/** @param {number} index */
	const baton_target = (index) =>
		baton_targets(state, index).filter(order =>
			state.deck[order].matches(identity) ||
			(index === state.ourPlayerIndex && state.deck[order].identity() === undefined && common.thoughts[order].possible.has(identity)));

	// Discarder cannot baton to themselves, and we always try to assume on others before self.
	const player_precedence = Utils.range(0, state.numPlayers).filter(i => i !== playerIndex && i !== state.ourPlayerIndex).concat(state.ourPlayerIndex);
	const orders = player_precedence.map(baton_target).find(orders => orders.length > 0) ?? [];

	if (orders.length === 0) {
		logger.warn(`couldn't find a valid target for baton discard`);
		return [];
	}

	if (orders.length > 1) {
		// Unknown baton location
		for (const order of orders) {
			common.updateThoughts(order, (draft) => {
				draft.inferred = common.thoughts[order].inferred.union(identity);
				draft.trash = false;
			});
		}
	}
	else {
		common.updateThoughts(orders[0], (draft) => {
			draft.inferred = common.thoughts[orders[0]].inferred.intersect(identity);
			draft.known = true;
			draft.trash = false;
		});
	}

	logger.highlight('yellow', `writing ${logCard(identity)} from baton discard on ${state.playerNames[state.hands.findIndex(hand => hand.includes(orders[0]))]}`);
	return orders;
}
