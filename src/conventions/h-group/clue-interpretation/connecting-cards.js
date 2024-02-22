import { CLUE } from '../../../constants.js';
import { cardCount } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { order_1s } from '../action-helper.js';
import { playableAway } from '../../../basics/hanabi-util.js';
import { inBetween } from '../hanabi-logic.js';
import { find_possibilities } from '../../../basics/helper.js';
import { cardTouched } from '../../../variants.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * Finds a known connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {Identity} identity
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection | undefined}
 */
function find_known_connecting(state, giver, identity, ignoreOrders = []) {
	const { common } = state;

	// Globally known
	for (let i = 0; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		const globally_known = state.hands[playerIndex].find(({ order }) =>
			!ignoreOrders.includes(order) && common.thoughts[order].matches(identity, { infer: true }) && common.thoughts[order].touched);

		if (globally_known)
			return { type: 'known', reacting: playerIndex, card: globally_known, identities: [identity] };
	}

	// Visible and already going to be played (excluding giver)
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;
		const hand = state.hands[playerIndex];

		// Unknown playables that could match
		const playables = hand.filter(({ order }) => {
			const card = state.common.thoughts[order];

			return !ignoreOrders.includes(order) &&
				card.inferred.some(c => c.matches(identity)) &&
				(card.inferred.every(c => playableAway(state, c) === 0) || card.finessed);
		});
		const match = playables.find(card => card.matches(identity));

		// More than 1 such playable and it could be duplicated in giver's hand - disallow hidden delayed play
		if (playables.length > 1 &&
			state.hands[giver].some(c => c.clued && state.players[giver].thoughts[c.order].inferred.some(inf => inf.matches(identity)))
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

			return { type: 'playable', reacting: playerIndex, card: match, known: playables.length === 1, identities: [identity] };
		}
	}
}

/**
 * Finds a (possibly layered) prompt or finesse as a connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} playerIndex
 * @param {Identity} identity
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @returns {Connection | undefined}
 */
function find_unknown_connecting(state, giver, target, playerIndex, identity, ignoreOrders = []) {
	const hand = state.hands[playerIndex];
	const prompt = state.common.find_prompt(hand, identity, state.variant.suits, ignoreOrders);
	const finesse = state.common.find_finesse(hand, ignoreOrders);

	// Prompt takes priority over finesse
	if (prompt !== undefined && prompt.identity() !== undefined) {
		if (prompt.matches(identity))
			return { type: 'prompt', reacting: playerIndex, card: prompt, identities: [identity] };

		// Prompted card is delayed playable
		if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt.suitIndex] + 1 === prompt.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (state.hands[giver].some(c => c.clued && state.players[giver].thoughts[c.order].inferred.some(inf => inf.matches(identity)))) {
				logger.warn(`disallowed hidden prompt on ${logCard(prompt)}, could be duplicated in giver's hand`);
				return;
			}
			return { type: 'prompt', reacting: playerIndex, card: prompt, hidden: true, identities: [prompt.raw()] };
		}
		else {
			logger.warn(`wrong prompt on ${logCard(prompt)} when searching for ${logCard(identity)}, play stacks at ${state.play_stacks[prompt.suitIndex]}`);
			return;
		}
	}
	else if (finesse !== undefined && finesse.identity() !== undefined) {
		if (finesse.matches(identity)) {
			// At level 1, only forward finesses are allowed.
			if (state.level === 1 && !inBetween(state.numPlayers, playerIndex, giver, target)) {
				logger.warn(`found finesse ${logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand, but not between giver and target`);
				return;
			}
			return { type: 'finesse', reacting: playerIndex, card: finesse, identities: [identity] };
		}
		// Finessed card is delayed playable
		else if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse.suitIndex] + 1 === finesse.rank) {
			// Could be duplicated in giver's hand - disallow hidden finesse
			if (state.hands[giver].some(c => c.clued && state.players[giver].thoughts[c.order].inferred.some(inf => inf.matches(identity)))) {
				logger.warn(`disallowed hidden finesse on ${logCard(finesse)}, could be duplicated in giver's hand`);
				return;
			}
			return { type: 'finesse', reacting: playerIndex, card: finesse, hidden: true, identities: [finesse.raw()] };
		}
	}
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {State} state
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {Identity} identity
 * @param {boolean} looksDirect 	Whether the clue could be interpreted as direct play (i.e. never as self-prompt/finesse).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @param {{knownOnly?: number[]}} options
 * @returns {Connection[]}
 */
