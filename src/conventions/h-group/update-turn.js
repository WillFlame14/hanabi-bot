import { reset_superpositions, team_elim } from '../../basics/helper.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import { remove_finesse, resolve_card_played, resolve_card_retained, resolve_giver_play } from './update-wcs.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 * 
 * @typedef Demonstration
 * @property {number} order
 * @property {Identity[]} inferences
 * @property {Connection[]} connections
 */

/**
 * @param {Game} game
 * @param {Connection[]} connections
 */
export function find_impossible_conn(game, connections) {
	const { common, state } = game;

	return connections.find(conn => {
		const { reacting, order, identities } = conn;
		const current_card = common.thoughts[order];

		// No intersection between connection's identities and current card's possibilities
		if (current_card.possible.intersect(identities).value === 0)
			return true;

		const last_reacting_action = game.last_actions[reacting];

		return last_reacting_action?.type === 'play' &&
			last_reacting_action?.order === order &&
			!identities.some(id => state.deck[last_reacting_action.order].matches(id));
	});
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 * @param {number} lastPlayerIndex
 * @returns {{remove?: boolean, remove_finesse?: boolean, quit?: boolean, demonstration?: Demonstration}}
 */
function update_wc(game, waiting_connection, lastPlayerIndex) {
	const { common, state, me } = game;
	const { connections, conn_index, focus, inference, giver, action_index } = waiting_connection;
	const { reacting, order: old_order, identities } = connections[conn_index];
	const old_card = state.deck[old_order];
	logger.info(`waiting for connecting ${logCard(old_card)} ${old_order} as ${identities.map(logCard)} (${state.playerNames[reacting]}) for inference ${logCard(inference)} ${focus}`);

	const impossible_conn = find_impossible_conn(game, connections.slice(conn_index));
	if (impossible_conn !== undefined) {
		logger.warn(`future connection depends on revealed card having identities ${impossible_conn.identities.map(logCard)}, removing`);
		return { remove_finesse: true, remove: true };
	}

	if (connections[0]?.type !== 'positional' && !common.thoughts[focus].possible.has(inference)) {
		logger.warn(`connection depends on focused card having identity ${logCard(inference)}, removing`);
		return { remove_finesse: true, remove: true };
	}

	const last_reacting_action = game.last_actions[reacting];

	// After the turn we were waiting for
	if (lastPlayerIndex === reacting) {
		// They still have the card
		if (state.hands[reacting].includes(old_order))
			return resolve_card_retained(game, waiting_connection);

		// The card was played
		if (last_reacting_action.type === 'play')
			return resolve_card_played(game, waiting_connection);

		// The card was discarded and its copy is not visible
		if (last_reacting_action.type === 'discard' && visibleFind(state, me, old_card).length === 0 && !last_reacting_action.intentional) {
			logger.info(`waiting card ${logCard(old_card)} discarded?? removing finesse`);
			return { remove_finesse: true, remove: true };
		}
	}

	// Check if giver played card that matches next connection
	if (lastPlayerIndex === giver) {
		const last_action = game.last_actions[giver];

		// The giver's card must have been known before the finesse was given
		if (last_action.type === 'play' && me.thoughts[old_order].matches(last_action, { infer: true }) &&
			common.thoughts[old_order].finessed &&
			common.thoughts[last_action.order].reasoning[0] < action_index
		)
			return resolve_giver_play(game, waiting_connection);
	}
	return {};
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

	/** @type {Demonstration[]} */
	const demonstrated = [];

	/** @type {Set<number>} Waiting connections that we have to remove finesses for. */
	const remove_finesses = new Set();

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const waiting_connection = common.waiting_connections[i];
		const { quit, remove, remove_finesse, demonstration } = update_wc(game, waiting_connection, lastPlayerIndex);

		if (quit)
			return;

		if (remove)
			to_remove.add(i);

		if (remove_finesse)
			remove_finesses.add(i);

		if (demonstration !== undefined) {
			const prev_demo = demonstrated.find(({ order }) => order === demonstration.order);
			if (prev_demo === undefined)
				demonstrated.push(demonstration);
			else
				prev_demo.inferences.push(waiting_connection.inference);
		}
	}

	reset_superpositions(game);

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const { order, inferences, connections } of demonstrated) {
		logger.info(`intersecting card ${logCard(state.deck[order])} with inferences ${inferences.map(logCard).join(',')}`);
		for (const { reacting, identities, order: conn_order } of connections) {
			if (!state.hands[reacting].includes(conn_order))
				continue;

			common.updateThoughts(conn_order, (draft) => {
				draft.inferred = common.thoughts[conn_order].inferred[draft.superposition ? 'union' : 'intersect'](identities);
				draft.superposition = true;
				draft.uncertain = false;
			});
		}

		common.updateThoughts(order, (draft) => {
			draft.inferred = common.thoughts[order].inferred[draft.superposition ? 'union' : 'intersect'](inferences);
			draft.superposition = true;
			draft.uncertain = false;
		});
	}

	let min_drawn_index = state.actionList.length;

	// Rewind any confirmed finesse connections we have now
	const rewind_actions = demonstrated.reduce((acc, { order }) => {
		const playerIndex = state.hands.findIndex(hand => hand.includes(order));

		if (playerIndex !== state.ourPlayerIndex || common.thoughts[order].rewinded)
			return acc;

		const id = common.thoughts[order].identity({ infer: true });
		if (id === undefined)
			return acc;

		acc.push({ type: 'identify', order: order, playerIndex: state.ourPlayerIndex, identities: [id] });

		if (state.deck[order].drawn_index < min_drawn_index)
			min_drawn_index = state.deck[order].drawn_index;

		return acc;
	}, []);

	if (rewind_actions.length > 0) {
		const new_game = game.rewind(min_drawn_index, rewind_actions);
		if (new_game) {
			Object.assign(game, new_game);
			return;
		}
	}

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { focus, inference } = common.waiting_connections[i];

		// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
		if (demonstrated.some(d => d.order === focus &&
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
	logger.debug('remaining wcs', game.common.waiting_connections.map(wc => wc.connections.map(logConnection).join(' -> ')));

	reset_superpositions(game);

	if (currentPlayerIndex === state.ourPlayerIndex) {
		// Find an anxiety play
		if (state.clue_tokens === 0 && me.thinksLocked(state, state.ourPlayerIndex)) {
			const anxiety = me.anxietyPlay(state, state.ourHand);
			const playable_poss = me.thoughts[anxiety].possible.filter(p => state.isPlayable(p));

			if (playable_poss.length > 0) {
				logger.info('writing anxiety on order', anxiety, playable_poss.map(logCard));
				common.updateThoughts(anxiety, (draft) => { draft.inferred = common.thoughts[anxiety].possible.intersect(playable_poss); });
			}
		}
	}

	common.update_hypo_stacks(state);
	common.good_touch_elim(state);
	team_elim(game);
}
