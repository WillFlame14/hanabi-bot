import { cardCount, variantRegexes } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { order_1s } from '../action-helper.js';
import { inBetween, rainbowMismatch } from '../hanabi-logic.js';
import { valid_bluff } from './connection-helper.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';
import { produce } from '../../../StateProxy.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 * @typedef {import('../../../types.js').Link} Link
 */

/**
 * Finds a known connecting card (or unknown playable).
 * @param {Game} game
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {Identity} identity
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @param {{knownOnly?: number[]}} options
 * @returns {Connection | undefined}
 */
export function find_known_connecting(game, giver, identity, ignoreOrders = [], options = {}) {
	const { common, state } = game;

	/** @param {number} order */
	const possibly_fake = (order) => giver === state.ourPlayerIndex && common.waiting_connections.some(wc => {
		const connIndex = wc.connections.findIndex((conn, index) => index >= wc.conn_index && conn.order === order);

		// Note that if we are the target, we can't verify if finesse/prompt connections are real
		return connIndex !== -1 && wc.target === state.ourPlayerIndex &&
			wc.connections.some((conn, i) => i >= wc.conn_index && i <= connIndex && (conn.type === 'finesse' || conn.type === 'prompt'));
	});

	// Globally known
	for (let i = 0; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		const globally_known = state.hands[playerIndex].find(order => {
			const ineligible = ignoreOrders.includes(order) ||
				!common.thoughts[order].touched ||
				!state.deck[order].matches(identity, { assume: true }) ||
				possibly_fake(order) ||
				common.linkedOrders(state).has(order);

			if (ineligible)
				return false;

			const old_card = common.thoughts[order];
			let inferences = common.thoughts[order].inferred;
			// Remove inferences that will be proven false (i.e. after someone plays the card with such identity)
			// Except the giver, who can't eliminate from their own hand
			if (giver !== playerIndex) {
				inferences = old_card.inferred.subtract(old_card.inferred.filter(inf => inf.playedBefore(identity)));

				// If a waiting connection will reveal this card, assume it will be known in time.
				const connection = common.waiting_connections.find(conn => !conn.symmetric && conn.focus == order && conn.target !== state.ourPlayerIndex);
				if (connection !== undefined)
					inferences = inferences.intersect(connection.inference);
			}

			const new_card = produce(old_card, (draft) => { draft.inferred = inferences; });
			return new_card.matches(identity, { infer: true, symmetric: true });
		});

		if (globally_known)
			return { type: 'known', reacting: playerIndex, order: globally_known, identities: [identity] };

		// Don't use our own links
		if (giver === state.ourPlayerIndex && playerIndex === state.ourPlayerIndex)
			continue;

		/** @type {Link} */
		let known_link;

		const known_linked = state.hands[playerIndex].find(order => {
			if (ignoreOrders.includes(order) || !state.deck[order].matches(identity))
				return false;

			known_link = common.links.find(link =>
				link.promised &&
				link.identities.some(i => i.suitIndex === identity.suitIndex && i.rank === identity.rank) &&
				link.orders.includes(order) &&
				link.orders.length >= link.identities.length);
			return known_link !== undefined;
		});

		if (known_linked)
			return { type: 'playable', reacting: playerIndex, order: known_linked, linked: known_link.orders, identities: [identity] };
	}

	// Visible and already going to be played (excluding giver)
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		if (options.knownOnly?.includes(playerIndex))
			continue;

		// Unknown playables that could match
		const playables = state.hands[playerIndex].filter(order => {
			const card = common.thoughts[order];

			return !ignoreOrders.includes(order) &&
				card.touched &&
				card.inferred.has(identity) &&
				(card.inferred.every(c => state.isPlayable(c)) || card.finessed) &&
				!possibly_fake(order);
		});
		const match = playables.find(o => state.deck[o].matches(identity));

		// More than 1 such playable and it could be duplicated in giver's hand - disallow hidden delayed play
		if (playables.length > 1 && giver === state.ourPlayerIndex &&
			state.hands[giver].some(o => state.deck[o].clued && game.players[giver].thoughts[o].inferred.has(identity))
		) {
			if (match !== undefined) {
				// Everyone other than giver will recognize this card as the connection - stop looking further
				return { type: 'terminate', reacting: null, order: -1, identities: [] };
			}
			logger.warn(`disallowed hidden delayed play on ${logCard(identity)}, could be duplicated in giver's hand`);
			return;
		}

		if (match !== undefined) {
			if (common.thoughts[match].hidden)
				logger.warn(`hidden connecting card ${logCard(identity)} in ${state.playerNames[playerIndex]}'s hand, might be confusing`);

			return { type: 'playable', reacting: playerIndex, order: match, linked: playables, identities: [identity] };
		}
	}

	const giver_asymmetric = state.hands[giver].find(o =>
		!ignoreOrders.includes(o) &&
		game.players[giver].thoughts[o].identity({ infer: true, symmetric: true })?.matches(identity));

	if (giver_asymmetric !== undefined) {
		logger.highlight('cyan', `connecting using giver's asymmetric knowledge of ${logCard(identity)}!`);
		return { type: 'known', reacting: giver, order: giver_asymmetric, identities: [identity] };
	}
}

