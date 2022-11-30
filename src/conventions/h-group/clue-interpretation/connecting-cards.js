import { cardCount } from '../../../variants.js';
import { find_prompt, find_finesse } from '../hanabi-logic.js';
import { card_elim } from '../../../basics.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Connection} Connection
 */

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 		The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection}
 */
export function find_connecting(state, giver, target, suitIndex, rank, ignoreOrders = []) {
	logger.info('looking for connecting', Utils.logCard({suitIndex, rank}));

	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank)) {
		logger.info('all cards in trash');
		return;
	}

	for (let i = 0; i < state.numPlayers; i++) {
		// Look through other players' hands first, since those are known
		const playerIndex = (state.ourPlayerIndex + 1 + i) % state.numPlayers;
		const hand = state.hands[playerIndex];

		const known_connecting = hand.find(card =>
			card.matches(suitIndex, rank, { symmetric: true, infer: true }) &&
			(playerIndex !== state.ourPlayerIndex ? card.matches(suitIndex, rank) : true) &&		// The card should actually match
			!ignoreOrders.includes(card.order)
		);

		if (known_connecting !== undefined) {
			logger.info(`found known ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'known', reacting: playerIndex, card: known_connecting };
		}

		const playable_connecting = hand.find(card => {
			if (ignoreOrders.includes(card.order)) {
				return false;
			}

			if (playerIndex !== state.ourPlayerIndex) {
				return (card.inferred.every(c => state.play_stacks[c.suitIndex] + 1 === c.rank) || card.finessed) &&
					card.matches(suitIndex, rank);
			}
			else {
				return card.inferred.every(c => state.play_stacks[c.suitIndex] + 1 === c.rank) &&
					card.inferred.some(c => c.matches(suitIndex, rank));
			}
		});

		// There's a connecting card that is known playable (but not in the giver's hand!)
		if (playable_connecting !== undefined && playerIndex !== giver) {
			logger.info(`found playable ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand`);
			logger.info('card inferred', playable_connecting.inferred.map(c => Utils.logCard(c)).join());
			return { type: 'playable', reacting: playerIndex, card: playable_connecting };
		}
	}

	for (let i = 0; i < state.numPlayers; i++) {
		if (i === giver || i === state.ourPlayerIndex) {
			continue;
		}
		else if (giver === state.ourPlayerIndex && i === target) {
			// If we are giving the clue, the receiver will not be able to find known prompts/finesses in their hand
			continue;
		}
		else {
			// Try looking through another player's hand (known to giver) (target?)
			const hand = state.hands[i];
			const prompt = find_prompt(hand, suitIndex, rank, state.suits, ignoreOrders);
			const finesse = find_finesse(hand, suitIndex, rank, ignoreOrders);

			// Prompt takes priority over finesse
			if (prompt !== undefined) {
				if (prompt.matches(suitIndex, rank)) {
					logger.info(`found prompt ${Utils.logCard(prompt)} in ${state.playerNames[i]}'s hand`);
					return { type: 'prompt', reacting: i, card: prompt, self: false };
				}
				logger.debug(`couldn't prompt ${Utils.logCard({suitIndex, rank})}, ignoreOrders ${ignoreOrders}`);
			}
			else if (finesse?.matches(suitIndex, rank)) {
				logger.info(`found finesse ${Utils.logCard(finesse)} in ${state.playerNames[i]}'s hand`);
				return { type: 'finesse', reacting: i, card: finesse, self: false };
			}
		}
	}
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {number} suitIndex
 * @param {number} rank
 * @returns {{feasible: boolean, connections: Connection[]}}
 */
export function find_own_finesses(state, giver, target, suitIndex, rank) {
	// We cannot finesse ourselves
	if (giver === state.ourPlayerIndex) {
		return { feasible: false, connections: [] };
	}

	// Create hypothetical state where we have the missing cards (and others can elim from them)
	const hypo_state = Utils.objClone(state);

	logger.info('finding finesse for (potentially) clued card', Utils.logCard({suitIndex, rank}));
	const our_hand = hypo_state.hands[state.ourPlayerIndex];

	/** @type {Connection[]} */
	const connections = [];

	let feasible = true;
	const already_prompted = [], already_finessed = [];

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		if (hypo_state.discard_stacks[suitIndex][next_rank - 1] === cardCount(hypo_state.suits[suitIndex], next_rank)) {
			logger.info(`impossible to find ${Utils.logCard({suitIndex, rank: next_rank})}, both cards in trash`);
			feasible = false;
			break;
		}

		// First, see if someone else has the connecting card
		const other_connecting = find_connecting(hypo_state, giver, target, suitIndex, next_rank, already_prompted.concat(already_finessed));
		if (other_connecting !== undefined) {
			connections.push(other_connecting);
		}
		else {
			// Otherwise, try to find prompt in our hand
			const prompt = find_prompt(our_hand, suitIndex, next_rank, hypo_state.suits, already_prompted);
			if (prompt !== undefined) {
				logger.info('found prompt in our hand');
				connections.push({ type: 'prompt', reacting: hypo_state.ourPlayerIndex, card: prompt, self: true });

				// Assume this is actually the card
				prompt.intersect('inferred', [{suitIndex, rank: next_rank}]);
				prompt.intersect('possible', [{suitIndex, rank: next_rank}]);
				card_elim(hypo_state, suitIndex, next_rank);
				already_prompted.push(prompt.order);
			}
			else {
				// Otherwise, try to find finesse in our hand
				const finesse = find_finesse(our_hand, suitIndex, next_rank, already_finessed);
				if (finesse !== undefined) {
					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', reacting: hypo_state.ourPlayerIndex, card: finesse, self: true });

					// Assume this is actually the card
					finesse.intersect('inferred', [{suitIndex, rank: next_rank}]);
					finesse.intersect('possible', [{suitIndex, rank: next_rank}]);
					card_elim(hypo_state, suitIndex, next_rank);
					already_finessed.push(finesse.order);
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
