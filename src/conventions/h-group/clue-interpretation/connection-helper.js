import { CLUE } from '../../../constants.js';
import { IdentitySet } from '../../../basics/IdentitySet.js';
import { determine_focus } from '../hanabi-logic.js';
import { IllegalInterpretation, RewindEscape, find_own_finesses } from './own-finesses.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection, logConnections } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import { LEVEL } from '../h-constants.js';

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
	return state.play_stacks[suitIndex] + 1 + connections.filter(conn => !conn.hidden || conn.bluff).length;
}

/**
 * Returns whether playing an identity would be a valid bluff.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {number} reacting
 * @param {number[]} connected
 */
export function valid_bluff(game, action, identity, reacting, connected) {
	const nextCard = { suitIndex: identity.suitIndex, rank: identity.rank + 1 };
	const { giver, target, clue } = action;

	return game.level >= LEVEL.BLUFFS &&
		game.state.nextPlayerIndex(giver) === reacting &&					// must be bluff seat
		connected.length === 1 &&											// must not be delayed
		((clue.type === CLUE.RANK && clue.value !== nextCard.rank) ||
			!game.common.thoughts[connected[0]].inferred.has(nextCard)) &&	// must disconnect
		!(clue.type === CLUE.COLOUR && reacting === target) &&				// must not be self-colour bluff
		!game.state.hands[reacting].some(c => {								// must not be confused with an existing finesse
			const card = game.players[reacting].thoughts[c.order];
			return card.finessed && card.possible.has(identity);
		});
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
		const { connections, suitIndex, rank } = sym;

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
			turn: state.turn_count,
			symmetric: true
		});
	}

	return symmetric_connections;
}

/**
 * Returns all focus possibilities that the receiver could interpret from the clue.
 * @param {Game} new_game
 * @param {Game} game
 * @param {ClueAction} action
 * @param {FocusPossibility[]} inf_possibilities
 * @param {number[]} selfRanks 		The ranks needed to play by the target (as a self-finesse).
 * @param {number} ownBlindPlays 	The number of blind plays we need to make in the actual connection.
 * @returns {SymFocusPossibility[]}
 */
export function find_symmetric_connections(new_game, game, action, inf_possibilities, selfRanks, ownBlindPlays) {
	const { common, state } = game;

	const { giver, list, target } = action;
	const { order } = determine_focus(state.hands[target], common, list, { beforeClue: true }).focused_card;
	const focused_card = common.thoughts[order];

	/** @type {{ id: Identity, connections: Connection[], fake: boolean }[][]} */
	const [self_connections, non_self_connections] = inf_possibilities.reduce((acc, fp) => {
		const [self, non_self] = acc;
		const dest = (fp.connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.reacting === target) ? self: non_self;
		const { suitIndex, rank, connections } = fp;

		dest.push({ id: { suitIndex, rank }, connections, fake: false });
		return acc;
	}, [[], []]);

	/** @type {(conns: Connection[], playerIndex: number) => number} */
	const blind_plays = (conns, playerIndex) => conns.filter(conn => conn.type === 'finesse' && conn.reacting === playerIndex).length;

	for (const id of focused_card.inferred) {
		// Receiver won't consider trash possibilities or ones that are subsumed by real possibilities
		if (isTrash(state, common, id, focused_card.order) || inf_possibilities.some(fp => fp.suitIndex === id.suitIndex && fp.rank >= id.rank))
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
			inf_possibilities.some(fp => fp.save));										// Looks like a save

		logger.collect();
		try {
			const connections = find_own_finesses(game, action, id, looksDirect, target, selfRanks);
			// Fake connection - we need to blind play too many times
			const fake = blind_plays(connections, state.ourPlayerIndex) > ownBlindPlays;

			if (connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.reacting === target)
				self_connections.push({ id, connections, fake });
			else
				non_self_connections.push({ id, connections, fake });
		}
		catch (error) {
			if (error instanceof IllegalInterpretation) {
				// Will probably never be seen
				logger.warn(error.message);
			}
			else if (error instanceof RewindEscape) {
				Object.assign(new_game, game);
				logger.flush(false);
				return [];
			}
			else {
				throw error;
			}
		}
		logger.flush(false);
	}

	// If there is at least one non-fake connection that doesn't start with self, the receiver won't try to start with self.
	const possible_connections = non_self_connections.filter(fp => !fp.fake).length === 0 ? self_connections : non_self_connections;

	// Filter out focus possibilities that are strictly more complicated (i.e. connections match up until some point, but has more self-components after)
	const simplest_connections = possible_connections.filter(({ connections: conns }, i) => !possible_connections.some(({ connections: other_conns }, j) =>
		i !== j && other_conns.length > 0 && conns.length > other_conns.length && conns.every((conn, index) => {
			const other_conn = other_conns[index];

			return other_conn === undefined ||
				Utils.objEquals(other_conn, conn) ||
				(other_conn.reacting !== target && conn.reacting === target) ||
				(other_conn.reacting === target && conn.reacting === target && other_conns.length < conns.length);
		})));

	const symmetric_connections = simplest_connections.map(({ id, connections, fake }) => ({
		connections,
		suitIndex: id.suitIndex,
		rank: inference_rank(state, id.suitIndex, connections),
		fake
	}));

	const sym_conn = symmetric_connections.map(conn => logConnections(conn.connections, { suitIndex: conn.suitIndex, rank: conn.rank }));

	logger.info('symmetric connections', sym_conn);
	return symmetric_connections;
}


