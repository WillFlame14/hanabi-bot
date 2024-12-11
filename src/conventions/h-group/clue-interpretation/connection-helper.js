import { CLUE } from '../../../constants.js';
import { IdentitySet } from '../../../basics/IdentitySet.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection, logConnections } from '../../../tools/log.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import { LEVEL } from '../h-constants.js';
import { variantRegexes } from '../../../variants.js';
import { colour_save, rank_save } from './focus-possible.js';

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
 * @typedef {import('../../../types.js').FocusResult} FocusResult
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
	const { state } = game;
	const nextCard = { suitIndex: identity.suitIndex, rank: identity.rank + 1 };
	const { giver, target, clue } = action;

	return game.level >= LEVEL.BLUFFS &&
		state.nextPlayerIndex(giver) === reacting &&					// must be bluff seat
		connected.length === 1 &&											// must not be delayed
		((clue.type === CLUE.RANK && clue.value !== nextCard.rank) ||
			identity.rank === state.base_ids.maxStackRank ||
			!game.common.thoughts[connected[0]].possible.has(nextCard)) &&	// must disconnect
		!(clue.type === CLUE.COLOUR && reacting === target) &&				// must not be self-colour bluff
		!state.hands[reacting].some(o => {								// must not be confused with an existing finesse
			const card = game.players[reacting].thoughts[o];
			return card.finessed && card.possible.has(identity);
		});
}

/**
 * Generates symmetric connections from a list of symmetric focus possibilities.
 * @param {State} state
 * @param {SymFocusPossibility[]} sym_possibilities
 * @param {FocusPossibility[]} existing_connections
 * @param {number} focus
 * @param {number} giver
 * @param {number} target
 * @returns {WaitingConnection[]}
 */
