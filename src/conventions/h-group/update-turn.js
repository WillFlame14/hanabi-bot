import { update_hypo_stacks } from '../../basics/helper.js';
import { playableAway, visibleFind } from '../../basics/hanabi-util.js';
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
 * @param {boolean} undo_infs
 */
function remove_finesse(state, waiting_index, undo_infs = true) {
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

		if (undo_infs) {
			if (card.old_inferred !== undefined) {
				// Restore old inferences
				card.inferred = card.old_inferred;
				card.old_inferred = undefined;
			}
			else {
				logger.error(`no old inferences on card ${logCard(card)}! current inferences ${card.inferred.map(c => logCard(c))}`);
			}
		}
	}

	// Remove inference
	focused_card.subtract('inferred', [inference]);

	// Update hypo stacks if the card is now playable
	if (focused_card.inferred.length === 1) {
		const { suitIndex, rank } = focused_card.inferred[0];
		if (state.hypo_stacks[state.ourPlayerIndex][suitIndex] + 1 === rank) {
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
		const { connections, conn_index = 0, focused_card, inference, giver, action_index, ambiguousPassback } = state.waiting_connections[i];
		const { type, reacting, card: old_card, identity } = connections[conn_index];
		logger.info(`waiting for connecting ${logCard(old_card)} (${state.playerNames[reacting]}) for inference ${logCard(inference)}`);

		// Card may have been updated, so need to find it again
		const card = state.hands[reacting].findOrder(old_card.order);

		// After the turn we were waiting for
		if (reacting === lastPlayerIndex) {
			// They still have the card
			if (card !== undefined) {
				/**
				 * Determines if the card could be superpositioned on a finesse that is not yet playable.
				 */
				const unknown_finesse = () => state.waiting_connections.some((wc, index) => {
					if (index === i) {
						return;
					}

					const identity = wc.connections.find((conn, index) => index >= conn_index && conn.card.order === old_card.order)?.identity;
					const unplayable = identity && playableAway(state, identity.suitIndex, identity.rank) > 0;

					if (unplayable) {
						logger.warn(logCard(identity), 'possibility not playable');
					}

					return unplayable;
				});

				// Didn't play into finesse
				if (type === 'finesse') {
					if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
						logger.info(`${state.playerNames[reacting]} didn't play into unplayable finesse`);
					}
					else if (state.last_actions[reacting].type === 'play' && state.last_actions[reacting].card?.finessed) {
						logger.info(`${state.playerNames[reacting]} played into other finesse, continuing to wait`);
					}
					else if (connections.filter((conn, index) =>
						index >= conn_index && !conn.hidden && conn.reacting === reacting && conn.type === 'finesse').length > 1 && !ambiguousPassback
					) {
						logger.warn(`${state.playerNames[reacting]} didn't play into finesse but they need to play multiple non-hidden cards, passing back`);
						state.waiting_connections[i].ambiguousPassback = true;
					}
					else if (unknown_finesse()) {
						logger.info(`${state.playerNames[reacting]} cannot play finesse due to additional possibilities, continuing to wait`);
					}
					else {
						logger.info(`${state.playerNames[reacting]} didn't play into finesse, removing inference ${logCard(inference)}`);
						if (reacting === state.ourPlayerIndex) {
							to_remove.push(i);
						}
						else {
							const real_connects = connections.filter((conn, index) => index < conn_index && !conn.hidden).length;
							state.rewind(action_index, { type: 'ignore', playerIndex: reacting, conn_index: real_connects });
							return;
						}
					}
				}
				else if (state.last_actions[reacting].type === 'discard') {
					logger.info(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);
					remove_finesse(state, i);
					to_remove.push(i);
				}
			}
			else {
				// The card was played (and matches expectation)
				if (state.last_actions[reacting].type === 'play' && state.last_actions[reacting].card.matches(identity.suitIndex, identity.rank)) {
					logger.info(`waiting card ${logCard(identity)} played`);

					state.waiting_connections[i].conn_index = conn_index + 1;
					if (state.waiting_connections[i].conn_index === connections.length) {
						to_remove.push(i);
					}

					// Finesses demonstrate that a card must be playable and not save
					if (type === 'finesse' || type === 'prompt') {
						const connection = state.last_actions[reacting].card;
						if (type === 'finesse' && connection.clued && connection.focused) {
							logger.warn('connecting card was focused with a clue (stomped on), not confirming finesse');
						}
						else if (type === 'prompt' && connection.possible.length === 1) {
							logger.warn('connecting card was filled in completely, not confirming prompt');
						}
						else {
							const prev_card = demonstrated.find(({ card }) => card.order === focused_card.order);
							if (prev_card === undefined) {
								demonstrated.push({card: focused_card, inferences: [inference]});
							}
							else {
								prev_card.inferences.push(inference);
							}
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
		// Check if giver played card that matches next connection
		else if (lastPlayerIndex === giver) {
			const last_action = state.last_actions[giver];

			if (last_action.type === 'play') {
				const { suitIndex, rank } = last_action;

				if (old_card.matches(suitIndex, rank, { infer: true }) && card.finessed) {
					logger.highlight('cyan', `giver ${state.playerNames[giver]} played connecting card, continuing connections`);
					// Advance connection
					state.waiting_connections[i].conn_index = conn_index + 1;
					if (state.waiting_connections[i].conn_index === connections.length) {
						to_remove.push(i);
					}

					// Remove finesse
					if (card.old_inferred !== undefined) {
						// Restore old inferences
						card.inferred = card.old_inferred;
						card.old_inferred = undefined;
					}
					else {
						logger.error(`no old inferences on card ${logCard(card)}! current inferences ${card.inferred.map(c => logCard(c))}`);
					}
					card.finessed = false;
				}
			}
		}
	}

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { card, inferences } of demonstrated) {
		logger.info(`intersecting card ${logCard(card)} with inferences ${inferences.map(c => logCard(c)).join(',')}`);
		if (!card.superposition) {
			card.intersect('inferred', inferences);
			card.superposition = true;
		}
		else {
			card.union('inferred', inferences);
		}
	}

	update_hypo_stacks(state);

	demonstrated.forEach(({card}) => card.superposition = false);

	// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
	state.waiting_connections = state.waiting_connections.filter((wc, i) =>
		!to_remove.includes(i) &&
		!demonstrated.some(d => d.card.order === wc.focused_card.order &&
			!d.inferences.some(inf => wc.inference.suitIndex === inf.suitIndex && wc.inference.rank === inf.rank)
		)
	);
}
