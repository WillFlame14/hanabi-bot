import { reset_superpositions, team_elim, update_hypo_stacks } from '../../basics/helper.js';
import { playableAway, visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';
import { LEVEL } from './h-constants.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * @param {State} state
 * @param {WaitingConnection} waiting_connection
 * @param {boolean} undo_infs
 */
function remove_finesse(state, waiting_connection, undo_infs = true) {
	const { connections, focused_card, inference, fake, symmetric } = waiting_connection;
	const focus_thoughts = state.common.thoughts[focused_card.order];

	const target = state.hands.findIndex(hand => hand.findOrder(focused_card.order));

	if (fake)
		return;

	// Remove remaining finesses
	for (const connection of connections) {
		const card = state.common.thoughts[connection.card.order];

		if (card === undefined) {
			logger.warn(`card ${logCard(connection.card)} with order ${connection.card.order} no longer exists in hand to cancel connection`);
			continue;
		}

		// Notes are not written on symmetric connections except for the target, since other players actually know their card(s).
		// Thus, no need to remove finesses
		if (symmetric && connection.reacting !== target)
			continue;

		if (connection.type === 'finesse') {
			card.finessed = false;
			card.hidden = false;
		}

		if (undo_infs && !card.superposition) {
			if (card.old_inferred !== undefined) {
				// Restore old inferences
				card.inferred = card.old_inferred;
				card.old_inferred = undefined;

				// Don't try to restore old inferences again
				card.superposition = true;
			}
			else {
				logger.error(`no old inferences on card ${logCard(card)} ${card.order} (while removing finesse)! current inferences ${card.inferred.map(logCard)}`);
			}
		}
	}

	// Remove inference
	focus_thoughts.subtract('inferred', [inference]);
	update_hypo_stacks(state, state.common);
}

/**
 * @param {State} state
 * @param {WaitingConnection} waiting_connection
 */
function resolve_card_retained(state, waiting_connection) {
	const { common } = state;
	const { connections, conn_index, inference, action_index, ambiguousPassback } = waiting_connection;
	const { type, reacting } = connections[conn_index];
	const { order } = connections[conn_index].card;

	// Card may have been updated, so need to find it again
	const card = state.hands[reacting].findOrder(order);

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
	if (type === 'finesse' || type === 'prompt') {
		if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
			logger.info(`${state.playerNames[reacting]} didn't play into unplayable ${type}`);
			return { remove: false };
		}
		else if (state.last_actions[reacting].type === 'play') {
			if (type === 'finesse' && reacting_card && common.thoughts[reacting_card.order].finessed) {
				logger.info(`${state.playerNames[reacting]} played into other finesse, continuing to wait`);
				return { remove: false };
			}
			else if (type === 'prompt') {
				logger.info(`${state.playerNames[reacting]} played into something else, continuing to wait`);
				return { remove: false };
			}
		}
		else if (type === 'prompt' && state.last_actions[reacting].type === 'clue') {
			logger.info(`allowing ${state.playerNames[reacting]} to defer a prompt by giving a clue`);
			return { remove: false };
		}
		else if (passback()) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but they need to play multiple non-hidden cards, passing back`);
			waiting_connection.ambiguousPassback = true;
			return { remove: false };
		}

		// Check if the card could be superpositioned on a finesse that is not yet playable.
		const unplayable_connections = common.waiting_connections.filter(wc =>
			wc !== waiting_connection && wc.connections.some((conn, index) =>
				index >= conn_index && conn.card.order === order && conn.identities.some(i => playableAway(state, i) > 0)));

		if (unplayable_connections.length > 0) {
			logger.warn('not all possibilities playable', unplayable_connections.map(wc =>
				wc.connections.find((conn, index) =>
					index >= conn_index && conn.card.order === order && conn.identities.some(i => playableAway(state, i) > 0)
				).identities.map(logCard)));
			return { remove: false };
		}

		logger.info(`${state.playerNames[reacting]} didn't play into ${type}, removing inference ${logCard(inference)}`);

		if (reacting !== state.ourPlayerIndex) {
			const real_connects = connections.filter((conn, index) => index < conn_index && !conn.hidden).length;
			state.rewind(action_index, { type: 'ignore', playerIndex: reacting, conn_index: real_connects, order });
			return { quit: true };
		}

		// Can't remove finesses if we allow ourselves to "defer" an ambiguous finesse the first time around.
		if (waiting_connection.symmetric)
			remove_finesse(state, waiting_connection);
		else
			logger.warn('deciding not to remove finesse with connections:', waiting_connection.connections.map(logConnection));

		return { remove: true };
	}
	else if (state.last_actions[reacting].type === 'discard') {
		logger.info(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);
		remove_finesse(state, waiting_connection);
		return { remove: true };
	}
	return { remove: false };
}

/**
 * @param {State} state
 * @param {WaitingConnection} waiting_connection
 */
