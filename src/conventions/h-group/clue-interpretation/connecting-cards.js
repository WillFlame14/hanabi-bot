import { CLUE } from '../../../constants.js';
import { cardCount } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { order_1s } from '../action-helper.js';
import { inBetween } from '../hanabi-logic.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * Finds a known connecting card (or unknown playable).
 * @param {Game} game
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {Identity} identity
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection | undefined}
 */
function find_known_connecting(game, giver, identity, ignoreOrders = []) {
	const { common, state } = game;

	// Globally known
	for (let i = 0; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		const globally_known = state.hands[playerIndex].find(({ order }) => {
			if (ignoreOrders.includes(order))
				return false;

			const card = common.thoughts[order].clone();

			// Remove inferences that will be proven false (i.e. after someone plays the card with such identity)
			card.inferred = card.inferred.subtract(card.inferred.filter(inf => inf.playedBefore(identity)));

			return card.matches(identity, { infer: true }) && card.touched &&
				!common.waiting_connections.some(wc =>
					wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order) && wc.fake);
		});

		if (globally_known)
			return { type: 'known', reacting: playerIndex, card: globally_known, identities: [identity] };
	}

	// Visible and already going to be played (excluding giver)
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		// Unknown playables that could match
		const playables = state.hands[playerIndex].filter(({ order }) => {
			const card = common.thoughts[order];

			return !ignoreOrders.includes(order) &&
				card.touched &&
				card.inferred.has(identity) &&
				(card.inferred.every(c => state.isPlayable(c)) || card.finessed);
		});
		const match = playables.find(card => card.matches(identity));

		// More than 1 such playable and it could be duplicated in giver's hand - disallow hidden delayed play
		if (playables.length > 1 &&
			state.hands[giver].some(c => c.clued && game.players[giver].thoughts[c.order].inferred.has(identity))
		) {
			if (match !== undefined) {
				// Everyone other than giver will recognize this card as the connection - stop looking further
				return { type: 'terminate', reacting: null, card: null, identities: [] };
			}
			logger.warn(`disallowed hidden delayed play on ${logCard(identity)}, could be duplicated in giver's hand`);
			return;
		}

		if (match !== undefined) {
			if (common.thoughts[match.order].hidden)
				logger.warn(`hidden connecting card ${logCard(identity)} in ${state.playerNames[playerIndex]}'s hand, might be confusing`);

			return { type: 'playable', reacting: playerIndex, card: match, linked: playables, identities: [identity] };
		}
	}
}

/**
 * Finds a (possibly layered) prompt or finesse as a connecting card (or unknown playable).
 * @param {Game} game
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} playerIndex
 * @param {Identity} identity
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @returns {Connection | undefined}
 */
function find_unknown_connecting(game, giver, target, playerIndex, identity, ignoreOrders = []) {
	const { common, state } = game;

	const hand = state.hands[playerIndex];
	const prompt = common.find_prompt(hand, identity, state.variant.suits, ignoreOrders);
	const finesse = common.find_finesse(hand, ignoreOrders);

	// Prompt takes priority over finesse
	if (prompt !== undefined && prompt.identity() !== undefined) {
		if (prompt.matches(identity))
			return { type: 'prompt', reacting: playerIndex, card: prompt, identities: [identity] };

		// Prompted card is delayed playable
		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt.suitIndex] + 1 === prompt.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (state.hands[giver].some(c => c.clued && game.players[giver].thoughts[c.order].inferred.has(identity))) {
				logger.warn(`disallowed hidden prompt on ${logCard(prompt)}, could be duplicated in giver's hand`);
				return;
			}
			return { type: 'prompt', reacting: playerIndex, card: prompt, hidden: true, identities: [prompt.raw()] };
		}
		logger.warn(`wrong prompt on ${logCard(prompt)} when searching for ${logCard(identity)}, play stacks at ${state.play_stacks[prompt.suitIndex]}`);
		return;
	}

	if (finesse !== undefined && finesse.identity() !== undefined) {
		if (finesse.matches(identity)) {
			// At level 1, only forward finesses are allowed.
			if (game.level === 1 && !inBetween(state.numPlayers, playerIndex, giver, target)) {
				logger.warn(`found finesse ${logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand, but not between giver and target`);
				return;
			}
			return { type: 'finesse', reacting: playerIndex, card: finesse, identities: [identity] };
		}
		// Finessed card is delayed playable
		else if (game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse.suitIndex] + 1 === finesse.rank) {
			// Could be duplicated in giver's hand - disallow hidden finesse
			if (state.hands[giver].some(c => c.clued && game.players[giver].thoughts[c.order].inferred.has(identity))) {
				logger.warn(`disallowed hidden finesse on ${logCard(finesse)}, could be duplicated in giver's hand`);
				return;
			}

			if (state.hands.some((hand, index) => index !== giver && hand.some(c =>
				common.thoughts[c.order].touched && c.matches(finesse)
			))) {
				logger.warn(`disallowed hidden finesse on ${logCard(finesse)}, playable already clued elsewhere`);
				return;
			}

			return { type: 'finesse', reacting: playerIndex, card: finesse, hidden: true, identities: [finesse.raw()] };
		}
	}
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {Game} game
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {Identity} identity
 * @param {boolean} looksDirect 	Whether the clue could be interpreted as direct play (i.e. never as self-prompt/finesse).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @param {{knownOnly?: number[]}} options
 * @returns {Connection[]}
 */
