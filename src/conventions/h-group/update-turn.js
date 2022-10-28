import { update_hypo_stacks } from '../../basics/helper.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../logger.js';
import * as Utils from '../../util.js';

/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').TurnAction} TurnAction
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * @param {State} state
 * @param {number} waiting_index
 */
function remove_finesse(state, waiting_index) {
	const { connections, focused_card, inference } = state.waiting_connections[waiting_index];

	// Remove remaining finesses
	for (const connection of connections) {
		const { type, reacting } = connection;
		const card = state.hands[reacting].findOrder(connection.card.order);

		if (card === undefined) {
			logger.warn(`card ${Utils.logCard(connection.card)} with order ${connection.card.order} no longer exists in hand to cancel connection`);
			continue;
		}

		if (type === 'finesse') {
			card.finessed = false;
		}

		if (card.old_inferred !== undefined) {
			// Restore old inferences
			card.inferred = card.old_inferred;
			card.old_inferred = undefined;
		}
		else {
			logger.error(`no old inferences on card ${Utils.logCard(card)}! current inferences ${card.inferred.map(c => Utils.logCard(c))}`);
		}
	}

	// Remove inference
	focused_card.subtract('inferred', [inference]);

	// Update hypo stacks if the card is now playable
	if (focused_card.inferred.length === 1) {
		const { suitIndex, rank } = focused_card.inferred[0];
		if (state.hypo_stacks[suitIndex] + 1 === rank) {
			update_hypo_stacks(state);
		}
	}
}

/**
 * Performs relevant updates after someone takes a turn.
 * @param {State} state
 * @param {TurnAction} action
 */
export function update_turn(state, action) {
	const { currentPlayerIndex } = action;
	const lastPlayerIndex = (currentPlayerIndex + state.numPlayers - 1) % state.numPlayers;

	/** @type {number[]} */
	const to_remove = [];

	/** @type {{card: Card, inferences: {suitIndex: number, rank: number}[]}[]} */
	const demonstrated = [];

	for (let i = 0; i < state.waiting_connections.length; i++) {
		const { connections, focused_card, inference } = state.waiting_connections[i];
		logger.info(`next conn ${Utils.logCard(connections[0].card)} for inference ${Utils.logCard(inference)}`);
		const { type, reacting, card } = connections[0];

		// After the turn we were waiting for
		if (reacting === lastPlayerIndex) {
			// They still have the card
			if (state.hands[reacting].findOrder(card.order) !== undefined) {
				// Didn't play into finesse
				if (type === 'finesse' && state.play_stacks[card.suitIndex] + 1 === card.rank) {
					logger.info(`Didn't play into finesse, removing inference ${Utils.logCard(inference)}`);
					remove_finesse(state, i);

					// Flag it to be removed
					to_remove.push(i);
				}
				else if (type === 'finesse') {
					logger.info(`didn't play into unplayable finesse`);
				}
				else if (state.last_actions[reacting].type === 'discard') {
					logger.info(`Discarded with a waiting connection, removing inference ${Utils.logCard(inference)}`);
					remove_finesse(state, i);
					to_remove.push(i);
				}
			}
			else {
				// The card was played
				if (state.last_actions[reacting].type === 'play') {
					logger.info(`waiting card ${Utils.logCard(card)} played`);
					connections.shift();
					if (connections.length === 0) {
						to_remove.push(i);
					}

					// Finesses demonstrate that a card must be playable and not save
					if (type === 'finesse') {
						const prev_card = demonstrated.find(({ card }) => card.order === focused_card.order);
						if (prev_card === undefined) {
							demonstrated.push({card: focused_card, inferences: [inference]});
						}
						else {
							prev_card.inferences.push(inference);
						}
					}
				}
				// The card was discarded and its copy is not visible
				else if (state.last_actions[reacting].type === 'discard' && visibleFind(state, state.ourPlayerIndex, card.suitIndex, card.rank).length === 0) {
					logger.info(`waiting card ${Utils.logCard(card)} discarded?? removing finesse`);
					remove_finesse(state, i);

					// Flag it to be removed
					to_remove.push(i);
				}
			}
		}
	}

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { card, inferences } of demonstrated) {
		logger.info(`intersecting card ${Utils.logCard(card)} with inferences ${inferences.map(c => Utils.logCard(c)).join(',')}`);
		card.intersect('inferred', inferences);
		// TODO: update hypo stacks?
	}

	// Filter out connections that have been removed
	state.waiting_connections = state.waiting_connections.filter((_, i) => !to_remove.includes(i));
}
