import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { getIgnoreOrders } from '../../../basics/hanabi-util.js';
import { rainbowMismatch } from '../hanabi-logic.js';
import { find_connecting, find_known_connecting } from './connecting-cards.js';
import { cardTouched, find_possibilities } from '../../../variants.js';
import { valid_bluff } from './connection-helper.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection } from '../../../tools/log.js';

export class IllegalInterpretation extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * @param {Game} game
 * @param {number} finesses
 * @param {number} prompt
 * @param {Identity} identity
 * @returns {Connection[]}
 */
function own_prompt(game, finesses, prompt, identity) {
	const { state, me } = game;

	if (game.level === 1 && finesses >= 1)
		throw new IllegalInterpretation('blocked prompt + finesse at level 1');

	const card = me.thoughts[prompt];
	const actual_card = state.deck[prompt];
	const reacting = state.ourPlayerIndex;

	if (card.rewinded && identity.suitIndex !== actual_card.suitIndex && state.isPlayable(actual_card)) {
		if (game.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation('blocked hidden finesse at level 1');

		return [{ type: 'prompt', reacting, order: prompt, hidden: true, self: true, identities: [actual_card.raw()] }];
	}

	if (card.matches(identity, { assume: true }) && card.possible.has(identity))
		return [{ type: 'prompt', reacting, order: prompt, self: true, identities: [identity] }];

	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number[]} connected
 * @param {number[]} ignoreOrders
 * @param {number} ignorePlayer
 * @param {number[]} selfRanks
 * @param {number} finesses
 * @param {{ assumeTruth?: boolean, bluffed?: boolean }} [options]
 * @returns {Connection[]}
 */
function connect(game, action, identity, looksDirect, connected, ignoreOrders, ignorePlayer, selfRanks, finesses, options = {}) {
	const { common, me, state } = game;
	const { giver, target } = action;
	const our_hand = state.ourHand;

	// First, see if someone else has the connecting card
	const conn_options = { ...options, knownOnly: [ignorePlayer] };
	const other_connecting = find_connecting(game, action, identity, looksDirect, new Set(), connected, ignoreOrders, conn_options);
	if (other_connecting.length > 0 && other_connecting[0].type !== 'terminate')
		return other_connecting;

	// See if the giver knows about their own card
	const duplicated_in_own = state.hands[giver].find(o => state.deck[o].matches(identity) && common.unknown_plays.has(o));
	if (duplicated_in_own && game.players[giver].thoughts[duplicated_in_own].identity({ infer: true })?.matches(identity)) {
		logger.warn(`assuming ${state.playerNames[giver]} knows about their own (playable) ${logCard(identity)} asymmetrically`);
		return [{ type: 'known', reacting: giver, order: duplicated_in_own, identities: [identity] }];
	}

	const focus = connected[0];

	const self_allowed = giver !== state.ourPlayerIndex && !(target === state.ourPlayerIndex && looksDirect);

	if (self_allowed) {
		if (options.bluffed) {
			const orders = me.find_clued(state, state.ourPlayerIndex, identity, connected, ignoreOrders);

			if (orders.length > 0) {
				const match = orders.find(o => state.deck[o].matches(identity, { assume: true }));

				if (match !== undefined)
					return [{ type: 'playable', reacting: state.ourPlayerIndex, order: match, linked: orders, identities: [identity] }];
			}
			return [];
		}

		// Otherwise, try to find prompt in our hand
		const prompt = common.find_prompt(state, state.ourPlayerIndex, identity, connected, ignoreOrders);
		logger.debug('prompt in slot', prompt ? our_hand.findIndex(o => o === prompt) + 1 : '-1');

		// Don't prompt for the same identity as the focus, since giver would be bad touching
		if (prompt !== undefined && !rainbowMismatch(game, action, identity, prompt) && !state.deck[focus].identity()?.matches(identity)) {
			const connections = own_prompt(game, finesses, prompt, identity);

			if (connections.length > 0)
				return connections;
		}
		else if (!selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, options.assumeTruth);
			}
			catch (error) {
				if (error instanceof IllegalInterpretation) {
					// Will probably never be seen
					logger.warn(error.message);

					if (error.message.startsWith('no finesse slot') || error.message.startsWith('self-finesse not found')) {
						const pink_prompt = common.find_prompt(state, state.ourPlayerIndex, identity, connected, ignoreOrders, true);

						if (pink_prompt !== undefined && pink_prompt !== prompt) {
							const connections = own_prompt(game, finesses, pink_prompt, identity);

							if (connections.length > 0)
								return connections;
						}
					}
				}
				else {
					throw error;
				}
			}
		}
	}

	// Use the ignoring player's hand
	if (ignorePlayer !== -1) {
		if (options.bluffed) {
			const orders = common.find_clued(state, state.ourPlayerIndex, identity, connected, ignoreOrders);

			if (orders.length > 0) {
				const match = orders.find(o => common.thoughts[o].matches(identity, { assume: true }));

				if (match !== undefined)
					return [{ type: 'playable', reacting: target, order: match, linked: orders, identities: [identity] }];
			}
			return [];
		}

		const prompt = common.find_prompt(state, ignorePlayer, identity, connected, ignoreOrders);

		if (prompt !== undefined) {
			if (game.level === 1 && finesses >= 1)
				throw new IllegalInterpretation('blocked double finesse at level 1');

			if (common.thoughts[prompt].matches(identity, { assume: true }))
				return [{ type: 'prompt', reacting: target, order: prompt, self: true, identities: [identity] }];
		}
		else {
			const finesse = common.find_finesse(state, ignorePlayer, connected, ignoreOrders);

			if (finesse) {
				const card = common.thoughts[finesse];

				if (card.inferred.has(identity) && card.matches(identity, { assume: true })) {
					if (game.level === 1 && connected.length >= 1)
						throw new IllegalInterpretation('blocked double finesse at level 1');

					return [{ type: 'finesse', reacting: target, order: finesse, self: true, identities: [identity] }];
				}
			}
		}

		// Try finesse in our hand again (if we skipped it earlier to prefer ignoring player)
		if (self_allowed && selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, options.assumeTruth);
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					logger.warn(error.message);
				else
					throw error;
			}
		}
	}

	// Guess that giver knows about their own card
	const asymmetric_own = state.hands[giver].find(o => ((c = state.deck[o]) => c.matches(identity) && c.clued)());
	if (asymmetric_own) {
		logger.warn(`assuming ${state.playerNames[giver]} knows about their own ${logCard(identity)} asymmetrically`);
		return [{ type: 'known', reacting: giver, order: asymmetric_own, identities: [identity], asymmetric: true }];
	}

	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse/bluff through own hand if necessary.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} focus
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number} [ignorePlayer]
 * @param {number[]} [selfRanks]
 * @param {boolean} assumeTruth
 * @throws {IllegalInterpretation} If no connection can be found.
 * @returns {Connection[]}
 */
