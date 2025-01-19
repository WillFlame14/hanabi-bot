import { reset_superpositions, team_elim } from '../../basics/helper.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import { remove_finesse, resolve_card_played, resolve_card_retained, resolve_other_play } from './update-wcs.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').IdentifyAction} IdentifyAction
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 * @typedef {import('../../types.js').Demonstration} Demonstration
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
			!identities.some(id => state.deck[order].matches(id));
	});
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 * @param {number} lastPlayerIndex
 * @returns {{remove?: boolean, remove_finesse?: boolean, next_index?: number, quit?: boolean, demonstration?: Demonstration, ambiguousPassback?: boolean, selfPassback?: boolean }}
 */
function update_wc(game, waiting_connection, lastPlayerIndex) {
	const { common, state, me } = game;
	const { connections, conn_index, focus, inference } = waiting_connection;
	const { type, reacting, order, identities } = connections[conn_index];
	const card = state.deck[order];
	logger.info(`waiting for connecting ${logCard(card)} ${type} ${order} as ${identities.map(logCard)} (${state.playerNames[reacting]}) for inference ${logCard(inference)} ${focus}${waiting_connection.symmetric ? ' (symmetric)' : ''}`);

	const impossible_conn = find_impossible_conn(game, connections.slice(conn_index));
	if (impossible_conn !== undefined) {
		logger.warn(`future connection depends on revealed card having identities ${impossible_conn.identities.map(logCard)}, removing`);
		return { remove: true, remove_finesse: true };
	}

	if (connections[0]?.type !== 'positional' && !common.thoughts[focus].possible.has(inference)) {
		logger.warn(`connection depends on focused card having identity ${logCard(inference)}, removing`);
		return { remove: true, remove_finesse: true };
	}

	if (other_play(game, waiting_connection, lastPlayerIndex))
		return resolve_other_play(game, lastPlayerIndex, waiting_connection);

	const last_reacting_action = game.last_actions[reacting];

	// After the turn we were waiting for
	if (lastPlayerIndex === reacting) {
		// They still have the card
		if (state.hands[reacting].includes(order))
			return resolve_card_retained(game, waiting_connection);

		// The card was played
		if (last_reacting_action.type === 'play')
			return resolve_card_played(game, waiting_connection);

		// The card was discarded and its copy is not visible
		if (last_reacting_action.type === 'discard' && visibleFind(state, me, card).length === 0 && !last_reacting_action.intentional) {
			logger.info(`waiting card ${logCard(card)} discarded?? removing finesse`);
			return { remove: true, remove_finesse: true };
		}
	}
	return { remove: false };
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 * @param {number} lastPlayerIndex
 */
function other_play(game, waiting_connection, lastPlayerIndex) {
	const { me } = game;
	const { connections, conn_index } = waiting_connection;
	const { reacting, order, hidden, identities } = connections[conn_index];
	const last_action = game.last_actions[lastPlayerIndex];

	// The card needs to match our thoughts as well as the hypothesized identity in the connection
	return last_action?.type === 'play' && lastPlayerIndex !== reacting && identities.length === 1 &&
		me.thoughts[order].matches(last_action, { infer: true }) && me.thoughts[order].matches(identities[0], { infer: true }) &&
		!hidden;	// Do not advance if the real connection is a layered finesse, because that player will not skip
}

/**
 * Performs relevant updates after someone takes a turn.
 * 
 * Impure!
 * @param {Game} game
 * @param {TurnAction} action
 */
export function update_turn(game, action) {
	const { common, state, me } = game;
	const { currentPlayerIndex } = action;
	const lastPlayerIndex = state.lastPlayerIndex(currentPlayerIndex);

	/** @type {Set<number>} */
	const to_remove = new Set();

	/** @type {Map<number, Demonstration[]>} */
	const demonstrated = new Map();

	/** @type {Set<number>} Waiting connections that we have to remove finesses for. */
	const remove_finesses = new Set();

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const waiting_connection = common.waiting_connections[i];

		const { quit, remove, remove_finesse, demonstration, ambiguousPassback, selfPassback, next_index }
			= update_wc(game, waiting_connection, lastPlayerIndex);

		if (quit)
			return;

		if (remove)
			to_remove.add(i);

		if (remove_finesse)
			remove_finesses.add(i);

		if (demonstration !== undefined) {
			const { order } = demonstration;
			if (demonstrated.has(order))
				demonstrated.get(order).push(demonstration);
			else
				demonstrated.set(order, [demonstration]);
		}

		waiting_connection.conn_index = remove ? -1 : next_index ?? waiting_connection.conn_index;
		waiting_connection.ambiguousPassback ||= ambiguousPassback;
		waiting_connection.selfPassback ||= selfPassback;
	}

	reset_superpositions(game);

	// Once a finesse has been demonstrated, the card's identity must be one of the inferences
	for (const [order, demonstrations] of demonstrated.entries()) {
		const inferences = demonstrations.flatMap(d => d.inference);
		logger.info(`intersecting card ${logCard(state.deck[order])} with inferences ${inferences.map(logCard).join(',')}`);

		/** @type {(c_order: number, ids: Identity[]) => ((draft: import('../../types.js').Writable<Card>) => void)} */
		const update_card = (c_order, ids) => (draft) => {
			const card = common.thoughts[c_order];
			const new_inferred = card.inferred[card.superposition ? 'union' : 'intersect'](ids).union(state.deck[c_order].identity() ?? state.base_ids);
			draft.inferred = new_inferred;
			draft.superposition = true;
			draft.uncertain = false;
			draft.info_lock = new_inferred.clone();
		};

		common.updateThoughts(order, update_card(order, inferences));
	}

	let min_drawn_index = state.actionList.length;

	// Rewind any confirmed finesse connections we have now
	/** @type {IdentifyAction[]} */
	const rewind_actions = demonstrated.keys().reduce((acc, order) => {
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
			new_game.updateNotes();
			Object.assign(game, new_game);
			return;
		}
	}

	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { focus, inference } = common.waiting_connections[i];
		const { suitIndex, rank } = inference;

		// Filter out connections that have been removed (or connections to the same card where others have been demonstrated)
		if (demonstrated.has(focus) && !demonstrated.get(focus).some(d => d.inference.suitIndex === suitIndex && d.inference.rank === rank)) {
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