/**
 * Finds a (possibly layered) prompt, finesse or bluff as a connecting card (or unknown playable).
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} reacting
 * @param {Identity} identity
 * @param {number[]} [connected] 	The orders of cards that have previously connected (and should be skipped).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @param {{assumeTruth?: boolean, noLayer?: boolean, bluffed?: boolean}} options
 * @returns {Connection | undefined}
 */
function find_unknown_connecting(game, action, reacting, identity, connected = [], ignoreOrders = [], options = {}) {
	const { common, state, me } = game;
	const { giver, target } = action;

	if (options.bluffed) {
		const orders = common.find_clued(state, reacting, identity, connected, ignoreOrders);

		if (orders.length > 0) {
			const match = orders.find(o => state.deck[o].matches(identity));

			if (match !== undefined)
				return { type: 'playable', reacting, order: match, linked: orders, identities: [identity] };
		}
		return;
	}

	const prompt = common.find_prompt(state, reacting, identity, connected, ignoreOrders);
	const finesse = common.find_finesse(state, reacting, connected, ignoreOrders);

	logger.debug('finding unknown connecting for', logCard(identity), state.playerNames[reacting], prompt, finesse, connected, ignoreOrders);

	/**
	 * @param {number} prompt_order
	 * @returns {{tried: boolean, conn?: Connection}}
	 */
	const try_prompt = (prompt_order) => {
		const prompt_c = state.deck[prompt_order];

		// Prompt takes priority over finesse
		if (prompt_c?.identity() === undefined || rainbowMismatch(game, action, identity, prompt))
			return { tried: false };

		if (prompt_c.matches(identity))
			return { tried: true, conn: { type: 'prompt', reacting, order: prompt_order, identities: [identity] } };

		// Prompted card is delayed playable
		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt_c.suitIndex] + 1 === prompt_c.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (giver === state.ourPlayerIndex && state.hands[giver].some(o => state.deck[o].clued && game.players[giver].thoughts[o].inferred.has(identity))) {
				logger.warn(`disallowed hidden prompt on ${logCard(prompt_c)} ${prompt_order}, true ${logCard(identity)}  could be duplicated in giver's hand`);
				return { tried: true };
			}
			return { tried: true, conn: { type: 'prompt', reacting, order: prompt_order, hidden: true, identities: [prompt_c.raw()] } };
		}
		logger.warn(`wrong prompt on ${logCard(prompt_c)} ${prompt_order} when searching for ${logCard(identity)}, play stacks at ${state.play_stacks[prompt_c.suitIndex]}`);
		return { tried: true, conn: { type: 'terminate', reacting, order: prompt_order, identities: [identity] } };
	};

	const { tried, conn } = try_prompt(prompt);

	if (tried)
		return conn;

	// Try prompting a wrongly-ranked pink card
	if ((finesse === undefined || !common.thoughts[finesse].possible.has(identity)) && state.includesVariant(variantRegexes.pinkish)) {
		const pink_prompt = common.find_prompt(state, reacting, identity, connected, ignoreOrders, true);

		if (pink_prompt !== undefined && pink_prompt !== prompt) {
			const { tried: tried2, conn: conn2 } = try_prompt(pink_prompt);

			if (tried2)
				return conn2;
		}
	}

	const finesse_card = state.deck[finesse];

	if (finesse_card?.identity() !== undefined) {
		/** @param {number} order */
		const order_touched = (order) => {
			const card = common.thoughts[order];

			return card.touched && !card.newly_clued &&
				(state.deck[order].identity() !== undefined || common.dependentConnections(order).every(wc =>
					!wc.symmetric && state.deck[wc.focus].matches(wc.inference, { assume: true })));
		};

		if (state.hands.some((hand, index) => index !== giver && hand.some(o => order_touched(o) && state.deck[o].matches(finesse_card)))) {
			logger.warn(`disallowed finesse on ${logCard(finesse_card)}, playable already clued elsewhere`);
			return;
		}

		if (finesse_card.matches(identity)) {
			// At level 1, only forward finesses are allowed.
			if (game.level === 1 && !inBetween(state.numPlayers, reacting, giver, target)) {
				logger.warn(`found finesse ${logCard(finesse_card)} in ${state.playerNames[reacting]}'s hand, but not between giver and target`);
				return;
			}
			return { type: 'finesse', reacting, order: finesse, bluff: false, identities: [identity] };
		}

		// Finessed card is delayed playable
		if (!options.noLayer && game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse_card.suitIndex] + 1 === finesse_card.rank) {
			const bluff = !options.assumeTruth && valid_bluff(game, action, finesse_card, reacting, connected);

			if (giver === state.ourPlayerIndex) {
				if (bluff) {
					const likely_duplicated = state.hands[giver].some(o => {
						const card = me.thoughts[o];
						return card.touched && card.inferred.length <= 2 && card.inferred.has(finesse_card);
					});

					if (likely_duplicated) {
						logger.warn(`disallowed bluff on ${logCard(finesse_card)} ${finesse}, likely duplicated in giver's hand`);
						return;
					}
				}
				else {
					const possibly_duplicated = state.hands[giver].some(o => {
						const card = me.thoughts[o];
						return card.touched && card.inferred.has(identity);
					});

					// Could be duplicated in giver's hand - disallow hidden finesse.
					if (possibly_duplicated) {
						logger.warn(`disallowed hidden finesse through ${logCard(finesse_card)} ${finesse}, true ${logCard(identity)} could be duplicated in giver's hand`);
						return;
					}
				}
			}

			return { type: 'finesse', reacting, order: finesse, hidden: !bluff, bluff, identities: [finesse_card.raw()] };
		}
	}
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {boolean} looksDirect 	Whether the clue could be interpreted as direct play (i.e. never as self-prompt/finesse).
 * @param {Set<number>} thinks_stall Whether the clue appears to be a stall to these players.
 * @param {number[]} [connected]	The orders of cards that have previously connected (and should be skipped).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @param {{knownOnly?: number[], assumeTruth?: boolean, bluffed?: boolean}} options
 * @returns {Connection[]}
 */