export function find_own_finesses(game, action, focus, identity, looksDirect, ignorePlayer = -1, selfRanks = [], assumeTruth = false) {
	const { common, state } = game;
	const { giver, target, clue } = action;
	const { suitIndex, rank } = identity;

	if (giver === state.ourPlayerIndex && ignorePlayer === -1)
		throw new IllegalInterpretation('cannot finesse ourselves.');

	if (target === (ignorePlayer === -1 ? state.ourPlayerIndex : ignorePlayer)) {
		const connected = find_known_connecting(game, giver, { suitIndex, rank }, getIgnoreOrders(game, 0, suitIndex));

		if (connected !== undefined && connected.type !== 'terminate' && connected.order !== focus)
			throw new IllegalInterpretation(`won't find own finesses for ${logCard({ suitIndex, rank })} when someone already has [${logConnection(connected)}]`);
	}

	// Create hypothetical state where we have the missing cards (and others can elim from them)
	const hypo_game = game.shallowCopy();
	hypo_game.state = state.shallowCopy();
	hypo_game.state.play_stacks = state.play_stacks.slice();
	hypo_game.common = common.clone();

	const { state: hypo_state, common: hypo_common } = hypo_game;

	const connections = /** @type {Connection[]} */ ([]);
	const already_connected = [focus];

	let finesses = 0;
	let direct = looksDirect;
	let bluffed = false;

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		const next_identity = { suitIndex, rank: next_rank };
		const ignoreOrders = getIgnoreOrders(game, next_rank - state.play_stacks[suitIndex] - 1, suitIndex);

		const options = { assumeTruth, bluffed };
		const curr_connections = connect(hypo_game, action, next_identity, direct, already_connected, ignoreOrders, ignorePlayer, selfRanks, finesses, options);

		if (curr_connections.length === 0)
			break;

		let allHidden = true;
		for (const connection of curr_connections) {
			connections.push(connection);

			const { reacting, order, hidden, bluff, type } = connection;

			if (type === 'finesse') {
				finesses++;

				// Someone else playing into a finesse reveals that it's not direct (UNLESS it was a colour clue, we already checked if fully known)
				// Note that just playing a hidden card doesn't work - they have to actually play the connecting card eventually
				if (direct && !hidden && reacting !== target && clue.type !== CLUE.COLOUR)
					direct = false;

				if (bluff)
					bluffed = true;
			}

			if (hidden) {
				const id = state.deck[order].identity();

				if (id !== undefined) {
					hypo_state.play_stacks[id.suitIndex]++;
					hypo_common.hypo_stacks[id.suitIndex]++;		// Everyone knows this card is playing
				}
			}
			else {
				allHidden = false;

				// Assume this is actually the card
				hypo_common.updateThoughts(order, (draft) => { draft.inferred = hypo_common.thoughts[order].inferred.intersect(next_identity); });
				hypo_common.good_touch_elim(hypo_state);
			}
			already_connected.push(order);
		}

		// Hidden connection, need to look for this rank again
		if (allHidden)
			next_rank--;
		else
			hypo_state.play_stacks[suitIndex]++;
	}

	if (hypo_state.play_stacks[suitIndex] + 1 !== rank) {
		if (game.level >= LEVEL.BLUFFS && !assumeTruth && bluffed) {
			logger.highlight('yellow', `bluff connection failed (stacked up to ${hypo_state.play_stacks[suitIndex] + 1}), retrying with true finesse`);

			try {
				const fixed_connections = find_own_finesses(game, action, focus, identity, looksDirect, ignorePlayer, selfRanks, true);

				if (fixed_connections.length > 0)
					return fixed_connections;
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					logger.warn(error.message);
				else
					throw error;
			}

			logger.highlight('yellow', 'failed to connect with true finesse');
		}

		throw new IllegalInterpretation(`unable to connect`);
	}

	return connections;
}

