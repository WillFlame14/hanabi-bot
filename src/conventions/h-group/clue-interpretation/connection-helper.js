import { CLUE } from '../../../constants.js';
import { determine_focus } from '../hanabi-logic.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';
import { isBasicTrash } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnections } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 * @typedef {import('../../../types.js').SymFocusPossibility} SymFocusPossibility
 */

/**
 * Determines whether the receiver can infer the exact identity of the focused card.
 * @param {{ connections: Connection[]}[]} all_connections
 */
export function inference_known(all_connections) {
	if (all_connections.length > 1)
		return false;

	const { connections } = all_connections[0];
	return connections.length === 0 || connections.every(conn => conn.type === 'known' || (conn.type === 'playable' && conn.known));
}

/**
 * Returns the inferred rank of the card given a set of connections on a particular suit.
 * @param {State} state
 * @param {number} suitIndex
 * @param {Connection[]} connections
 */
export function inference_rank(state, suitIndex, connections) {
	return state.play_stacks[suitIndex] + 1 + connections.filter(conn => !conn.hidden).length;
}

/**
 * Adds all symmetric connections to the list of waiting connections in the state.
 * @param {State} state
 * @param {SymFocusPossibility[]} symmetric_connections
 * @param {FocusPossibility[]} existing_connections
 * @param {ActualCard} focused_card
 * @param {number} giver
 */
export function add_symmetric_connections(state, symmetric_connections, existing_connections, focused_card, giver) {
	for (const sym of symmetric_connections) {
		const { connections, suitIndex, rank, fake } = sym;

		// No connections required
		if (connections.length === 0)
			continue;

		// Matches an inference we have
		if (existing_connections.some((conn) => conn.suitIndex === suitIndex && conn.rank === rank))
			continue;

		state.common.waiting_connections.push({ connections, conn_index: 0, focused_card, inference: { suitIndex, rank }, giver, action_index: state.actionList.length - 1, fake, symmetric: true });
	}
}

/**
 * Returns all focus possibilities that the receiver could interpret from the clue.
 * @param {State} state
 * @param {ClueAction} action
 * @param {boolean} looksSave
 * @param {number[]} selfRanks 		The ranks needed to play by the target (as a self-finesse).
 * @param {number} ownBlindPlays 	The number of blind plays we need to make in the actual connection.
 */
export function find_symmetric_connections(state, action, looksSave, selfRanks, ownBlindPlays) {
	const { giver, list, target } = action;
	const { order } = determine_focus(state.hands[target], state.common, list, { beforeClue: true }).focused_card;
	const focused_card = state.common.thoughts[order];

	/** @type {SymFocusPossibility[]} */
	const symmetric_connections = [];

	/** @type {{ id: Identity, connections: Connection[] }[]} */
	const self_connections = [];

	/** @type {{ id: Identity, connections: Connection[] }[]} */
	const non_self_connections = [];

	for (const id of focused_card.inferred) {
		if (isBasicTrash(state, id))
			continue;

		const looksDirect = focused_card.identity() === undefined && (		// Focus must be unknown AND
			action.clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
			state.common.hypo_stacks.some(stack => stack + 1 === action.clue.value) ||		// Looks like a play
			looksSave);																		// Looks like a save

		logger.collect();
		try {
			const connections = find_own_finesses(state, giver, target, id, looksDirect, target, selfRanks);
			if (connections[0]?.reacting === target)
				self_connections.push({ id, connections });
			else
				non_self_connections.push({ id, connections });
		}
		catch (error) {
			if (error instanceof IllegalInterpretation)
				// Will probably never be seen
				logger.warn(error.message);
			else
				throw error;
		}
		logger.flush(false);
	}

	/** @type {(conns: Connection[], playerIndex: number) => number} */
	const blind_plays = (conns, playerIndex) => conns.filter(conn => conn.type === 'finesse' && conn.reacting === playerIndex).length;

	const possible_connections = non_self_connections.length === 0 ? self_connections : non_self_connections;

	// All connections with the minimum number of target blind plays will be considered
	const blind_plays_arr = possible_connections.map(({ connections }) => blind_plays(connections, target));
	const min_blind_plays = blind_plays_arr.reduce((min, curr) => Math.min(min, curr), 10);

	for (let i = 0; i < possible_connections.length; i++) {
		if (blind_plays_arr[i] === min_blind_plays) {
			const { id, connections } = possible_connections[i];
			symmetric_connections.push({
				connections,
				suitIndex: id.suitIndex,
				rank: inference_rank(state, id.suitIndex, connections),
				fake: blind_plays(connections, state.ourPlayerIndex) > ownBlindPlays
			});
		}
	}

	const sym_conn = symmetric_connections.map(conn => {
		const nextIdentity = { suitIndex: conn.suitIndex, rank: conn.rank };
		return logConnections(conn.connections, nextIdentity) + (conn.fake ? ' (fake)' : '');
	});

	logger.info('symmetric connections', sym_conn);
	return symmetric_connections;
}


/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {State} state
 * @param {Connection[]} connections
 * @param {{symmetric?: boolean, target?: number, fake?: boolean}} [options] 	If this is a symmetric connection, this indicates the only player we should write notes on.
 */
export function assign_connections(state, connections, options = {}) {
	const hypo_stacks = Utils.objClone(state.common.hypo_stacks);

	for (const connection of connections) {
		const { type, reacting, hidden, card: conn_card, known, identities } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = state.common.thoughts[conn_card.order];

		// Do not write notes on:
		// - fake connections (where we need to blind play more than necessary)
		// - symmetric connections on anyone not the target, since they actually know their card
		if (options?.fake || (options?.symmetric && reacting !== options.target))
			continue;

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		if (!card.superposition && card.old_inferred === undefined)
			card.old_inferred = card.inferred.slice();

		if (type === 'finesse') {
			card.finessed = true;
			card.finesse_index = state.actionList.length;
			card.hidden = hidden;
		}

		if (hidden) {
			const playable_identities = hypo_stacks.map((stack_rank, index) => {
				return { suitIndex: index, rank: stack_rank + 1 };
			});
			card.intersect('inferred', playable_identities);

			// Temporarily force update hypo stacks so that layered finesses are written properly (?)
			if (card.identity() !== undefined) {
				const { suitIndex, rank } = card.identity();
				if (hypo_stacks[reacting][suitIndex] + 1 !== rank)
					logger.warn('trying to connect', logCard(card), 'but hypo stacks at', hypo_stacks[suitIndex]);

				hypo_stacks[suitIndex] = rank;
			}
		}
		else {
			// There are multiple possible connections on this card
			if (card.superposition) {
				card.union('inferred', identities);
			}
			else {
				if (!(type === 'playable' && !known))
					card.assign('inferred', identities);

				card.superposition = true;
			}
		}

		// Updating notes not on our turn
		// There might be multiple possible inferences on the same card from a self component
		// TODO: Examine why this originally had self only?
		if (card.old_inferred.length > card.inferred.length && card.reasoning.at(-1) !== state.actionList.length - 1) {
			card.reasoning.push(state.actionList.length - 1);
			card.reasoning_turn.push(state.turn_count);
		}
	}
}