/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {Game} game
 * @param {Connection[]} connections
 * @param {number} giver
 */
export function assign_connections(game, connections, giver) {
	const { common, state } = game;
	const hypo_stacks = Utils.objClone(common.hypo_stacks);

	for (let i = 0; i < connections.length; i++) {
		const { type, reacting, bluff, possibly_bluff, hidden, card: conn_card, linked, identities, certain } = connections[i];
		// The connections can be cloned, so need to modify the card directly
		const card = common.thoughts[conn_card.order];

		logger.debug('assigning connection', logConnection(connections[i]));

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		card.old_inferred ??= card.inferred;

		if (type === 'finesse') {
			card.finessed = true;
			card.bluffed ||= bluff;
			card.possibly_bluffed ||= possibly_bluff;
			card.finesse_index = state.actionList.length;
			card.hidden = hidden;

			if (state.hands[giver].some(c => common.thoughts[c.order].finessed))
				game.finesses_while_finessed[giver].push(state.deck[card.order]);

			card.certain_finessed ||= certain;
		}

		if (connections.some(conn => conn.type === 'finesse'))
			card.finesse_index = card.finesse_index ?? state.actionList.length;

		if (bluff || hidden) {
			const playable_identities = hypo_stacks.map((stack_rank, index) => ({ suitIndex: index, rank: stack_rank + 1 }))
				.filter(id => id.rank <= state.max_ranks[id.suitIndex] && !isTrash(state, common, id, card.order, { infer: true }));

			card.inferred = card.inferred.intersect(playable_identities);

			if (bluff) {
				const currently_playable_identities = state.play_stacks.map((stack_rank, index) => ({ suitIndex: index, rank: stack_rank + 1 })).filter(id => id.rank <= state.max_ranks[id.suitIndex]);
				card.inferred = card.inferred.intersect(currently_playable_identities);
			}

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
			if (card.superposition || card.uncertain) {
				card.inferred = card.inferred.union(identities);
				logger.info('union', identities.map(logCard), card.inferred.map(logCard));
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

		card.uncertain ||= (reacting === state.ourPlayerIndex && type !== 'known') || type === 'finesse';
		if (card.uncertain)
			logger.highlight('yellow', 'writing uncertain!');

		// Updating notes not on our turn
		// There might be multiple possible inferences on the same card from a self component
		// TODO: Examine why this originally had self only?
		if (card.old_inferred.length > card.inferred.length && card.reasoning.at(-1) !== state.actionList.length - 1) {
			card.reasoning.push(state.actionList.length - 1);
			card.reasoning_turn.push(state.turn_count);
		}
	}
}

/**
 * @param {Pick<FocusPossibility, 'connections'>} focus_possibility
 * @param {number} playerIndex
 */
export function connection_score(focus_possibility, playerIndex) {
	const { connections } = focus_possibility;

	const first_self = connections.findIndex(conn => conn.type !== 'known' && conn.type !== 'playable');

	// Starts on someone else
	if (connections[first_self]?.reacting !== playerIndex)
		return 0;

	let blind_plays = 0, bluffs = 0, prompts = 0, self = 0;

	for (let i = first_self; i < connections.length; i++) {
		const conn = connections[i];

		if (conn.reacting === playerIndex)
			self++;

		if (conn.type === 'finesse')
			blind_plays++;

		if (conn.bluff && !conn.self)
			bluffs++;

		if (conn.type === 'prompt')
			prompts++;
	}

	return 10*blind_plays + 1*bluffs + 0.1*prompts + 0.01*self;
}

/**
 * @param {Game} game
 * @param {FocusPossibility[]} focus_possibilities
 * @param {number} playerIndex
 * @param {number} focused_order
 */
export function occams_razor(game, focus_possibilities, playerIndex, focused_order) {
	const connection_scores = focus_possibilities.map(fp => connection_score(fp, playerIndex));

	const min_score = connection_scores.reduce((min, curr, i) => {
		const fp = focus_possibilities[i];

		if (!game.players[playerIndex].thoughts[focused_order].possible.has(fp))
			return min;

		return Math.min(min, curr);
	}, Infinity);

	return focus_possibilities.filter((_, i) => connection_scores[i] <= min_score);
}
