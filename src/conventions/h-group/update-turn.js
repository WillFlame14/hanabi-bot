import { update_hypo_stacks } from '../../basics/helper.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} State
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
			logger.warn(`card ${logCard(connection.card)} with order ${connection.card.order} no longer exists in hand to cancel connection`);
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
			logger.error(`no old inferences on card ${logCard(card)}! current inferences ${card.inferred.map(c => logCard(c))}`);
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
		const { connections, conn_index = 0, focused_card, inference, action_index, ambiguousPassback } = state.waiting_connections[i];
		const { type, reacting, card: old_card } = connections[conn_index];
		logger.info(`waiting for connecting ${logCard(connections[conn_index].card)} (${state.playerNames[reacting]}) for inference ${logCard(inference)}`);

		// Card may have been updated, so need to find it again
		const card = state.hands[reacting].findOrder(old_card.order);

		// After the turn we were waiting for
		if (reacting === lastPlayerIndex) {
			// They still have the card
			if (card !== undefined) {
				// Didn't play into finesse
				if (type === 'finesse') {
					if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
						logger.info(`${state.playerNames[reacting]} didn't play into unplayable finesse`);
					}
					else if (state.last_actions[reacting].card?.finessed) {
						logger.info(`${state.playerNames[reacting]} played into other finesse, continuing to wait`);
					}
					else if (connections.filter((conn, index) => index >= conn_index && !conn.hidden && conn.reacting === reacting).length > 1 && !ambiguousPassback) {
						logger.warn(`${state.playerNames[reacting]} didn't play into finesse but they need to play multiple non-hidden cards, passing back`);
						state.waiting_connections[i].ambiguousPassback = true;
					}
					else {
						logger.info(`${state.playerNames[reacting]} didn't play into finesse, removing inference ${logCard(inference)}`);
						const real_connects = connections.filter((conn, index) => index < conn_index && !conn.hidden).length;
						state.rewind(action_index, { type: 'ignore', playerIndex: reacting, conn_index: real_connects });
						return;
					}
				}
				else if (state.last_actions[reacting].type === 'discard') {
					logger.info(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);
					remove_finesse(state, i);
					to_remove.push(i);
				}
			}
			else {
				// The card was played
				if (state.last_actions[reacting].type === 'play') {
					logger.info(`waiting card ${logCard(old_card)} played`);

					state.waiting_connections[i].conn_index = conn_index + 1;
					if (state.waiting_connections[i].conn_index === connections.length) {
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
				else if (state.last_actions[reacting].type === 'discard' && visibleFind(state, state.ourPlayerIndex, old_card.suitIndex, old_card.rank).length === 0) {
					logger.info(`waiting card ${logCard(old_card)} discarded?? removing finesse`);
					remove_finesse(state, i);

					// Flag it to be removed
					to_remove.push(i);
				}
			}
		}
	}

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { card, inferences } of demonstrated) {
		logger.info(`intersecting card ${logCard(card)} with inferences ${inferences.map(c => logCard(c)).join(',')}`);
		card.intersect('inferred', inferences);
		// TODO: update hypo stacks?
	}

	// Filter out connections that have been removed
	state.waiting_connections = state.waiting_connections.filter((_, i) => !to_remove.includes(i));
}
