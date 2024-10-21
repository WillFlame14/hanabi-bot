import { cardCount } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { order_1s } from '../action-helper.js';
import { inBetween } from '../hanabi-logic.js';
import { valid_bluff } from './connection-helper.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection } from '../../../tools/log.js';
import { produce } from '../../../StateProxy.js';

/**
 * @typedef {import('../../h-group.js').default} Game
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
	const possibly_fake = (order) => {
		return giver === state.ourPlayerIndex && common.waiting_connections.some(wc => {
			const connIndex = wc.connections.findIndex((conn, index) => index >= wc.conn_index && conn.order === order);

			// Note that if we are the target, we can't verify if finesse/prompt connections are real
			return connIndex !== -1 && wc.target === state.ourPlayerIndex &&
				wc.connections.some((conn, i) => i >= wc.conn_index && i <= connIndex && (conn.type === 'finesse' || conn.type === 'prompt'));
		});
	};

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

		/** @type {Link} */
		let known_link;

		const known_linked = state.hands[playerIndex].find(order => {
			if (ignoreOrders.includes(order))
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

	const giver_asymmetric = state.hands[giver].find(o => game.players[giver].thoughts[o].identity({ infer: true, symmetric: true })?.matches(identity));

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
 * @returns {Connection | undefined}
 */
function find_unknown_connecting(game, action, reacting, identity, connected = [], ignoreOrders = []) {
	const { common, state, me } = game;
	const { giver, target } = action;

	const prompt = common.find_prompt(state, reacting, identity, connected, ignoreOrders);
	const finesse = common.find_finesse(state, reacting, connected, ignoreOrders);
	const [prompt_card, finesse_card] = [prompt, finesse].map(o => state.deck[o]);

	logger.debug('finding unknown connecting for', logCard(identity), state.playerNames[reacting], prompt, finesse, connected, ignoreOrders);

	// Prompt takes priority over finesse
	if (prompt_card?.identity() !== undefined) {
		if (prompt_card.matches(identity))
			return { type: 'prompt', reacting, order: prompt, identities: [identity] };

		// Prompted card is delayed playable
		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt_card.suitIndex] + 1 === prompt_card.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (giver === state.ourPlayerIndex && state.hands[giver].some(o => state.deck[o].clued && game.players[giver].thoughts[o].inferred.has(identity))) {
				logger.warn(`disallowed hidden prompt on ${logCard(prompt_card)} ${prompt}, true ${logCard(identity)}  could be duplicated in giver's hand`);
				return;
			}
			return { type: 'prompt', reacting, order: prompt, hidden: true, identities: [prompt_card.raw()] };
		}
		logger.warn(`wrong prompt on ${logCard(prompt_card)} ${prompt} when searching for ${logCard(identity)}, play stacks at ${state.play_stacks[prompt_card.suitIndex]}`);
		return { type: 'terminate', reacting, order: prompt, identities: [identity] };
	}

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
		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse_card.suitIndex] + 1 === finesse_card.rank) {
			const bluff = valid_bluff(game, action, finesse_card, reacting, connected);

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
						return card.touched && card.inferred.has(finesse_card);
					});

					// Could be duplicated in giver's hand - disallow hidden finesse.
					if (possibly_duplicated) {
						logger.warn(`disallowed hidden finesse on ${logCard(finesse_card)} ${finesse}, true ${logCard(identity)} could be duplicated in giver's hand`);
						return;
					}
				}
			}

			return { type: 'finesse', reacting, order: finesse, hidden: true, bluff, identities: [finesse_card.raw()] };
		}
	}
}

/**
 * Determines whether a set of connections satisfies the no finesse rule.
 * @param {Game} game
 * @param {Connection[]} connections	The complete connections leading to the play of a card.
 * @param {number} giver
 * @param {number} index
 * @returns {{ valid: boolean, conns: Connection[] }}
 */
function no_finesse_conns(game, connections, giver, index) {
	const { common, state } = game;

	// A bluff cannot be followed by finesses, otherwise it wouldn't have been a valid bluff target.
	let f_index = connections.findIndex((conn, i) => i >= index && conn.type === 'finesse');

	if (f_index === -1)
		return { valid: true, conns: connections };

	if (giver === state.ourPlayerIndex)
		return { valid: false, conns: connections };

	const conns = connections.slice();

	// See if we can replace finesse connections with prompts in our own hand
	while (f_index !== -1) {
		const connected = conns.slice(0, f_index).map(conn => conn.order);
		const prompt = common.find_prompt(state, state.ourPlayerIndex, conns[f_index].identities[0], connected, []);

		if (prompt === undefined)
			break;

		logger.highlight('yellow', `replacing finesse connection [${logConnection(conns[f_index])}] with own prompt ${prompt}`);
		conns[f_index] = { type: 'prompt', reacting: state.ourPlayerIndex, order: prompt, identities: connections[f_index].identities };
		f_index = conns.findIndex((conn, i) => i >= index && conn.type === 'finesse');
	}

	return { valid: f_index === -1, conns };
}

/**
 * Determines whether a bluff connection is a valid bluff, and updates the connection accordingly.
 * @param {Game} game
 * @param {Connection[]} connections	The complete connections leading to the play of a card.
 * @param {number} giver
 * @returns {Connection[]}
 */