/**
 * @param {Game} game
 * @param {Identity} identity
 * @param {number[]} [connected] 		The orders of cards that have previously connected.
 * @param {number[]} [ignoreOrders] 	The orders of cards that should be ignored when searching.
 */
function resolve_layered_finesse(game, identity, connected = [], ignoreOrders = []) {
	const { common, state } = game;

	/** @type {Connection[]} */
	const connections = [];
	const already_connected = connected.slice();

	for (const action of game.next_finesse) {
		const f_order = () => common.find_finesse(state, state.ourPlayerIndex, already_connected, ignoreOrders);

		const { list, clue } = action;

		// Touching a matching card to the finesse - all untouched cards are layered
		// Touching a non-matching card - all touched cards are layered
		const matching = cardTouched(identity, state.variant, clue);

		for (let order = f_order(); matching !== list.includes(order); order = f_order()) {
			if (order === undefined)
				throw new IllegalInterpretation('impossible layered finesse with no end');

			if (ignoreOrders.includes(order))
				throw new IllegalInterpretation(`impossible layered finesse, ignoring card order ${order}`);

			let identities = common.hypo_stacks.map((stack_rank, suitIndex) => ({ suitIndex, rank: stack_rank + 1 }));

			// Touching a non-matching card - we know exactly what playbable identities it should be
			if (!matching) {
				const possibilities = find_possibilities(clue, state.variant);
				identities = identities.filter(card => possibilities.some(p => p.suitIndex === card.suitIndex && p.rank === identity.rank));
			}

			if (identities.length === 0)
				throw new IllegalInterpretation(`impossible layered finesse, card ${order} has no playable identities`);

			connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, order, hidden: true, self: true, identities });
			already_connected.push(order);
		}
	}

	// Assume next card is the finesse target
	const finesse = common.find_finesse(state, state.ourPlayerIndex, already_connected, ignoreOrders);

	// Layered finesse is impossible
	if (finesse === undefined)
		throw new IllegalInterpretation(`couldn't find a valid finesse target after layers`);

	connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, order: finesse, self: true, identities: [identity] });
	return connections;
}

