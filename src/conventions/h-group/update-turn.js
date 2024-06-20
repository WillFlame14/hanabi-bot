import { LEVEL } from './h-constants.js';
import { reset_superpositions, team_elim } from '../../basics/helper.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import { inBetween, older_queued_finesse } from './hanabi-logic.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
export function remove_finesse(game, waiting_connection) {
	const { common, state } = game;
	const { connections, focused_card, inference, symmetric } = waiting_connection;
	const focus_thoughts = common.thoughts[focused_card.order];

	// Remove remaining finesses
	for (const connection of connections) {
		const card = common.thoughts[connection.card.order];

		if (card === undefined) {
			logger.warn(`card ${logCard(connection.card)} with order ${connection.card.order} no longer exists in hand to cancel connection`);
			continue;
		}

		// Notes are not written on symmetric connections. Thus, no need to remove finesses
		if (symmetric)
			continue;

		if (connection.type === 'finesse' || connection.type === 'prompt') {
			if (card.hidden)
				card.inferred.value = 0;
			else
				card.inferred = card.inferred.subtract(connection.identities);
		}

		if (!card.superposition && card.inferred.length === 0) {
			card.finessed = false;
			card.hidden = false;

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
	focus_thoughts.inferred = focus_thoughts.inferred.subtract(inference);
	common.update_hypo_stacks(state);
}

/**
 * @param {Game} game
 * @param {number} reacting
 * @param {number} order
 * @param {WaitingConnection} waiting_connection
 */
function stomped_finesse(game, reacting, order, waiting_connection) {
	const { common, state } = game;
	const thoughts = common.thoughts[order];

	return thoughts.clued && thoughts.clues.at(-1).turn > waiting_connection.turn && (thoughts.focused ||
		(common.thinksPlayables(state, reacting).length === 0 && thoughts.inferred.every(i => state.isPlayable(i) || thoughts.matches(i, { assume: true }))));
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
function resolve_card_retained(game, waiting_connection) {
	const { common, state, me } = game;
	const { connections, conn_index, giver, target, inference, action_index, ambiguousPassback, selfPassback, focused_card } = waiting_connection;
	const { type, reacting, ambiguous, bluff, identities } = connections[conn_index];
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

	const last_reacting_action = game.last_actions[reacting];

	const old_finesse = connections.find((conn, i) => i >= conn_index && conn.reacting === state.ourPlayerIndex && conn.type === 'finesse')?.card;

	const new_finesse_queued = old_finesse !== undefined && state.hands[state.ourPlayerIndex].some(c => {
		const { finessed, finesse_index } = me.thoughts[c.order];
		return finessed && finesse_index > me.thoughts[old_finesse.order].finesse_index;
	});

	// Didn't play into finesse
	if (type === 'finesse' || type === 'prompt' || new_finesse_queued) {
		if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
			logger.warn(`${state.playerNames[reacting]} didn't play into unplayable ${type}`);
			return { remove: false };
		}

		if (last_reacting_action?.type === 'clue') {
			// TODO: Maybe it's good to force demonstrating the connection immediately anyways; this can be confusing.
			if (stomped_finesse(game, reacting, order, waiting_connection)) {
				logger.warn(`finesse was stomped on, ${state.playerNames[reacting]} no longer needs to demonstrate connection immediately`);
				return { remove: false };
			}

			if (type === 'prompt') {
				logger.warn(`allowing ${state.playerNames[reacting]} to defer a prompt by giving a clue`);
				return { remove: false };
			}

			if (game.level >= LEVEL.INTERMEDIATE_FINESSES && type === 'finesse' && last_reacting_action.important) {
				logger.warn(`allowing ${state.playerNames[reacting]} to defer a finesse for an important clue`);
				return { remove: false };
			}
		}

		if (passback()) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but they need to play multiple non-hidden cards, passing back`);
			waiting_connection.ambiguousPassback = true;
			return { remove: false };
		}

		const old_finesse = older_queued_finesse(state.hands[reacting], common, order);

		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && old_finesse !== undefined) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, but they need to play into an older finesse that could be layered`);
			return { remove: false };
		}

		// Didn't play into a self-connection
		if (!bluff && reacting === target) {
			const alternate_conn = game.common.waiting_connections.find(wc =>
				wc.focused_card.order === focused_card.order && wc.connections.every(conn => conn.card.order !== order));

			if (alternate_conn !== undefined) {
				logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but alternate conn [${alternate_conn.connections.map(logConnection).join(' -> ')}] exists not using this card`);
				return { remove: false };
			}

			if (!inBetween(state.numPlayers, state.ourPlayerIndex, giver, reacting) && !selfPassback) {
				const our_finesse = common.find_finesse(state.hands[state.ourPlayerIndex]);

				if (our_finesse !== undefined && identities.some(i => common.thoughts[our_finesse.order].inferred.has(i))) {
					logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but we could have ${identities.map(logCard)} on finesse position`);
					waiting_connection.selfPassback = true;
					return { remove: false };
				}
			}
		}

		if (last_reacting_action?.type === 'play') {
			const { card: reacting_card } = last_reacting_action;

			if (type === 'finesse' && reacting_card) {
				const play = common.thoughts[reacting_card.order];

				if (play.finessed && play.finesse_index < common.thoughts[order].finesse_index) {
					logger.warn(`${state.playerNames[reacting]} played into older finesse, continuing to wait`);
					return { remove: false };
				}
			}
			else if (type === 'prompt') {
				logger.warn(`${state.playerNames[reacting]} played into something else, continuing to wait`);
				return { remove: false };
			}
		}

		// Check if the card could be superpositioned on a finesse that is not yet playable.
		const unplayable_connections = common.waiting_connections.filter(wc =>
			wc !== waiting_connection &&
			wc.connections.some((conn, index) =>
				index >= conn_index && conn.card.order === order && conn.identities.some(i => state.playableAway(i) > 0)) &&
			// The reacting player has to wait for someone else, or they already tried to play
			(wc.connections[wc.conn_index].reacting !== reacting || last_reacting_action?.type === 'play'));

		if (unplayable_connections.length > 0) {
			logger.warn('not all possibilities playable', unplayable_connections.map(wc =>
				`${wc.connections.map(logConnection).join(' -> ')}  (${wc.connections.find((conn, index) =>
					index >= conn_index && conn.card.order === order && conn.identities.some(i => state.playableAway(i) > 0)
				).identities.map(logCard).join()})`));
			return { remove: false };
		}

		logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, removing inference ${logCard(inference)}`);

		if (reacting !== state.ourPlayerIndex) {
			const real_connects = connections.filter((conn, index) => index < conn_index && !conn.hidden).length;
			game.rewind(action_index, { type: 'ignore', conn_index: real_connects, order, inference });
			return { quit: true };
		}

		// Can't remove finesses if we allow ourselves to "defer" an ambiguous finesse the first time around.
		if (ambiguous)
			logger.warn('not removing ambiguous finesse with connections:', waiting_connection.connections.map(logConnection));

		return { remove: true, remove_finesse: !ambiguous };
	}
	else if (last_reacting_action?.type === 'discard') {
		logger.warn(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);
		return { remove: true, remove_finesse: true };
	}
	return { remove: false };
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
function resolve_card_played(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, inference, target, focused_card } = waiting_connection;
	const { type, reacting, identities } = connections[conn_index];

	logger.info(`waiting card ${identities.length === 1 ? logCard(identities[0]) : '(unknown)'} played`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) =>
		index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

	if (type === 'finesse' || type === 'prompt') {
		// Finesses demonstrate that a card must be playable and not save
		const connection = game.last_actions[reacting].card;
		const thoughts = common.thoughts[connection.order];

		// Consider a stomped finesse if the played card was focused or they didn't choose to play it first
		if (type === 'finesse' && stomped_finesse(game, reacting, connection.order, waiting_connection)) {
			logger.warn(`connecting card was focused/known playable with a clue (stomped on), not confirming ${logCard(inference)} finesse`);

			if (connections[conn_index + 1]?.self) {
				logger.warn(`connection requires that we blind play, removing due to occam's razor`);
				return { remove: true, remove_finesse: true };
			}
		}
		else if (type === 'prompt' && thoughts.possible.length === 1) {
			logger.warn('connecting card was filled in completely, not confirming prompt');
		}
		else {
			// Should prompts demonstrate connections? Sometimes acting on asymmetric info can look like a prompt.
			const demonstration = (type === 'finesse' || game.level < LEVEL.INTERMEDIATE_FINESSES) ?
				{ card: focused_card, inferences: [inference], connections: connections.slice(conn_index + 1) } :
				undefined;

			const only_clued_connections_left = waiting_connection.connections.every((conn, index) =>
				index < conn_index || conn.type !== 'finesse' || conn.reacting === target);

			const remove = (demonstration !== undefined && only_clued_connections_left) || waiting_connection.conn_index === -1;
			return { demonstration, remove };
		}
	}

	return { remove: waiting_connection.conn_index === -1 };
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
function resolve_giver_play(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, giver } = waiting_connection;
	const { reacting, identities, card: old_card } = connections[conn_index];

	// Card may have been updated, so need to find it again
	const card = state.hands[reacting].findOrder(old_card.order);

	logger.highlight('cyan', `giver ${state.playerNames[giver]} played connecting card, continuing connections`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) =>
		index > conn_index && state.hands[conn.reacting].findOrder(conn.card.order));

	const thoughts = common.thoughts[card.order];
	// Remove finesse
	thoughts.inferred = thoughts.inferred.subtract(identities);

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
	return { remove: waiting_connection.conn_index === -1 };
}

