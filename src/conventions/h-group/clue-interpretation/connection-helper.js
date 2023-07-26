import { CLUE } from '../../../constants.js';
import { Card } from '../../../basics/Card.js';
import { determine_focus } from '../hanabi-logic.js';
import { find_own_finesses } from './connecting-cards.js';
import { isBasicTrash } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').BasicCard} BasicCard
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Determines whether the receiver can infer the exact identity of the focused card.
 * @param {{ connections: Connection[]}[]} all_connections
 */
export function inference_known(all_connections) {
	if (all_connections.length > 1) {
		return false;
	}

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
 * @param {FocusPossibility[]} symmetric_connections
 * @param {FocusPossibility[]} existing_connections
 * @param {Card} focused_card
 * @param {number} giver
 */
export function add_symmetric_connections(state, symmetric_connections, existing_connections, focused_card, giver) {
	for (const sym of symmetric_connections) {
		const { connections, suitIndex, rank } = sym;

		// No connections required
		if (connections.length === 0) {
			continue;
		}

		// Matches an inference we have
		if (existing_connections.some((conn) => conn.suitIndex === suitIndex && conn.rank === rank)) {
			continue;
		}

		state.waiting_connections.push({ connections, focused_card, inference: { suitIndex, rank }, giver, action_index: state.actionList.length - 1 });
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
	const { focused_card } = determine_focus(state.hands[target], list, { beforeClue: true });

	/** @type {FocusPossibility[]} */
	const symmetric_connections = [];

	let conn_save, min_blind_plays = 10;
	let self_target = true;

	for (const card of focused_card.inferred) {
		if (isBasicTrash(state, card.suitIndex, card.rank)) {
			continue;
		}

		const looksDirect = focused_card.identity({ symmetric: true }) === undefined && (		// Focus must be unknown AND
			action.clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
			state.hypo_stacks[giver].some(stack => stack + 1 === action.clue.value) ||		// Looks like a play
			looksSave);																		// Looks like a save

		logger.collect();
		const { feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank, looksDirect, target, selfRanks);
		logger.flush(false);

		if (feasible) {
			// Starts with self-finesse or self-prompt on target
			if (connections[0]?.reacting === target) {
				const blind_plays = connections.filter(conn => conn.type === 'finesse' && conn.reacting === target).length;

				if (self_target && blind_plays < min_blind_plays) {
					conn_save = { connections, suitIndex: card.suitIndex, rank: inference_rank(state, card.suitIndex, connections) };
					min_blind_plays = blind_plays;
				}
			}
			// Doesn't start with self
			else {
				// Temp: if a connection with no self-component exists, don't consider any connection with a self-component
				self_target = false;
				const blind_plays = connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length;

				if (blind_plays === ownBlindPlays) {
					symmetric_connections.push({ connections, suitIndex: card.suitIndex, rank: inference_rank(state, card.suitIndex, connections) });
				}
			}
		}
	}

	if (self_target && conn_save !== undefined) {
		symmetric_connections.push(conn_save);
	}

	const sym_conn = symmetric_connections.map(conn => {
		return {
			connections: conn.connections.map(logConnection),
			inference: logCard({ suitIndex: conn.suitIndex, rank: conn.rank })
		};
	});

	logger.info('symmetric connections', sym_conn);
	return symmetric_connections;
}


/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {State} state
 * @param {Connection[]} connections
 */
export function assign_connections(state, connections) {
	// let next_rank = state.play_stacks[suitIndex] + 1;
	const hypo_stacks = state.hypo_stacks.slice();

	for (const connection of connections) {
		const { type, reacting, hidden, card: conn_card, known, identity } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = state.hands[reacting].findOrder(conn_card.order);

		logger.info(`connecting on order ${conn_card.order} (${logCard(conn_card)}) as ${logCard(identity)} order ${card.order} type ${type}`);

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		if (!card.superposition) {
			card.old_inferred = Utils.objClone(card.inferred);
		}

		if (type === 'finesse') {
			card.finessed = true;
			card.finesse_index = state.actionList.length;
			card.hidden = hidden;
		}

		if (hidden) {
			const playable_identities = hypo_stacks[reacting].map((stack_rank, index) => { return { suitIndex: index, rank: stack_rank + 1 }; });
			card.intersect('inferred', playable_identities);

			// Temporarily force update hypo stacks so that layered finesses are written properly (?)
			if (card.identity() !== undefined) {
				const { suitIndex: suitIndex2, rank: rank2 } = card.identity();
				if (hypo_stacks[reacting][suitIndex2] + 1 !== rank2) {
					logger.warn('trying to connect', logCard({ suitIndex: suitIndex2, rank: rank2 }), 'but hypo stacks at', hypo_stacks[suitIndex2]);
				}
				hypo_stacks[reacting][suitIndex2] = rank2;
			}
		}
		else {
			// There are multiple possible connections on this card
			if (card.superposition) {
				card.union('inferred', [identity]);
			}
			else {
				if (!(type === 'playable' && !known)) {
					card.inferred = [new Card(identity.suitIndex, identity.rank)];
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