export function find_connecting(state, giver, target, identity, looksDirect, ignoreOrders = [], options = {}) {
	const { suitIndex, rank } = identity;

	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.variant, identity)) {
		logger.info(`all ${logCard(identity)} in trash`);
		return [];
	}

	const connecting = find_known_connecting(state, giver, identity, ignoreOrders);
	if (connecting) {
		if (connecting.type === 'terminate')
			return [];

		return [connecting];
	}

	// Do not consider unknown playables if the card is already gotten in the target's hand (?)
	// TODO: Maybe some version of this if it's found in non-prompt position in anyone else's hand?
	const target_copy = state.hands[target].find(c => {
		const { finessed } = state.common.thoughts[c.order];
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
		const hypo_state = state.minimalCopy();
		const newIgnoreOrders = ignoreOrders.slice();

		let connecting = find_unknown_connecting(hypo_state, giver, target, playerIndex, identity, newIgnoreOrders);

		// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
		// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
		while (connecting?.hidden) {
			connections.push(connecting);
			newIgnoreOrders.push(connecting.card.order);
			hypo_state.play_stacks[connecting.card.suitIndex]++;

			connecting = find_unknown_connecting(hypo_state, giver, target, playerIndex, identity, newIgnoreOrders);
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
			const card = state.me.thoughts[order];

			return !ignoreOrders.includes(order) &&
				card.inferred.some(inf => inf.matches(identity)) &&							// At least one inference must match
				card.matches(identity, { assume: true }) &&									// If we know the card (from a rewind), it must match
				((card.inferred.every(c => playableAway(state, c) === 0) && card.clued) || card.finessed);	// Must be playable
		});

		if (playable_conns.length > 0) {
			const multiple_1s = rank === 1 &&
				playable_conns.every(card => card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1));

			return [{
				type: 'playable',
				reacting: state.ourPlayerIndex,
				card: (multiple_1s ? order_1s(state, state.common, playable_conns) : playable_conns)[0],	  // If necessary, reorder to oldest 1 to avoid prompting
				known: playable_conns.length === 1,
				identities: [identity]
			}];
		}
	}
	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number} [ignorePlayer]
 * @param {number[]} [selfRanks]
 * @returns {{feasible: boolean, connections: Connection[]}}
 */
export function find_own_finesses(state, giver, target, { suitIndex, rank }, looksDirect, ignorePlayer = -1, selfRanks = []) {
	// We cannot finesse ourselves
	if (giver === state.ourPlayerIndex && ignorePlayer === -1)
		return { feasible: false, connections: [] };

	// Create hypothetical state where we have the missing cards (and others can elim from them)
	const hypo_state = state.minimalCopy();
	const our_hand = hypo_state.hands[state.ourPlayerIndex];

	/** @type {Connection[]} */
	let connections = [];
	let ignoreOrders = [], finesses = 0;

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		const next_identity = { suitIndex, rank: next_rank };

		/** @param {Connection[]} new_conns */
		const addConnections = (new_conns) => {
			let allHidden = true;
			for (const connection of new_conns) {
				connections.push(connection);

				const { card, type } = connection;

				if (connection.hidden) {
					const id = card.identity();

					if (id !== undefined) {
						hypo_state.play_stacks[id.suitIndex]++;

						// Everyone knows this card is playing
						hypo_state.common.hypo_stacks[id.suitIndex]++;
					}
				}
				else {
					allHidden = false;

					// Assume this is actually the card
					hypo_state.common.thoughts[card.order].intersect('inferred', [next_identity]);
					hypo_state.common.good_touch_elim(hypo_state);
				}

				if (type === 'finesse')
					finesses++;

				ignoreOrders.push(card.order);
			}

			if (allHidden)
				next_rank--;
		};

		// First, see if someone else has the connecting card
		const currIgnoreOrders = ignoreOrders.concat(state.next_ignore[next_rank - hypo_state.play_stacks[suitIndex] - 1] ?? []);

		const other_connecting = find_connecting(hypo_state, giver, target, next_identity, looksDirect, currIgnoreOrders, { knownOnly: [ignorePlayer] });
		if (other_connecting.length > 0) {
			connections = connections.concat(other_connecting);
			ignoreOrders = ignoreOrders.concat(other_connecting.map(conn => conn.card.order));
			continue;
		}

		if (giver !== state.ourPlayerIndex) {
			// Otherwise, try to find prompt in our hand
			const prompt = state.common.find_prompt(our_hand, next_identity, state.variant.suits, currIgnoreOrders);
			logger.debug('prompt in slot', prompt ? our_hand.findIndex(c => c.order === prompt.order) + 1 : '-1');
			if (prompt !== undefined) {
				if (state.level === 1 && finesses >= 1) {
					logger.warn('blocked prompt + finesse at level 1');
					return { feasible: false, connections: [] };
				}

				const card = state.me.thoughts[prompt.order];

				if (card.rewinded && suitIndex !== prompt.suitIndex && playableAway(hypo_state, prompt) === 0) {
					if (state.level < LEVEL.INTERMEDIATE_FINESSES) {
						logger.warn(`blocked hidden finesse at level ${state.level}`);
						return { feasible: false, connections: [] };
					}
					addConnections([{ type: 'known', reacting: state.ourPlayerIndex, card: prompt, hidden: true, self: true, identities: [prompt.raw()] }]);
					continue;
				}
				else if (card.matches(next_identity, { assume: true })) {
					addConnections([{ type: 'prompt', reacting: hypo_state.ourPlayerIndex, card: prompt, self: true, identities: [next_identity] }]);
					continue;
				}
			}
			else if (!selfRanks.includes(next_rank)) {
				// Otherwise, try to find finesse in our hand
				const { feasible, connections: new_conns } = find_self_finesse(hypo_state, next_identity, currIgnoreOrders.slice(), finesses);

				if (!feasible)
					return { feasible: false, connections: [] };

				if (new_conns.length > 0) {
					addConnections(new_conns);
					continue;
				}
			}
		}

		// Use the ignoring player's hand
		if (ignorePlayer !== -1) {
			const their_hand = hypo_state.hands[ignorePlayer];
			const prompt = state.common.find_prompt(their_hand, next_identity, state.variant.suits, currIgnoreOrders);

			if (prompt !== undefined) {
				if (state.level === 1 && finesses >= 1)
					return { feasible: false, connections: [] };

				if (state.common.thoughts[prompt.order].matches(next_identity, { assume: true })) {
					addConnections([{ type: 'prompt', reacting: target, card: prompt, self: true, identities: [next_identity] }]);
					continue;
				}
			}
			else {
				const finesse = state.common.find_finesse(their_hand, currIgnoreOrders);

				if (finesse) {
					const card = state.common.thoughts[finesse.order];

					if (card.inferred.some(p => p.matches(next_identity)) && card.matches(next_identity, { assume: true })) {
						if (state.level === 1 && ignoreOrders.length >= 1)
							return { feasible: false, connections: [] };

						addConnections([{ type: 'finesse', reacting: target, card: finesse, self: true, identities: [next_identity] }]);
						continue;
					}
				}
			}

			// Try finesse in our hand again (if we skipped it earlier to prefer ignoring player)
			if (giver !== state.ourPlayerIndex && selfRanks.includes(next_rank)) {
				const { feasible, connections: new_conns } = find_self_finesse(hypo_state, next_identity, currIgnoreOrders.slice(), finesses);

				if (!feasible)
					return { feasible: false, connections: [] };

				if (new_conns.length !== 0)
					addConnections(new_conns);
			}
		}
		return { feasible: false, connections: [] };
	}
	return { feasible: true, connections };
}

