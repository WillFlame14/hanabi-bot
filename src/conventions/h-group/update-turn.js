import { team_elim, update_hypo_stacks } from '../../basics/helper.js';
import { playableAway, visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * @param {State} state
 * @param {number} waiting_index
 * @param {boolean} undo_infs
 */
function remove_finesse(state, waiting_index, undo_infs = true) {
	const { connections, focused_card, inference } = state.common.waiting_connections[waiting_index];
	const focus_thoughts = state.common.thoughts[focused_card.order];

	// Remove remaining finesses
	for (const connection of connections) {
		const card = state.common.thoughts[connection.card.order];

		if (card === undefined) {
			logger.warn(`card ${logCard(connection.card)} with order ${connection.card.order} no longer exists in hand to cancel connection`);
			continue;
		}

		if (connection.type === 'finesse')
			card.finessed = false;

		if (undo_infs) {
			if (card.old_inferred !== undefined) {
				// Restore old inferences
				card.inferred = card.old_inferred;
				card.old_inferred = undefined;
			}
			else {
				logger.error(`no old inferences on card ${logCard(card)}! current inferences ${card.inferred.map(logCard)}`);
			}
		}
	}

	// Remove inference
	focus_thoughts.subtract('inferred', [inference]);

	// Update hypo stacks if the card is now playable
	if (focus_thoughts.inferred.length === 1) {
		const { suitIndex, rank } = focus_thoughts.inferred[0];
		if (state.common.hypo_stacks[suitIndex] + 1 === rank)
			update_hypo_stacks(state, state.common);
	}
}

/**
 * Performs relevant updates after someone takes a turn.
 * @param {State} state
 * @param {TurnAction} action
 */
export function update_turn(state, action) {
	const { common } = state;
	const { currentPlayerIndex } = action;
	const lastPlayerIndex = (currentPlayerIndex + state.numPlayers - 1) % state.numPlayers;

	/** @type {number[]} */
	const to_remove = [];

	/** @type {{card: ActualCard, inferences: {suitIndex: number, rank: number}[], connections: Connection[]}[]} */
	const demonstrated = [];

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { connections, conn_index, focused_card, inference, giver, action_index, fake, ambiguousPassback } = common.waiting_connections[i];
		const { type, reacting, card: old_card, identities } = connections[conn_index];
		logger.info(`waiting for connecting ${logCard(old_card)} ${old_card.order} as ${identities.map(logCard)} (${state.playerNames[reacting]}) for inference ${logCard(inference)} ${focused_card.order}`);

		// Card may have been updated, so need to find it again
		const card = state.hands[reacting].findOrder(old_card.order);

		// After the turn we were waiting for
		if (reacting === lastPlayerIndex) {
			// They still have the card
			if (card !== undefined) {
				// Determines if we need to pass back an ambiguous finesse.
				const passback = () => {
					const non_hidden_connections = connections.filter((conn, index) =>
						index >= conn_index && !conn.hidden && conn.reacting === reacting && conn.type === 'finesse');

					return reacting !== state.ourPlayerIndex && 	// can't pass back to ourselves
						non_hidden_connections.length > 1 &&		// they need to play more than 1 card
						!ambiguousPassback;							// haven't already tried to pass back
				};

				const { card: reacting_card } = state.last_actions[reacting];

				// Didn't play into finesse
				if (type === 'finesse') {
					if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
						logger.info(`${state.playerNames[reacting]} didn't play into unplayable finesse`);
					}
					else if (state.last_actions[reacting].type === 'play' && reacting_card && common.thoughts[reacting_card.order].finessed) {
						logger.info(`${state.playerNames[reacting]} played into other finesse, continuing to wait`);
					}
					else if (passback()) {
						logger.warn(`${state.playerNames[reacting]} didn't play into finesse but they need to play multiple non-hidden cards, passing back`);
						common.waiting_connections[i].ambiguousPassback = true;
					}
					else {
						// Check if the card could be superpositioned on a finesse that is not yet playable.
						const unplayable_connections = common.waiting_connections.filter((wc, index) =>
							index !== i && wc.connections.some((conn, index) =>
								index >= conn_index && conn.card.order === old_card.order && conn.identities.some(i => playableAway(state, i) > 0)));

						if (unplayable_connections.length > 0) {
							logger.warn(unplayable_connections.map(wc =>
								logCard(wc.connections.find((conn, index) => index >= conn_index && conn.card.order === old_card.order).card)), 'not all possibilities playable');
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
				}
				else if (state.last_actions[reacting].type === 'discard') {
					logger.info(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);
					remove_finesse(state, i);
					to_remove.push(i);
				}
			}
			else {
				// The card was played (and matches expectation)
				if (state.last_actions[reacting].type === 'play' &&
					identities.some(identity => state.last_actions[reacting].card.matches(identity))
				) {
					logger.info(`waiting card ${identities.length === 1 ? logCard(identities[0]) : '(unknown)'} played`);

					// Advance waiting connection to next card that still exists
					common.waiting_connections[i].conn_index = connections.findIndex((conn, index) =>
						index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

					if (common.waiting_connections[i].conn_index === -1)
						to_remove.push(i);

					// Finesses demonstrate that a card must be playable and not save
					if (type === 'finesse' || type === 'prompt') {
						const connection = state.last_actions[reacting].card;
						const thoughts = common.thoughts[connection.order];
						if (type === 'finesse' && connection.clued && thoughts.focused) {
							logger.warn('connecting card was focused with a clue (stomped on), not confirming finesse');
						}
						else if (type === 'prompt' && thoughts.possible.length === 1) {
							logger.warn('connecting card was filled in completely, not confirming prompt');
						}
						else {
							const prev_card = demonstrated.find(({ card }) => card.order === focused_card.order);
							if (prev_card === undefined)
								demonstrated.push({ card: focused_card, inferences: [inference], connections: connections.slice(conn_index + 1) });
							else
								prev_card.inferences.push(inference);
						}
					}
				}
				// The card was discarded and its copy is not visible
				else if (state.last_actions[reacting].type === 'discard' && visibleFind(state, state.me, old_card).length === 0) {
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
			if (last_action.type !== 'play')
				continue;

			// The giver's card must have been known before the finesse was given
			if (state.me.thoughts[old_card.order].matches(last_action, { infer: true }) && state.common.thoughts[old_card.order].finessed && state.common.thoughts[last_action.card.order].reasoning[0] < action_index) {
				logger.highlight('cyan', `giver ${state.playerNames[giver]} played connecting card, continuing connections`);

				// Advance waiting connection to next card that still exists
				common.waiting_connections[i].conn_index = connections.findIndex((conn, index) =>
					index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

				if (common.waiting_connections[i].conn_index === -1)
					to_remove.push(i);

				if (!fake) {
					const thoughts = state.common.thoughts[card.order];
					// Remove finesse
					thoughts.subtract('inferred', identities);

					if (thoughts.inferred.length === 0) {
						if (thoughts.old_inferred !== undefined) {
							// Restore old inferences
							thoughts.inferred = thoughts.old_inferred;
							thoughts.old_inferred = undefined;
						}
						else {
							logger.error(`no old inferences on card ${logCard(thoughts)}! current inferences ${thoughts.inferred.map(logCard)}`);
						}
						thoughts.finessed = false;
					}
				}
			}
		}
	}

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { card, inferences, connections } of demonstrated) {
		const thoughts = state.common.thoughts[card.order];
		logger.info(`intersecting card ${logCard(thoughts)} with inferences ${inferences.map(logCard).join(',')}`);

		for (const connection of connections) {
			const { reacting, identities } = connection;
			const connecting_card = state.common.thoughts[connection.card.order];
			const card_exists = state.hands[reacting].some(c => c.order === connection.card.order);

			if (!card_exists)
				continue;

			if (!connecting_card.superposition) {
				connecting_card.intersect('inferred', identities);
				connecting_card.superposition = true;
			}
			else {
				connecting_card.union('inferred', identities);
			}
		}

		if (!thoughts.superposition) {
			thoughts.intersect('inferred', inferences);
			thoughts.superposition = true;
		}
		else {
			thoughts.union('inferred', inferences);
		}
	}

	update_hypo_stacks(state, state.common);

	demonstrated.forEach(({card}) => state.common.thoughts[card.order].superposition = false);
	state.common.good_touch_elim(state);
	team_elim(state);

	// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
	common.waiting_connections = common.waiting_connections.filter((wc, i) =>
		!to_remove.includes(i) &&
		!demonstrated.some(d => d.card.order === wc.focused_card.order &&
			!d.inferences.some(inf => wc.inference.suitIndex === inf.suitIndex && wc.inference.rank === inf.rank)
		)
	);
}