/**
 * Performs relevant updates after someone takes a turn.
 * @param {Game} game
 * @param {TurnAction} action
 */
export function update_turn(game, action) {
	const { common, state, me } = game;
	const { currentPlayerIndex } = action;
	const lastPlayerIndex = (currentPlayerIndex + state.numPlayers - 1) % state.numPlayers;

	/** @type {Set<number>} */
	const to_remove = new Set();

	/** @type {{card: ActualCard, inferences: Identity[], connections: Connection[]}[]} */
	const demonstrated = [];

	/** @type {Set<number>} Waiting connections that we have to remove finesses for. */
	const remove_finesses = new Set();

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const waiting_connection = common.waiting_connections[i];
		const { connections, conn_index, focused_card, inference, giver, action_index } = waiting_connection;
		const { reacting, card: old_card, identities } = connections[conn_index];
		logger.info(`waiting for connecting ${logCard(old_card)} ${old_card.order} as ${identities.map(logCard)} (${state.playerNames[reacting]}) for inference ${logCard(inference)} ${focused_card.order}`);

		let remove = false, remove_finesse = false, quit = false;

		/** @type {{card: ActualCard, inferences: Identity[], connections: Connection[]}}*/
		let demonstration = undefined;

		const impossible_conn = connections.find((conn, index) => {
			const { reacting, card, identities } = conn;
			const current_card = common.thoughts[card.order];

			// No intersection between connection's identities and current card's possibilities
			if (current_card.possible.intersect(identities).value === 0)
				return true;

			const last_reacting_action = game.last_actions[reacting];

			return index >= conn_index &&
				last_reacting_action?.type === 'play' &&
				last_reacting_action?.card.order === card.order &&
				!identities.some(id => last_reacting_action.card.matches(id));
		});

		if (impossible_conn !== undefined) {
			logger.warn(`future connection depends on revealed card having identities ${impossible_conn.identities.map(logCard)}, removing`);
			remove_finesse = true;
			remove = true;
		}
		else if (!common.thoughts[focused_card.order].possible.has(inference)) {
			logger.warn(`connection depends on focused card having identity ${logCard(inference)}, removing`);
			remove_finesse = true;
			remove = true;
		}
		else {
			const last_reacting_action = game.last_actions[reacting];

			// After the turn we were waiting for
			if (lastPlayerIndex === reacting) {
				// They still have the card
				if (state.hands[reacting].findOrder(old_card.order) !== undefined) {
					({ remove, remove_finesse, quit } = resolve_card_retained(game, waiting_connection));
				}
				// The card was played
				else if (last_reacting_action.type === 'play') {
					({ remove, remove_finesse, demonstration } = resolve_card_played(game, waiting_connection));
				}
				// The card was discarded and its copy is not visible
				else if (last_reacting_action.type === 'discard' && visibleFind(state, me, old_card).length === 0) {
					if (!last_reacting_action.intentional) {
						logger.info(`waiting card ${logCard(old_card)} discarded?? removing finesse`);
						remove = true;
						remove_finesse = true;
					}
				}
			}
			// Check if giver played card that matches next connection
			else if (lastPlayerIndex === giver) {
				const last_action = game.last_actions[giver];
				if (last_action.type !== 'play')
					continue;

				// The giver's card must have been known before the finesse was given
				if (me.thoughts[old_card.order].matches(last_action, { infer: true }) &&
					common.thoughts[old_card.order].finessed &&
					common.thoughts[last_action.card.order].reasoning[0] < action_index
				)
					({ remove } = resolve_giver_play(game, waiting_connection));
			}
		}

		if (quit)
			return;

		if (remove)
			to_remove.add(i);

		if (remove_finesse)
			remove_finesses.add(i);

		if (demonstration !== undefined) {
			const prev_card = demonstrated.find(({ card }) => card.order === demonstration.card.order);
			if (prev_card === undefined)
				demonstrated.push(demonstration);
			else
				prev_card.inferences.push(inference);
		}
	}

	reset_superpositions(game);

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { card, inferences, connections } of demonstrated) {
		const thoughts = common.thoughts[card.order];
		logger.info(`intersecting card ${logCard(thoughts)} with inferences ${inferences.map(logCard).join(',')}`);

		for (const connection of connections) {
			const { reacting, identities } = connection;
			const connecting_card = common.thoughts[connection.card.order];

			if (!state.hands[reacting].some(c => c.order === connection.card.order))
				continue;

			if (!connecting_card.superposition) {
				connecting_card.inferred = connecting_card.inferred.intersect(identities);
				connecting_card.superposition = true;
			}
			else {
				connecting_card.inferred = connecting_card.inferred.union(identities);
			}
		}

		if (!thoughts.superposition) {
			thoughts.inferred = thoughts.inferred.intersect(inferences);
			thoughts.superposition = true;
		}
		else {
			thoughts.inferred = thoughts.inferred.union(inferences);
		}
	}

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { focused_card, inference } = common.waiting_connections[i];

		// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
		if (demonstrated.some(d => d.card.order === focused_card.order &&
			!d.inferences.some(inf => inference.suitIndex === inf.suitIndex && inference.rank === inf.rank))
		) {
			to_remove.add(i);
			remove_finesses.add(i);
		}
	}

	for (const i of remove_finesses)
		remove_finesse(game, common.waiting_connections[i]);

	// Note that good_touch_elim() can remove waiting_connections; it is probably better to do this first.
	common.waiting_connections = common.waiting_connections.filter((_, i) => !to_remove.has(i));

	common.update_hypo_stacks(state);

	reset_superpositions(game);
	common.good_touch_elim(state);
	team_elim(game);
}
