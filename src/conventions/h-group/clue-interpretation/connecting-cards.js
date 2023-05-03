import { cardCount } from '../../../variants.js';
import { find_prompt, find_finesse } from '../hanabi-logic.js';
import { card_elim } from '../../../basics.js';
import { playableAway } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Connection} Connection
 */

/**
 * Finds a known connecting card in the hand for a given suitIndex and rank.
 * @param  {State} state
 * @param  {number} playerIndex 	The player index whose hand we are looking through.
 * @param  {number} suitIndex
 * @param  {number} rank
 * @param  {number[]} ignoreOrders	The orders of cards to ignore when searching.
 * @return {Card}					A connecting card if it exists, otherwise undefined.
 */
function find_known(state, playerIndex, suitIndex, rank, ignoreOrders) {
	return state.hands[playerIndex].find(card =>
		!ignoreOrders.includes(card.order) &&
		card.matches(suitIndex, rank, { symmetric: true, infer: true }) &&				// The card must be known to the holder
		(playerIndex !== state.ourPlayerIndex ? card.matches(suitIndex, rank) : true)	// The card must actually match
	);
}

/**
 * Finds a (possibly unknown) playable card in the hand for a given suitIndex and rank.
 * @param  {State} state
 * @param  {number} playerIndex  	The player index whose hand we are looking through.
 * @param  {number} suitIndex
 * @param  {number} rank
 * @param  {number[]} ignoreOrders	The orders of cards to ignore when searching.
 * @return {Card}					A connecting card if it exists, otherwise undefined.
 */
function find_playable(state, playerIndex, suitIndex, rank, ignoreOrders) {
	return state.hands[playerIndex].find(card =>
		!ignoreOrders.includes(card.order) &&
		(card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0) || card.finessed) &&	// Card must be playable
		(playerIndex !== state.ourPlayerIndex ?
			card.matches(suitIndex, rank) :									// If not in our hand, the card must match
			card.inferred.some(c => c.matches(suitIndex, rank)))			// If in our hand, at least one inference must match
	);
}

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
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank)) {
		logger.info(`all ${Utils.logCard({suitIndex, rank})} in trash`);
		return;
	}

	ignoreOrders = ignoreOrders.concat(state.next_ignore);

	for (let i = 0; i < state.numPlayers; i++) {
		// Prioritize other players' hands first, since those are known
		const playerIndex = (state.ourPlayerIndex + 1 + i) % state.numPlayers;

		// Look for a known connecting card
		const known_conn = find_known(state, playerIndex, suitIndex, rank, ignoreOrders);

		if (known_conn !== undefined) {
			logger.info(`found known ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'known', reacting: playerIndex, card: known_conn };
		}

		// The giver cannot know about any unknown connecting cards in their hand
		if (playerIndex === giver) {
			continue;
		}

		// Look for a playable card that is not known to connect (excludes giver)
		const playable_conn = find_playable(state, playerIndex, suitIndex, rank, ignoreOrders);

		if (playable_conn !== undefined) {
			logger.info(`found playable ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand, with inferences ${playable_conn.inferred.map(c => Utils.logCard(c)).join()}`);
			return { type: 'playable', reacting: playerIndex, card: playable_conn };
		}
	}

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 0; i < state.numPlayers; i++) {
		if (i === giver || i === state.ourPlayerIndex) {
			// Clue giver cannot finesse/prompt themselves, we find our own prompts/finesses later
			continue;
		}
		else if (giver === state.ourPlayerIndex && i === target) {
			// If we are giving the clue, the receiver will not be able to find known prompts/finesses in their hand (FIX. Why?)
			continue;
		}
		else {
			const hand = state.hands[i];
			const prompt = find_prompt(hand, suitIndex, rank, state.suits, ignoreOrders);
			const finesse = find_finesse(hand, suitIndex, rank, ignoreOrders);

			// Prompt takes priority over finesse
			if (prompt !== undefined) {
				if (prompt.matches(suitIndex, rank)) {
					logger.info(`found prompt ${Utils.logCard(prompt)} in ${state.playerNames[i]}'s hand`);
					return { type: 'prompt', reacting: i, card: prompt };
				}

				// Prompted card is delayed playable
				if (state.hypo_stacks[prompt.suitIndex] + 1 === prompt.rank) {
					logger.info(`prompts playable ${Utils.logCard(prompt)}`)
					return { type: 'prompt', reacting: i, card: prompt, hidden: true };
				}
				else {
					logger.info(`wrong prompt on ${Utils.logCard(prompt)}`);
					continue;
				}
			}
			else if (finesse !== undefined) {
				if (finesse.matches(suitIndex, rank)) {
					// At level 1, only forward finesses are allowed.
					if (state.level === 1 && !inBetween(state.numPlayers, i, giver, target)) {
						logger.warn(`found finesse ${Utils.logCard(finesse)} in ${state.playerNames[i]}'s hand, but not between giver and target`);
						continue;
					}
					logger.info(`found finesse ${Utils.logCard(finesse)} in ${state.playerNames[i]}'s hand`);
					return { type: 'finesse', reacting: i, card: finesse };
				}
				// Finessed card is delayed playable
				else if (state.hypo_stacks[finesse.suitIndex] + 1 === finesse.rank) {
					logger.info(`finesses playable ${Utils.logCard(finesse)}`)
					return { type: 'finesse', reacting: i, card: finesse, hidden: true };
				}
			}
		}
	}

	logger.info(`couldn't find connecting ${Utils.logCard({suitIndex, rank})}`);
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
				if (state.level === 1 && already_finessed.length >= 1) {
					logger.warn('blocked prompt + finesse at level 1');
					feasible = false;
					break;
				}

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
					if (state.level === 1 && (already_finessed.length >= 1 || already_prompted.length >= 1)) {
						logger.warn(`blocked ${already_finessed.length >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);
						feasible = false;
						break;
					}

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