/**
 * @param {State} state
 * @param {Identity} identity
 * @param {number[]} ignoreOrders
 * @param {number} finesses
 * @returns {{ feasible: boolean, connections: Connection[] }}
 */
function find_self_finesse(state, identity, ignoreOrders, finesses) {
	const our_hand = state.hands[state.ourPlayerIndex];
	const { suitIndex, rank } = identity;

	/** @type {Connection[]} */
	const connections = [];

	let finesse = state.common.find_finesse(our_hand, ignoreOrders);
	logger.debug('finesse in slot', finesse ? our_hand.findIndex(c => c.order === finesse.order) + 1 : '-1');

	if (finesse === undefined)
		return { feasible: false, connections: [] };

	const card = state.me.thoughts[finesse.order];

	if (card.rewinded && finesse.suitIndex !== suitIndex && playableAway(state, finesse) === 0) {
		if (state.level < LEVEL.INTERMEDIATE_FINESSES) {
			logger.warn(`blocked layered finesse at level ${state.level}`);
			return { feasible: false, connections: [] };
		}
		return { feasible: true, connections: [{ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, hidden: true, self: true, identities: [finesse.raw()] }] };
	}

	if (card.inferred.some(p => p.matches(identity)) && card.matches(identity, { assume: true })) {
		if (state.level === 1 && ignoreOrders.length >= 1) {
			logger.warn(`blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);
			return { feasible: false, connections: [] };
		}

		// We have some information about the next finesse
		if (state.next_finesse.length > 0) {
			for (const action of state.next_finesse) {
				let index = our_hand.findIndex(c => c.order === state.common.find_finesse(our_hand, ignoreOrders).order);
				const { list, clue } = action;

				// Touching a matching card to the finesse - all untouched cards are layered
				// Touching a non-matching card - all touched cards are layered
				const matching = cardTouched(identity, state.variant, clue);
				let touched = list.includes(our_hand[index].order);

				while ((matching ? !touched : touched)) {
					let identities = state.common.hypo_stacks.map((stack_rank, suitIndex) => {
						return { suitIndex, rank: stack_rank + 1 };
					});

					// Touching a non-matching card - we know exactly what playbable identities it should be
					if (!matching) {
						const possibilities = find_possibilities(clue, state.variant);
						identities = identities.filter(card => possibilities.some(p => p.suitIndex === card.suitIndex && p.rank === rank));
					}

					connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: our_hand[index], hidden: true, self: true, identities });
					state.common.thoughts[our_hand[index].order].intersect('inferred', identities);

					ignoreOrders.push(our_hand[index].order);
					index++;
					if (index === our_hand.length)
						return { feasible: false, connections: [] };

					touched = list.includes(our_hand[index].order);
				}
			}
			// Assume next card is the finesse target
			finesse = state.common.find_finesse(our_hand, ignoreOrders);

			// Layered finesse is impossible
			if (finesse === undefined) {
				logger.warn(`couldn't find a valid finesse target after layers!`);
				return { feasible: false, connections: [] };
			}
		}
		connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, self: true, identities: [identity] });
	}

	return { feasible: true, connections };
}