/**
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {number[]} connected
 * @param {number[]} ignoreOrders
 * @param {number} finesses
 * @param {boolean} assumeTruth
 * @returns {Connection[]}
 */
function find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, assumeTruth) {
	const { common, state, me } = game;
	const { giver, target } = action;

	const finesse = common.find_finesse(state, state.ourPlayerIndex, connected, ignoreOrders);
	logger.debug('finesse in slot', finesse ? state.ourHand.findIndex(o => o === finesse) + 1 : '-1');

	if (finesse === undefined)
		throw new IllegalInterpretation(`no finesse slot (ignoring ${ignoreOrders})`);

	const card = me.thoughts[finesse];
	const actual_card = state.deck[finesse];
	const reacting = state.ourPlayerIndex;

	const bluffable_ids = (actual_card.identity() ? [actual_card.identity()] : card.inferred.filter(id => state.isPlayable(id)))
		.filter(id => valid_bluff(game, action, id, reacting, connected));
	const possibly_bluff = !assumeTruth && bluffable_ids.length > 0;

	if (card.rewinded) {
		if (game.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation(`blocked layered finesse at level ${game.level}`);

		if (actual_card.suitIndex !== identity.suitIndex && state.isPlayable(actual_card)) {
			const connections = /** @type {Connection[]} */ ([{ type: 'finesse', reacting, order: finesse, hidden: true, self: true, bluff: possibly_bluff, identities: [actual_card.raw()] }]);

			const new_state = state.shallowCopy();
			new_state.play_stacks = state.play_stacks.with(actual_card.suitIndex, actual_card.rank);

			const new_game = game.shallowCopy();
			new_game.state = new_state;

			// If the connection is hidden, we must have the actual card playable in order for the layer to work.
			// Thus, we keep searching for unknown connections until we find a non-hidden connection.
			return connections.concat(find_self_finesse(new_game, action, identity, connected.concat(finesse), ignoreOrders, finesses + 1, assumeTruth));
		}
	}

	const true_finesse = card.inferred.has(identity) && card.matches(identity, { assume: true });

	if (true_finesse || bluffable_ids.length > 0) {
		if (game.level === 1 && connected.length > 1)
			throw new IllegalInterpretation(`blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);

		// We have some information about the next finesse
		if (game.next_finesse.length > 0)
			return resolve_layered_finesse(game, identity, connected, ignoreOrders);

		const certain = [giver, target].some(i => state.hands[i].some(o => ((c = state.deck[o]) => c.matches(identity) && c.clued)()));
		const identities = true_finesse ? [identity] : bluffable_ids;

		return [{ type: 'finesse', reacting, order: finesse, self: true, bluff: !assumeTruth && !card.possible.has(identity), possibly_bluff, identities, certain }];
	}
	throw new IllegalInterpretation(`self-finesse not found for ${logCard(identity)}`);
}