export function find_connecting(game, giver, target, identity, looksDirect, ignoreOrders = [], options = {}) {
	const { common, state, me } = game;
	const { suitIndex, rank } = identity;

	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, identity)) {
		logger.info(`all ${logCard(identity)} in trash`);
		return [];
	}

	const connecting = find_known_connecting(game, giver, identity, ignoreOrders);
	if (connecting) {
		if (connecting.type === 'terminate')
			return [];

		return [connecting];
	}

	// Do not consider unknown playables if the card is already gotten in the target's hand (?)
	// TODO: Maybe some version of this if it's found in non-prompt position in anyone else's hand?
	const target_copy = state.hands[target].find(c => {
		const { finessed } = common.thoughts[c.order];
		return c.matches(identity) && ((c.clued && !c.newly_clued) || finessed) && !ignoreOrders.includes(c.order);
	});

	if (target_copy !== undefined)
		logger.warn(`connecting ${logCard(identity)} gotten in target's hand, might look confusing`);

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		if (options.knownOnly?.includes(playerIndex) || (playerIndex === target && looksDirect)) {
			// Clue receiver won't find known prompts/finesses in their hand unless it doesn't look direct
			continue;
		}

		const connections = [];
		const hypo_game = game.minimalCopy();
		const newIgnoreOrders = ignoreOrders.slice();

		let connecting = find_unknown_connecting(hypo_game, giver, target, playerIndex, identity, newIgnoreOrders);

		// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
		// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
		while (connecting?.hidden) {
			connections.push(connecting);
			newIgnoreOrders.push(connecting.card.order);
			hypo_game.state.play_stacks[connecting.card.suitIndex]++;

			connecting = find_unknown_connecting(hypo_game, giver, target, playerIndex, identity, newIgnoreOrders);
		}

		if (connecting)
			connections.push(connecting);

		// The final card must not be hidden
		if (connections.length > 0 && !connections.at(-1).hidden)
			return connections;
	}

	// Unknown playable(s) in our hand (obviously, we can't use them in our clues)
	if (giver !== state.ourPlayerIndex) {
		const playable_conns = state.hands[state.ourPlayerIndex].filter(({order}) => {
			const card = me.thoughts[order];

			return !ignoreOrders.includes(order) &&
				card.inferred.has(identity) &&							// At least one inference must match
				card.matches(identity, { assume: true }) &&				// If we know the card (from a rewind), it must match
				((card.inferred.every(i => state.isPlayable(i)) && card.clued) || card.finessed);	// Must be playable
		});

		if (playable_conns.length > 0) {
			const multiple_1s = rank === 1 &&
				playable_conns.every(card => card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1));

			return [{
				type: 'playable',
				reacting: state.ourPlayerIndex,
				card: (multiple_1s ? order_1s(state, common, playable_conns) : playable_conns)[0],	  // If necessary, reorder to oldest 1 to avoid prompting
				linked: playable_conns,
				identities: [identity]
			}];
		}
	}
	return [];
}
