import { CLUE } from '../../../constants.js';
import { cardCount } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { find_prompt, find_finesse } from '../hanabi-logic.js';
import { order_1s } from '../action-helper.js';
import { card_elim } from '../../../basics.js';
import { playableAway } from '../../../basics/hanabi-util.js';
import { cardTouched } from '../../../variants.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Connection} Connection
 */

/**
 * Finds a known connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection}
 */
function find_known_connecting(state, giver, suitIndex, rank, ignoreOrders = []) {
	// Symmetrically (globally) known
	for (let i = 0; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		for (const card of state.hands[playerIndex]) {
			if (ignoreOrders.includes(card.order)) {
				continue;
			}

			if (card.matches(suitIndex, rank, { symmetric: true, infer: true }) && (card.identity() === undefined || card.matches(suitIndex, rank))) {
				logger.info(`found known ${logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand`);
				return { type: 'known', reacting: playerIndex, card };
			}
		}
	}

	// Visible and already going to be played (excluding giver)
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;
		const hand = state.hands[playerIndex];

		// Unknown playables that match
		const playables = hand.filter(card =>
			!ignoreOrders.includes(card.order) &&
			card.inferred.some(c => c.matches(suitIndex, rank)) &&
			(card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0) || card.finessed)
		);
		const match = playables.find(card => card.matches(suitIndex, rank));

		// More than 1 such playable and it could be duplicated in giver's hand - disallow hidden delayed play
		if (playables.length > 1 && state.hands[giver].some(c => c.clued && c.inferred.some(inf => inf.matches(suitIndex, rank)))) {
			if (match !== undefined) {
				// Everyone other than giver will recognize this card as the connection - stop looking further
				return { type: 'terminate', reacting: null, card: null };
			}
			logger.info(`disallowed hidden delayed play on ${logCard({ suitIndex, rank })}, could be duplicated in giver's hand`);
			return;
		}

		if (match !== undefined) {
			if (match.hidden) {
				logger.warn(`hidden connecting card ${logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand, might be confusing`);
			}
			logger.info(`found playable ${logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand, with inferences ${match.inferred.map(c => logCard(c)).join()}`);
			return { type: 'playable', reacting: playerIndex, card: match, known: playables.length === 1 };
		}
	}
}

/**
 * Finds a (possibly layered) prompt or finesse as a connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @returns {Connection}
 */