function resolve_card_played(state, waiting_connection) {
	const { common } = state;
	const { connections, conn_index, inference, focused_card } = waiting_connection;
	const { type, reacting, identities } = connections[conn_index];

	logger.info(`waiting card ${identities.length === 1 ? logCard(identities[0]) : '(unknown)'} played`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) =>
		index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

	if (type === 'finesse' || type === 'prompt') {
		// Finesses demonstrate that a card must be playable and not save
		const connection = state.last_actions[reacting].card;
		const thoughts = common.thoughts[connection.order];

		if (type === 'finesse' && connection.clued && thoughts.focused) {
			logger.warn('connecting card was focused with a clue (stomped on), not confirming finesse');
		}
		else if (type === 'prompt' && thoughts.possible.length === 1) {
			logger.warn('connecting card was filled in completely, not confirming prompt');
		}
		else {
			// Should prompts demonstrate connections? Sometimes acting on asymmetric info can look like a prompt.
			const demonstration = (type === 'finesse' || state.level < LEVEL.INTERMEDIATE_FINESSES) ?
				{ card: focused_card, inferences: [inference], connections: connections.slice(conn_index + 1) } :
				undefined;
			return { demonstration, remove: waiting_connection.conn_index === -1 };
		}
	}

	return { remove: waiting_connection.conn_index === -1 };
}

/**
 * @param {State} state
 * @param {WaitingConnection} waiting_connection
 */
function resolve_giver_play(state, waiting_connection) {
	const { connections, conn_index, giver, fake } = waiting_connection;
	const { reacting, identities, card: old_card } = connections[conn_index];

	// Card may have been updated, so need to find it again
	const card = state.hands[reacting].findOrder(old_card.order);

	logger.highlight('cyan', `giver ${state.playerNames[giver]} played connecting card, continuing connections`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) =>
		index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

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
				logger.error(`no old inferences on card ${logCard(thoughts)} ${card.order} (while resolving giver play)! current inferences ${thoughts.inferred.map(logCard)}`);
			}
			thoughts.finessed = false;
		}
	}
	return { remove: waiting_connection.conn_index === -1 };
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
		const { connections, conn_index, focused_card, inference, giver, action_index } = common.waiting_connections[i];
		const { reacting, card: old_card, identities } = connections[conn_index];
		logger.info(`waiting for connecting ${logCard(old_card)} ${old_card.order} as ${identities.map(logCard)} (${state.playerNames[reacting]}) for inference ${logCard(inference)} ${focused_card.order}`);

		let remove = false;
		let quit = false;

		/** @type {{card: ActualCard, inferences: Identity[], connections: Connection[]}}*/
		let demonstration = undefined;

		const impossible_conn = connections.find((conn, index) => {
			const { reacting, card, identities } = conn;
			const last_reacting_action = state.last_actions[reacting];

			return index >= conn_index &&
				last_reacting_action?.type === 'play' &&
				last_reacting_action?.card.order === card.order &&
				!identities.some(id => last_reacting_action.card.matches(id));
		});

		if (impossible_conn !== undefined) {
			logger.warn(`future connection depends on played card having identities ${impossible_conn.identities.map(logCard)}, removing`);
			remove_finesse(state, common.waiting_connections[i]);
			remove = true;
		}
		else {
			// After the turn we were waiting for
			if (lastPlayerIndex === reacting) {
				// They still have the card
				if (state.hands[reacting].findOrder(old_card.order) !== undefined) {
					({ remove, quit} = resolve_card_retained(state, common.waiting_connections[i]));
				}
				// The card was played
				else if (state.last_actions[reacting].type === 'play') {
					({remove, demonstration} = resolve_card_played(state, common.waiting_connections[i]));
				}
				// The card was discarded and its copy is not visible
				else if (state.last_actions[reacting].type === 'discard' && visibleFind(state, state.me, old_card).length === 0) {
					logger.info(`waiting card ${logCard(old_card)} discarded?? removing finesse`);
					remove_finesse(state, common.waiting_connections[i]);
					remove = true;
				}
			}
			// Check if giver played card that matches next connection
			else if (lastPlayerIndex === giver) {
				const last_action = state.last_actions[giver];
				if (last_action.type !== 'play')
					continue;

				// The giver's card must have been known before the finesse was given
				if (state.me.thoughts[old_card.order].matches(last_action, { infer: true }) &&
					common.thoughts[old_card.order].finessed &&
					common.thoughts[last_action.card.order].reasoning[0] < action_index
				)
					({ remove } = resolve_giver_play(state, common.waiting_connections[i]));
			}
		}

		if (quit)
			return;

		if (remove)
			to_remove.push(i);

		if (demonstration !== undefined) {
			const prev_card = demonstrated.find(({ card }) => card.order === demonstration.card.order);
			if (prev_card === undefined)
				demonstrated.push(demonstration);
			else
				prev_card.inferences.push(inference);
		}
	}

	reset_superpositions(state);

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

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { focused_card, inference } = common.waiting_connections[i];

		// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
		if (demonstrated.some(d => d.card.order === focused_card.order &&
			!d.inferences.some(inf => inference.suitIndex === inf.suitIndex && inference.rank === inf.rank))
		) {
			to_remove.push(i);
			remove_finesse(state, common.waiting_connections[i]);
		}
	}

	// Note that good_touch_elim() can remove waiting_connections; it is probably better to do this first.
	common.waiting_connections = common.waiting_connections.filter((_, i) => !to_remove.includes(i));

	update_hypo_stacks(state, state.common);

	reset_superpositions(state);
	state.common.good_touch_elim(state);
	team_elim(state);
}