export function find_connecting(game, action, identity, looksDirect, thinks_stall, connected = [], ignoreOrders = [], options = {}) {
	const { common, state, me } = game;
	const { giver, target } = action;
	const { suitIndex, rank } = identity;

	logger.debug('looking for connecting', logCard(identity), looksDirect);

	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, identity)) {
		logger.info(`all ${logCard(identity)} in trash`);
		return [];
	}

	const connecting = find_known_connecting(game, giver, identity, connected.concat(ignoreOrders), options);
	if (connecting)
		return connecting.type === 'terminate' ? [] : [connecting];

	// Do not consider unknown playables if the card is clued in someone else's hand (but not in prompt position)
	const non_prompt_copy = state.hands.some((hand, i) => {
		if (i === giver)
			return false;

		const match = hand.find(o => ((card = state.deck[o]) =>
			card.matches(identity) && card.clued && !card.newly_clued && !connected.includes(o) && !ignoreOrders.includes(o))());

		if (match === undefined)
			return false;

		const connected_copy = connected.slice();
		let prompt = common.find_prompt(state, i, identity, connected, ignoreOrders, true);

		while (prompt !== undefined) {
			if (prompt === match)
				return false;

			// Can't layered prompt
			if (!state.isPlayable(state.deck[prompt]))
				return true;

			connected_copy.push(prompt);
			prompt = common.find_prompt(state, i, identity, connected_copy, ignoreOrders, true);
		}

		return true;
	});

	if (!options.bluffed && non_prompt_copy) {
		logger.warn(`connecting ${logCard(identity)} in non-prompt position, not searching for unknown cards`);
		return [];
	}

	const wrong_prompts = [];
	const old_play_stacks = state.play_stacks;

	const conn_player_order = [target, ...Utils.range(0, state.numPlayers).map(i => (state.numPlayers + giver - i - 1) % state.numPlayers).filter(i => i !== target), target];

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 0; i < conn_player_order.length; i++) {
		const playerIndex = conn_player_order[i];

		// Clue receiver won't find known prompts/finesses in their hand unless it doesn't look direct
		// Also disallow prompting/finessing a player when they may need to prove a finesse to us
		if (playerIndex === giver || options.knownOnly?.includes(playerIndex) || (giver === state.ourPlayerIndex && playerIndex === target && looksDirect) ||
			thinks_stall.has(playerIndex) ||
			(giver === state.ourPlayerIndex && common.waiting_connections.some(wc =>
				wc.target === state.ourPlayerIndex && wc.connections.some((conn, index) =>
					index >= wc.conn_index && conn.type === 'finesse' && conn.reacting === playerIndex))))
			continue;

		const connections = /** @type {Connection[]} */ ([]);
		const already_connected = connected.slice();
		state.play_stacks = old_play_stacks.slice();

		const unk_options = { assumeTruth: options.assumeTruth, noLayer: i === 0, bluffed: options.bluffed };
		let connecting = find_unknown_connecting(game, action, playerIndex, identity, already_connected, ignoreOrders, unk_options);

		if (connecting?.type === 'terminate') {
			wrong_prompts.push(connecting);
			continue;
		}

		// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
		// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
		while (connecting?.hidden) {
			connections.push(connecting);
			already_connected.push(connecting.order);
			state.play_stacks[state.deck[connecting.order].suitIndex]++;

			connecting = find_unknown_connecting(game, action, playerIndex, identity, already_connected, ignoreOrders, unk_options);
		}

		if (connecting) {
			if (connecting.type === 'terminate') {
				wrong_prompts.push(connecting);
				continue;
			}

			connections.push(connecting);
		}

		// The final card must not be hidden
		if (connections.length > 0 && !connections.at(-1).hidden) {
			state.play_stacks = old_play_stacks.slice();
			if (playerIndex === target && looksDirect)
				logger.warn('looks direct to us, trusting that we have missing cards');

			return connections;
		}
	}

	// Restore play stacks
	state.play_stacks = old_play_stacks;

	// Unknown playable(s) in our hand (obviously, we can't use them in our clues)
	if (giver !== state.ourPlayerIndex && !options.knownOnly?.includes(state.ourPlayerIndex)) {
		let layered = false;
		/** @type {number[]} */
		const playable_conns = [];

		for (const order of state.ourHand) {
			const card = me.thoughts[order];

			if (ignoreOrders.includes(order) || connected.includes(order) ||
				!card.matches(identity, { assume: true }) ||										// If we know the card (from a rewind), it must match
				(!(card.inferred.every(i => state.isPlayable(i)) && card.clued) && !card.finessed))	// Must be playable
				continue;

			if (card.inferred.has(identity)) {
				playable_conns.push(order);
				continue;
			}

			if (card.uncertain && card.possible.has(identity) && card.finesse_ids.has(identity)) {
				playable_conns.push(order);
				layered = true;
			}
		}

		if (playable_conns.length > 0) {
			return [{
				type: 'playable',
				reacting: state.ourPlayerIndex,
				order: (rank === 1 && order_1s(state, common, playable_conns)[0]) || playable_conns.at(-1),	  // If necessary, reorder to oldest 1 to avoid prompting
				linked: playable_conns,
				identities: [identity],
				layered
			}];
		}
	}
	return wrong_prompts;
}
