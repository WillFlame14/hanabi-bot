import { CLUE } from '../../../constants.js';
import { IdentitySet } from '../../../basics/IdentitySet.js';
import { determine_focus } from '../hanabi-logic.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnections } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 * @typedef {import('../../../types.js').SymFocusPossibility} SymFocusPossibility
 * @typedef {import('../../../types.js').WaitingConnection} WaitingConnection
 */

/**
 * Determines whether the receiver can infer the exact identity of the focused card.
 * @param {{ connections: Connection[]}[]} all_connections
 */
export function inference_known(all_connections) {
	if (all_connections.length > 1)
		return false;

	const { connections } = all_connections[0];
	return connections.length === 0 || connections.every(conn => conn.type === 'known' || (conn.type === 'playable' && conn.linked.length === 1));
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
 * Generates symmetric connections from a list of symmetric focus possibilities.
 * @param {State} state
 * @param {SymFocusPossibility[]} sym_possibilities
 * @param {FocusPossibility[]} existing_connections
 * @param {ActualCard} focused_card
 * @param {number} giver
 * @param {number} target
 * @returns {WaitingConnection[]}
 */
export function generate_symmetric_connections(state, sym_possibilities, existing_connections, focused_card, giver, target) {
	const symmetric_connections = [];

	for (const sym of sym_possibilities) {
		const { connections, suitIndex, rank, fake } = sym;

		// No connections required
		if (connections.length === 0)
			continue;

		// Matches an inference we have
		if (existing_connections.some((conn) => conn.suitIndex === suitIndex && conn.rank === rank))
			continue;

		symmetric_connections.push({
			connections,
			conn_index: 0,
			focused_card,
			inference: { suitIndex, rank },
			giver,
			target,
			action_index: state.actionList.length - 1,
			fake,
			symmetric: true
		});
	}

	return symmetric_connections;
}

/**
 * Returns all focus possibilities that the receiver could interpret from the clue.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {boolean} looksSave
 * @param {number[]} selfRanks 		The ranks needed to play by the target (as a self-finesse).
 * @param {number} ownBlindPlays 	The number of blind plays we need to make in the actual connection.
 * @returns {SymFocusPossibility[]}
 */
export function find_symmetric_connections(game, action, looksSave, selfRanks, ownBlindPlays) {
	const { common, state } = game;

	const { giver, list, target } = action;
	const { order } = determine_focus(state.hands[target], common, list, { beforeClue: true }).focused_card;
	const focused_card = common.thoughts[order];

	/** @type {{ id: Identity, connections: Connection[] }[]} */
	const self_connections = [];

	/** @type {{ id: Identity, connections: Connection[] }[]} */
	const non_self_connections = [];

	for (const id of focused_card.inferred) {
		if (state.isBasicTrash(id))
			continue;

		const visible_dupe = state.hands.some((hand, i) => {
			const useCommon = i === giver || i === target;

			return hand.some(c => {
				const card = (useCommon ? common : game.players[target]).thoughts[c.order];
				return card.matches(id, { infer: useCommon }) && c.order !== order && card.touched;
			});
		});

		if (visible_dupe)
			continue;

		const looksDirect = focused_card.identity() === undefined && (		// Focus must be unknown AND
			action.clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
			common.hypo_stacks.some(stack => stack + 1 === action.clue.value) ||		// Looks like a play
			looksSave);																		// Looks like a save

		logger.collect();
		try {
			const connections = find_own_finesses(game, action, id, looksDirect, target, selfRanks);
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

	// Filter out focus possibilities that are strictly more complicated (i.e. connections match up until some point, but has more self-components after)
	const simplest_connections = possible_connections.filter((conns, i) => !possible_connections.some((other_conns, j) =>
		i !== j && other_conns.connections.every((other_conn, index) => {
			const conn = conns.connections[index];

			return conn === undefined ||
				Utils.objEquals(other_conn, conn) ||
				(other_conn.reacting !== target && conn.reacting === target) ||
				(other_conn.reacting === target && conn.reacting === target && other_conns.connections.length < conns.connections.length);
		})));

	const symmetric_connections = simplest_connections.map(({ id, connections }) => ({
		connections,
		suitIndex: id.suitIndex,
		rank: inference_rank(state, id.suitIndex, connections),
		fake: blind_plays(connections, state.ourPlayerIndex) > ownBlindPlays
	}));

	const sym_conn = symmetric_connections.map(conn => {
		const nextIdentity = { suitIndex: conn.suitIndex, rank: conn.rank };
		return logConnections(conn.connections, nextIdentity) + (conn.fake ? ' (fake)' : '');
	});

	logger.info('symmetric connections', sym_conn);
	return symmetric_connections;
}


/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {Game} game
 * @param {Connection[]} connections
 * @param {{symmetric?: boolean, target?: number, fake?: boolean}} [options] 	If this is a symmetric connection, this indicates the only player we should write notes on.
 */
export function assign_connections(game, connections, options = {}) {
	const { common, state } = game;
	const hypo_stacks = Utils.objClone(common.hypo_stacks);

	for (const connection of connections) {
		const { type, reacting, hidden, card: conn_card, linked, identities } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = common.thoughts[conn_card.order];

		// Do not write notes on:
		// - fake connections (where we need to blind play more than necessary)
		// - symmetric connections on anyone not the target, since they actually know their card
		if (options?.fake || (options?.symmetric && reacting !== options.target))
			continue;

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		if (!card.superposition && card.old_inferred === undefined)
			card.old_inferred = card.inferred;

		if (type === 'finesse') {
			card.finessed = true;
			card.finesse_index = state.actionList.length;
			card.hidden = hidden;

			if (connection.certain)
				card.certain_finessed = true;
		}

		if (hidden) {
			const playable_identities = hypo_stacks.map((stack_rank, index) => ({ suitIndex: index, rank: stack_rank + 1 }));
			card.inferred = card.inferred.intersect(playable_identities);

			// Temporarily force update hypo stacks so that layered finesses are written properly (?)
			if (state.deck[card.order].identity() !== undefined) {
				const { suitIndex, rank } = state.deck[card.order].identity();
				if (hypo_stacks[suitIndex] + 1 !== rank)
					logger.warn('trying to connect', logCard(card), 'but hypo stacks at', hypo_stacks[suitIndex]);

				hypo_stacks[suitIndex] = rank;
			}
		}
		else {
			// There are multiple possible connections on this card
			if (card.superposition) {
				card.inferred = card.inferred.union(identities);
			}
			else {
				if (type === 'playable' && linked.length > 1) {
					const existing_link = common.links.find(link => {
						const { promised } = link;
						const { suitIndex, rank } = link.identities[0];
						return promised && identities[0].suitIndex === suitIndex && identities[0].rank === rank;
					});

					if (!(existing_link?.cards.length === linked.length && existing_link.cards.every(c => linked.some(l => l.order === c.order))))
						common.links.push({ promised: true, identities, cards: linked });
				}
				else {
					card.inferred = IdentitySet.create(state.variant.suits.length, identities);
				}

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