function find_unknown_connecting(state, giver, target, playerIndex, suitIndex, rank, ignoreOrders = []) {
	const hand = state.hands[playerIndex];
	const prompt = find_prompt(hand, suitIndex, rank, state.suits, ignoreOrders);
	const finesse = find_finesse(hand, ignoreOrders);

	// Prompt takes priority over finesse
	if (prompt !== undefined) {
		if (prompt.matches(suitIndex, rank)) {
			logger.info(`found prompt ${logCard(prompt)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'prompt', reacting: playerIndex, card: prompt };
		}

		// Prompted card is delayed playable
		if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt.suitIndex] + 1 === prompt.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (state.hands[giver].some(c => c.clued && c.inferred.some(inf => inf.matches(suitIndex, rank)))) {
				logger.info(`disallowed hidden prompt on ${logCard(prompt)}, could be duplicated in giver's hand`);
				return;
			}
			logger.info(`found playable prompt ${logCard(prompt)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'prompt', reacting: playerIndex, card: prompt, hidden: true };
		}
		else {
			logger.info(`wrong prompt on ${logCard(prompt)}`);
			return;
		}
	}
	else if (finesse !== undefined) {
		if (finesse.matches(suitIndex, rank)) {
			// At level 1, only forward finesses are allowed.
			if (state.level === 1 && !inBetween(state.numPlayers, playerIndex, giver, target)) {
				logger.warn(`found finesse ${logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand, but not between giver and target`);
				return;
			}
			logger.info(`found finesse ${logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'finesse', reacting: playerIndex, card: finesse };
		}
		// Finessed card is delayed playable
		else if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse.suitIndex] + 1 === finesse.rank) {
			// Could be duplicated in giver's hand - disallow hidden prompt
			if (state.hands[giver].some(c => c.clued && c.inferred.some(inf => inf.matches(suitIndex, rank)))) {
				logger.info(`disallowed hidden finesse on ${logCard(finesse)}, could be duplicated in giver's hand`);
				return;
			}
			logger.info(`found playable finesse ${logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'finesse', reacting: playerIndex, card: finesse, hidden: true };
		}
	}
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {State} state
 * @param {number} giver 			The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 			The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {boolean} looksDirect 	Whether the clue could be interpreted as direct play (i.e. never as self-prompt/finesse).
 * @param {number[]} [ignoreOrders] The orders of cards to ignore when searching.
 * @returns {Connection[]}
 */
export function find_connecting(state, giver, target, suitIndex, rank, looksDirect, ignoreOrders = []) {
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank)) {
		logger.info(`all ${logCard({suitIndex, rank})} in trash`);
		return [];
	}

	const connecting = find_known_connecting(state, giver, suitIndex, rank, ignoreOrders);
	if (connecting) {
		if (connecting.type === 'terminate') {
			return [];
		}
		return [connecting];
	}

	// Do not consider unknown playables if the card is already gotten in the target's hand (?)
	// TODO: Maybe some version of this if it's found in non-prompt position in anyone else's hand?
	const target_copy = state.hands[target].find(c => c.matches(suitIndex, rank) && ((c.clued && !c.newly_clued) || c.finessed) && !ignoreOrders.includes(c.order));
	if (target_copy !== undefined) {
		logger.warn(`connecting ${logCard({suitIndex, rank})} gotten in target's hand, might look confusing`);
		// return [{ type: 'terminate', reacting: null, card: null }];
	}

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (giver + i) % state.numPlayers;

		if (playerIndex === target && looksDirect) {
			// Clue receiver will not find known prompts/finesses in their hand unless no identities are delayed playable
			continue;
		}
		else {
			const connections = [];
			const hypo_state = state.minimalCopy();
			const newIgnoreOrders = ignoreOrders.slice();

			logger.collect();

			let connecting = find_unknown_connecting(hypo_state, giver, target, playerIndex, suitIndex, rank, newIgnoreOrders);

			// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
			// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
			while (connecting?.hidden) {
				connections.push(connecting);
				newIgnoreOrders.push(connecting.card.order);
				hypo_state.play_stacks[connecting.card.suitIndex]++;

				connecting = find_unknown_connecting(hypo_state, giver, target, playerIndex, suitIndex, rank, newIgnoreOrders);
			}

			if (connecting) {
				connections.push(connecting);
			}

			// The final card must not be hidden
			if (connections.length > 0 && !connections.at(-1).hidden) {
				logger.flush(true);
				return connections;
			}
			logger.flush(false);
		}
	}

	// Unknown playable(s) in our hand (obviously, we can't use them in our clues)
	if (giver !== state.ourPlayerIndex) {
		const playable_conns = state.hands[state.ourPlayerIndex].filter(card =>
				!ignoreOrders.includes(card.order) &&
				card.inferred.some(inf => inf.matches(suitIndex, rank)) &&					// At least one inference must match
				(card.identity() === undefined || card.matches(suitIndex, rank)) &&			// If we know the card (from a rewind), it must match
				(card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0) || card.finessed));	// Must be playable

		if (playable_conns.length > 0) {
			if (rank === 1 && playable_conns.every(card => card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1))) {
				const ordered_1s = order_1s(state, playable_conns);

				logger.info(`found playable ${logCard({suitIndex, rank})} in our hand, reordering to oldest 1`);
				return [{ type: 'playable', reacting: state.ourPlayerIndex, card: ordered_1s[0], known: playable_conns.length === 1 }];
			}
			else {
				const playable_conn = playable_conns[0];
				logger.info(`found playable ${logCard({suitIndex, rank})} in our hand, with inferences ${playable_conn.inferred.map(c => logCard(c)).join()}`);
				return [{ type: 'playable', reacting: state.ourPlayerIndex, card: playable_conn, known: playable_conns.length === 1 }];
			}
		}
	}

	logger.info(`couldn't find connecting ${logCard({suitIndex, rank})}`);
	return [];
}

/**
 * Returns whether the playerIndex is "in between" the giver and target (in play order).
 * @param {number} numPlayers
 * @param {number} playerIndex
 * @param {number} giver
 * @param {number} target
 */