export function generate_symmetric_connections(state, sym_possibilities, existing_connections, focus, giver, target) {
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
			focus,
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
 * @param {Game} game
 * @param {ClueAction} action
 * @param {FocusResult} focusResult
 * @param {FocusPossibility[]} inf_possibilities
 * @param {number[]} selfRanks 		The ranks needed to play by the target (as a self-finesse).
 * @param {number} ownBlindPlays 	The number of blind plays we need to make in the actual connection.
 * @returns {SymFocusPossibility[]}
 */
export function find_symmetric_connections(game, action, focusResult, inf_possibilities, selfRanks, ownBlindPlays) {
	const { common, state } = game;

	const { clue, giver, target } = action;
	const { focus, chop } = focusResult;
	const focused_card = common.thoughts[focus];

	/** @type {SymFocusPossibility[][]} */
	const [self_connections, non_self_connections] = inf_possibilities.reduce((acc, fp) => {
		const [self, non_self] = acc;
		const dest = (fp.connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.reacting === target) ? self: non_self;
		const { suitIndex, rank, connections } = fp;

		dest.push({ suitIndex, rank, connections, fake: false });
		return acc;
	}, [[], []]);

	/** @type {(conns: Connection[], playerIndex: number) => number} */
	const blind_plays = (conns, playerIndex) => conns.filter(conn => conn.type === 'finesse' && conn.reacting === playerIndex).length;

	for (const id of focused_card.inferred) {
		// Receiver won't consider trash possibilities or ones that are subsumed by real possibilities
		if (isTrash(state, common, id, focus) || inf_possibilities.some(fp => fp.suitIndex === id.suitIndex && fp.rank >= id.rank))
			continue;

		// Pink promise
		if (clue.type === CLUE.RANK && state.includesVariant(variantRegexes.pinkish) && id.rank !== clue.value)
			continue;

		const visible_dupe = state.hands.some((hand, i) => {
			const useCommon = i === giver || i === target;

			return hand.some(o => {
				const card = (useCommon ? common : game.players[target]).thoughts[o];
				return card.matches(id, { infer: useCommon }) && o !== focus && card.touched;
			});
		});

		if (visible_dupe)
			continue;

		if (chop && (clue.type === CLUE.COLOUR ? colour_save(game, id, action, focus) : rank_save(game, id, action, focus))) {
			non_self_connections.push({ ...id.raw(), connections: [], fake: false });
			continue;
		}

		const looksDirect = focused_card.identity() === undefined && (		// Focus must be unknown AND
			clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
			common.hypo_stacks.some(stack => stack + 1 === clue.value) ||		// Looks like a play
			inf_possibilities.some(fp => fp.save));										// Looks like a save

		logger.off();

		try {
			const connections = find_own_finesses(game, action, focus, id, looksDirect, target, selfRanks);
			// Fake connection - we need to blind play too many times
			const fake = blind_plays(connections, state.ourPlayerIndex) > ownBlindPlays;

			if (connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.reacting === target)
				self_connections.push({ ...id.raw(), connections, fake });
			else
				non_self_connections.push({ ...id.raw(), connections, fake });
		}
		catch (error) {
			if (error instanceof IllegalInterpretation) {
				// Will probably never be seen
				logger.warn(error.message);
			}
			else {
				throw error;
			}
		}
		logger.on();
	}

	// If there is at least one non-fake connection that doesn't start with self, the receiver won't try to start with self.
	const possible_connections = non_self_connections.filter(fp => !fp.fake).length === 0 ? self_connections : non_self_connections;

	// Filter out focus possibilities that are strictly more complicated (i.e. connections match up until some point, but has more self-components after)
	const simplest_connections = occams_razor(game, possible_connections, target, focus);
	const sym_conn = simplest_connections.map(conn => logConnections(conn.connections, { suitIndex: conn.suitIndex, rank: conn.rank }));

	logger.info('symmetric connections', sym_conn);
	return simplest_connections;
}

/**
 * Applies the given connections on the given suit to the state (e.g. writing finesses).
 * 
 * Impure! (modifies common and game.finesses_while_finessed)
 * @param {Game} game
 * @param {FocusPossibility[]} inf_possibilities
 * @param {ClueAction} action
 * @param {ActualCard} focused_card
 */
export function assign_all_connections(game, inf_possibilities, action, focused_card) {
	const { common, state, me } = game;
	const { giver, clue, target } = action;
	const focus = focused_card.order;

	// Find the cards used as a 'playable' in every bluff connection. If any bluff connection exists that doesn't use it, no notes should be written.
	const bluff_fps = inf_possibilities.filter(fp => fp.connections[0]?.bluff);
	const bluff_playables = bluff_fps.map(fp => fp.connections.filter(conn => conn.type === 'playable').flatMap(conn => conn.order));
	const must_bluff_playables = bluff_playables[0]?.filter(o => bluff_playables.every(os => os.includes(o))) ?? [];

	for (const { connections, suitIndex, rank, save } of inf_possibilities) {
		const inference = { suitIndex, rank };
		const matches = focused_card.matches(inference, { assume: true }) && game.players[target].thoughts[focus].possible.has(inference);

		// Don't assign save connections or known false connections
		if (save || !matches)
			continue;

		const hypo_stacks = common.hypo_stacks.slice();

		for (const conn of connections) {
			const { type, reacting, bluff, possibly_bluff, hidden, order, linked, identities, certain } = conn;

			if (type === 'playable' && connections[0].bluff && !must_bluff_playables.includes(order))
				continue;

			logger.info('assigning connection', logConnection(conn));

			const playable_identities = hypo_stacks
				.map((stack_rank, index) => ({ suitIndex: index, rank: stack_rank + 1 }))
				.filter(id => id.rank <= state.max_ranks[id.suitIndex] && !isTrash(state, common, id, order, { infer: true }));

			const currently_playable_identities = state.play_stacks
				.map((stack_rank, index) =>({ suitIndex: index, rank: stack_rank + 1 }))
				.filter(id => id.rank <= state.max_ranks[id.suitIndex]);

			const is_unknown_playable = type === 'playable' && linked.length > 1 && focused_card.matches(inference, { assume: true });

			const card = common.thoughts[order];
			let new_inferred = card.inferred;

			if (bluff || hidden) {
				new_inferred = new_inferred.intersect(playable_identities);

				if (bluff)
					new_inferred = new_inferred.intersect(currently_playable_identities);
			}
			else {
				// There are multiple possible connections on this card
				if (card.superposition)
					new_inferred = new_inferred.union(identities);
				else if (card.uncertain)
					new_inferred = new_inferred.union(card.finesse_ids.intersect(identities));

				if (!is_unknown_playable && !card.superposition && !card.uncertain)
					new_inferred = IdentitySet.create(state.variant.suits.length, identities);
			}

			common.updateThoughts(order, (draft) => {
				// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
				draft.old_inferred ??= common.thoughts[order].inferred;

				if (type === 'finesse') {
					draft.finessed = true;
					draft.bluffed ||= bluff;
					draft.possibly_bluffed ||= possibly_bluff;
					draft.finesse_index = state.actionList.length;
					draft.hidden = hidden;
					draft.certain_finessed ||= certain;
				}

				if (connections.some(conn => conn.type === 'finesse'))
					draft.finesse_index ??= state.actionList.length;

				draft.inferred = new_inferred;
				if (!bluff && !hidden)
					draft.superposition = true;

				const uncertain = !card.uncertain && giver !== state.ourPlayerIndex && ((reacting === state.ourPlayerIndex) ?
					// If we're reacting, we are uncertain if the card is not known and there is some other card in our hand that allows for a swap
					type !== 'known' && identities.some(i => state.ourHand.some(o => o !== order && me.thoughts[o].possible.has(i))) :
					// If we're not reacting, we are uncertain if the connection is a finesse that could be ambiguous
					(type === 'finesse' || type === 'prompt') &&
						(!(identities.every(i => state.isCritical(i)) && focused_card.matches(inference)) ||
						// Colour finesses are guaranteed if the focus cannot be a finessed identity
						(clue.type === CLUE.COLOUR && identities.every(i => !me.thoughts[focused_card.order].possible.has(i)))));

				if (uncertain) {
					const self_playable_identities = state.ourHand.reduce((stacks, order) => {
						const card = common.thoughts[order];
						const id = card.identity({ infer: true });

						if (id !== undefined && card.finessed && stacks[id.suitIndex] + 1 === id.rank)
							stacks[id.suitIndex]++;

						return stacks;
					}, state.play_stacks.slice()).map((stack_rank, index) =>({ suitIndex: index, rank: stack_rank + 1 }))
						.filter(id => id.rank <= state.max_ranks[id.suitIndex]);

					draft.finesse_ids = state.base_ids.union(bluff ? currently_playable_identities : self_playable_identities);
					draft.uncertain = true;
				}

				// Updating notes not on our turn
				// There might be multiple possible inferences on the same card from a self component
				// TODO: Examine why this originally had self only?
				if (draft.old_inferred.length > draft.inferred.length && draft.reasoning.at(-1) !== state.actionList.length - 1) {
					draft.reasoning.push(state.actionList.length - 1);
					draft.reasoning_turn.push(state.turn_count);
				}
			});

			if (type === 'finesse' && state.hands[giver].some(o => common.thoughts[o].finessed))
				game.finesses_while_finessed[giver].push(state.deck[order]);

			if (bluff || hidden) {
				// Temporarily force update hypo stacks so that layered finesses are written properly (?)
				if (state.deck[order].identity() !== undefined) {
					const { suitIndex, rank } = state.deck[order].identity();
					if (hypo_stacks[suitIndex] + 1 !== rank)
						logger.warn('trying to connect', logCard(state.deck[order]), 'but hypo stacks at', hypo_stacks[suitIndex]);

					hypo_stacks[suitIndex] = rank;
				}
			}
			else if (is_unknown_playable) {
				const existing_link_index = common.links.find(link => {
					const { promised } = link;
					const { suitIndex, rank } = link.identities[0];

					return promised &&
						identities[0].suitIndex === suitIndex && identities[0].rank === rank &&
						link.orders.length === linked.length &&
						link.orders.every(o => linked.includes(o));
				});

				if (existing_link_index === undefined) {
					logger.info('adding promised link with identities', identities.map(logCard), 'and orders', linked);
					common.links.push({ promised: true, identities, orders: linked, target: focused_card.order });
				}
			}
		}
	}
}

/**
 * @param {Pick<FocusPossibility, 'connections'>} focus_possibility
 * @param {number} playerIndex
 */
export function connection_score(focus_possibility, playerIndex) {
	const { connections } = focus_possibility;

	const asymmetric_penalty = connections.filter(conn => conn.asymmetric).length * 10;
	const first_self = connections.findIndex(conn => conn.type !== 'known' && conn.type !== 'playable');

	// Starts on someone else
	if (connections[first_self]?.reacting !== playerIndex)
		return asymmetric_penalty;

	let blind_plays = 0, prompts = 0;

	for (let i = first_self; i < connections.length; i++) {
		const conn = connections[i];

		if (conn.reacting !== playerIndex)
			continue;

		if (conn.type === 'finesse')
			blind_plays++;

		if (conn.type === 'prompt')
			prompts++;
	}

	return asymmetric_penalty + blind_plays + 0.1*prompts;
}

/**
 * @template {Pick<FocusPossibility, 'suitIndex'| 'rank' | 'connections'>} T
 * @param {Game} game
 * @param {T[]} focus_possibilities
 * @param {number} playerIndex
 * @param {number} focused_order
 */
export function occams_razor(game, focus_possibilities, playerIndex, focused_order) {
	const connection_scores = focus_possibilities.map(fp => connection_score(fp, playerIndex));

	logger.debug('occams razor', focus_possibilities.map(logCard), connection_scores);

	const min_score = connection_scores.reduce((min, curr, i) => {
		const fp = focus_possibilities[i];

		if (!game.players[playerIndex].thoughts[focused_order].possible.has(fp))
			return min;

		return Math.min(min, curr);
	}, Infinity);

	return focus_possibilities.filter((_, i) => connection_scores[i] <= min_score);
}