export function resolve_bluff(game, connections, giver) {
	if (connections.length == 0 || !connections[0].bluff)
		return connections;

	const { state } = game;
	const next_visible = connections.findIndex(conn => ((card = state.deck[conn.order]) =>
		!(conn.type === 'finesse' && conn.reacting === connections[0].reacting && (card.identity() === undefined || state.isPlayable(card))))());
	const index = next_visible === -1 ? connections.length : next_visible;

	const { valid, conns } = no_finesse_conns(game, connections, giver, index);

	if (!valid) {
		// If a bluff is not possible, we only have a valid connection if all cards can be played
		if (next_visible > 1) {
			let valid_hidden_finesse = true;

			const hypo_stacks = state.play_stacks.slice();
			for (const conn of conns) {
				const { identities } = conn;

				if (identities.length > 1)
					continue;

				const { suitIndex, rank } = identities[0];

				if (hypo_stacks[suitIndex] + 1 !== rank) {
					valid_hidden_finesse = false;
					break;
				}
				hypo_stacks[suitIndex] = rank;
			}

			if (valid_hidden_finesse) {
				logger.warn('bluff invalid but connection still exists');
				return conns.with(0, Object.assign(Utils.objClone(conns[0]), { bluff: false }));
			}
		}

		logger.warn(`bluff invalid (${conns.map(logConnection).join(' -> ')}), followed by hidden/finesse connections`);
		return [];
	}

	// Remove extra hidden finesse connections if the bluff is valid
	if (conns.length > 1 && conns[1].reacting === conns[0].reacting)
		return conns.toSpliced(1, index - 1);

	return conns;
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {boolean} looksDirect 	Whether the clue could be interpreted as direct play (i.e. never as self-prompt/finesse).
 * @param {number[]} [connected]	The orders of cards that have previously connected (and should be skipped).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @param {{knownOnly?: number[]}} options
 * @returns {Connection[]}
 */
export function find_connecting(game, action, identity, looksDirect, connected = [], ignoreOrders = [], options = {}) {
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

	// Do not consider unknown playables if the card is already gotten in the target's hand (?)
	// TODO: Maybe some version of this if it's found in non-prompt position in anyone else's hand?
	const target_copy = state.hands[target].find(o => {
		const card = state.deck[o];
		const { finessed } = common.thoughts[o];
		return card.matches(identity) && ((card.clued && !card.newly_clued) || finessed) && !connected.includes(o) && !ignoreOrders.includes(o);
	});

	if (target_copy !== undefined)
		logger.warn(`connecting ${logCard(identity)} gotten in target's hand, might look confusing`);

	const wrong_prompts = [];
	const old_play_stacks = state.play_stacks;

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 0; i < state.numPlayers; i++) {
		const playerIndex = (state.numPlayers + giver - i - 1) % state.numPlayers;

		// Clue receiver won't find known prompts/finesses in their hand unless it doesn't look direct
		// Also disallow prompting/finessing a player when they may need to prove a finesse to us
		if (playerIndex === giver || options.knownOnly?.includes(playerIndex) || (playerIndex === target && looksDirect) ||
			(giver === state.ourPlayerIndex && common.waiting_connections.some(wc =>
				wc.target === state.ourPlayerIndex && wc.connections.some((conn, index) =>
					index >= wc.conn_index && conn.type === 'finesse' && conn.reacting === playerIndex))))
			continue;

		const connections = /** @type {Connection[]} */ ([]);
		const already_connected = connected.slice();
		state.play_stacks = old_play_stacks.slice();

		let connecting = find_unknown_connecting(game, action, playerIndex, identity, already_connected, ignoreOrders);

		if (connecting?.type === 'terminate') {
			wrong_prompts.push(connecting);
			continue;
		}

		// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
		// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
		// If the connection could be a bluff, we will search for the actual playable card in case it turns out
		// not to be a valid bluff target.
		while (connecting?.hidden) {
			connections.push(connecting);
			already_connected.push(connecting.order);
			state.play_stacks[state.deck[connecting.order].suitIndex]++;

			connecting = find_unknown_connecting(game, action, playerIndex, identity, already_connected, ignoreOrders);
		}

		if (connecting) {
			if (connecting.type === 'terminate') {
				wrong_prompts.push(connecting);
				continue;
			}

			connections.push(connecting);
		}

		// If we don't find the actual card, a bluff of the first card is still a valid interpretation.
		if (connections.length > 0 && connections.at(0).bluff && connections.at(-1).hidden) {
			// Remove all of the hidden plays after the bluff and treat the bluff as the known target.
			connections.splice(1, connections.length - 1);
			connections[0].hidden = false;
		}

		// The final card must not be hidden
		if (connections.length > 0 && !connections.at(-1).hidden) {
			state.play_stacks = old_play_stacks.slice();
			return connections;
		}
	}

	// Restore play stacks
	state.play_stacks = old_play_stacks;

	// Unknown playable(s) in our hand (obviously, we can't use them in our clues)
	if (giver !== state.ourPlayerIndex && !options.knownOnly?.includes(state.ourPlayerIndex)) {
		const playable_conns = state.ourHand.filter(order => {
			const card = me.thoughts[order];

			const possibly_hidden = () =>
				card.uncertain && card.possible.has(identity) && card.finesse_ids.has(identity);

			return !ignoreOrders.includes(order) &&
				!connected.includes(order) &&
				(card.inferred.has(identity) || possibly_hidden()) &&		// At least one inference must match
				card.matches(identity, { assume: true }) &&				// If we know the card (from a rewind), it must match
				((card.inferred.every(i => state.isPlayable(i)) && card.clued) || card.finessed);	// Must be playable
		});

		if (playable_conns.length > 0) {
			return [{
				type: 'playable',
				reacting: state.ourPlayerIndex,
				order: (rank === 1 && order_1s(state, common, playable_conns)[0]) || playable_conns.at(-1),	  // If necessary, reorder to oldest 1 to avoid prompting
				linked: playable_conns,
				identities: [identity]
			}];
		}
	}
	return wrong_prompts;
}