function inBetween(numPlayers, playerIndex, giver, target) {
	let i = (giver + 1) % numPlayers;
	while(i !== target) {
		if (i === playerIndex) {
			return true;
		}
		i = (i + 1) % numPlayers;
	}
	return false;
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {number} suitIndex
 * @param {number} rank
 * @param {boolean} looksDirect
 * @returns {{feasible: boolean, connections: Connection[]}}
 */
export function find_own_finesses(state, giver, target, suitIndex, rank, looksDirect) {
	// We cannot finesse ourselves
	if (giver === state.ourPlayerIndex) {
		return { feasible: false, connections: [] };
	}

	// Create hypothetical state where we have the missing cards (and others can elim from them)
	const hypo_state = state.minimalCopy();

	logger.info('finding finesse for', (target === state.ourPlayerIndex ? 'potential' : 'visible'), logCard({suitIndex, rank}));
	const our_hand = hypo_state.hands[state.ourPlayerIndex];

	/** @type {Connection[]} */
	let connections = [];

	let feasible = true;
	let ignoreOrders = [], finesses = 0;

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		if (hypo_state.discard_stacks[suitIndex][next_rank - 1] === cardCount(hypo_state.suits[suitIndex], next_rank)) {
			logger.info(`impossible to find ${logCard({suitIndex, rank: next_rank})}, both cards in trash`);
			feasible = false;
			break;
		}

		// First, see if someone else has the connecting card
		const currIgnoreOrders = ignoreOrders.concat(state.next_ignore[next_rank - hypo_state.play_stacks[suitIndex] - 1] ?? []);
		const other_connecting = find_connecting(hypo_state, giver, target, suitIndex, next_rank, looksDirect, currIgnoreOrders);
		if (other_connecting.length > 0) {
			connections = connections.concat(other_connecting);
			ignoreOrders = ignoreOrders.concat(other_connecting.map(conn => conn.card.order));
		}
		else {
			// Otherwise, try to find prompt in our hand
			const prompt = find_prompt(our_hand, suitIndex, next_rank, hypo_state.suits, currIgnoreOrders);
			logger.debug('prompt in slot', prompt ? our_hand.findIndex(c => c.order === prompt.order) + 1 : '-1');
			if (prompt !== undefined) {
				if (state.level === 1 && finesses >= 1) {
					logger.warn('blocked prompt + finesse at level 1');
					feasible = false;
					break;
				}

				if (prompt?.rewinded && playableAway(hypo_state, prompt.suitIndex, prompt.rank) === 0) {
					if (state.level < LEVEL.INTERMEDIATE_FINESSES) {
						logger.warn(`blocked hidden finesse at level ${state.level}`);
						feasible = false;
						break;
					}

					logger.info('found hidden prompt', logCard(prompt), 'in our hand - still searching for', logCard({ suitIndex, rank: next_rank}));
					connections.push({ type: 'known', reacting: state.ourPlayerIndex, card: prompt, hidden: true, self: true });
					hypo_state.play_stacks[prompt.suitIndex]++;

					ignoreOrders.push(prompt.order);
					next_rank--;
				}
				else if (prompt.identity() === undefined || prompt.matches(suitIndex, next_rank)) {
					logger.info('found prompt in our hand');
					connections.push({ type: 'prompt', reacting: hypo_state.ourPlayerIndex, card: prompt, self: true });

					// Assume this is actually the card
					prompt.intersect('inferred', [{suitIndex, rank: next_rank}]);
					for (let i = 0; i < state.numPlayers; i++) {
						card_elim(hypo_state, i, suitIndex, next_rank);
					}
					ignoreOrders.push(prompt.order);
				}
			}
			else {
				// Otherwise, try to find finesse in our hand
				let finesse = find_finesse(our_hand, currIgnoreOrders);
				logger.debug('finesse in slot', finesse ? our_hand.findIndex(c => c.order === finesse.order) + 1 : '-1');

				if (finesse?.rewinded && playableAway(hypo_state, finesse.suitIndex, finesse.rank) === 0) {
					if (state.level < LEVEL.INTERMEDIATE_FINESSES) {
						logger.warn(`blocked layered finesse at level ${state.level}`);
						feasible = false;
						break;
					}

					logger.info('found layered finesse', logCard(finesse), 'in our hand - still searching for', logCard({ suitIndex, rank: next_rank}));
					connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, hidden: true, self: true });
					hypo_state.play_stacks[finesse.suitIndex]++;

					ignoreOrders.push(finesse.order);
					next_rank--;
					finesses++;
				}
				else if (finesse?.inferred.some(p => p.matches(suitIndex, next_rank)) && (finesse.identity() === undefined || finesse.matches(suitIndex, next_rank))) {
					if (state.level === 1 && ignoreOrders.length >= 1) {
						logger.warn(`blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);
						feasible = false;
						break;
					}

					// We have some information about the next finesse
					if (state.next_finesse.length > 0) {
						for (const action of state.next_finesse) {
							let index = our_hand.findIndex(c => c.order === find_finesse(our_hand, currIgnoreOrders).order);
							const { list, clue } = action;

							// Touching a matching card to the finesse - all untouched cards are layered
							// Touching a non-matching card - all touched cards are layered
							const matching = cardTouched({suitIndex, rank: next_rank}, state.suits, clue);
							let touched = list.includes(our_hand[index].order);

							while ((matching ? !touched : touched)) {
								logger.info('adding layered finesse in our hand in slot', index + 1);
								connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: our_hand[index], hidden: true, self: true });

								const playable_identities = hypo_state.hypo_stacks.map((stack_rank, index) => { return { suitIndex: index, rank: stack_rank + 1 }; });
								our_hand[index].intersect('inferred', playable_identities);

								ignoreOrders.push(our_hand[index].order);
								currIgnoreOrders.push(our_hand[index].order);
								index++;
								if (index === our_hand.length) {
									feasible = false;
									break;
								}
								touched = list.includes(our_hand[index].order);
							}
						}

						if (!feasible) {
							break;
						}
						// Assume next card is the finesse target
						finesse = find_finesse(our_hand, currIgnoreOrders);

						// Layered finesse is imposible
						if (finesse === undefined) {
							logger.info(`couldn't find a valid finesse target after layers!`);
							feasible = false;
							break;
						}
					}

					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, self: true });

					// Assume this is actually the card
					finesse.intersect('inferred', [{suitIndex, rank: next_rank}]);
					for (let i = 0; i < state.numPlayers; i++) {
						card_elim(hypo_state, i, suitIndex, next_rank);
					}
					ignoreOrders.push(finesse.order);
					finesses++;
				}
				else {
					feasible = false;
					break;
				}
			}
		}
	}
	return { feasible, connections };
}
