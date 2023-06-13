import { CLUE } from '../../../constants.js';
import { cardCount } from '../../../variants.js';
import { LEVEL } from '../h-constants.js';
import { find_prompt, find_finesse } from '../hanabi-logic.js';
import { order_1s } from '../action-helper.js';
import { card_elim } from '../../../basics.js';
import { isBasicTrash, playableAway } from '../../../basics/hanabi-util.js';
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
 * Finds all (possibly unknown) playable cards in the hand for a given suitIndex and rank.
 * @param  {State} state
 * @param  {number} playerIndex  	The player index whose hand we are looking through.
 * @param  {number} suitIndex
 * @param  {number} rank
 * @param  {number[]} ignoreOrders	The orders of cards to ignore when searching.
 * @return {Card[]}					All connecting cards.
 */
function find_playables(state, playerIndex, suitIndex, rank, ignoreOrders) {
	return state.hands[playerIndex].filter(card =>
		!ignoreOrders.includes(card.order) &&
		(card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0) || card.finessed) &&	// Card must be playable
		(playerIndex !== state.ourPlayerIndex ?
			card.matches(suitIndex, rank) :									// If not in our hand, the card must match
			card.inferred.some(c => c.matches(suitIndex, rank)))			// If in our hand, at least one inference must match
	);
}

/**
 * Finds a known connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 		The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection}
 */
function find_known_connecting(state, giver, target, playerIndex, suitIndex, rank, ignoreOrders = []) {
	// Look for a known connecting card
	const known_conn = find_known(state, playerIndex, suitIndex, rank, ignoreOrders);

	if (known_conn !== undefined) {
		logger.info(`found known ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand`);
		return { type: 'known', reacting: playerIndex, card: known_conn };
	}

	// The giver cannot know about any unknown connecting cards in their hand
	if (playerIndex === giver) {
		return;
	}

	// Look for a playable card that is not known to connect (excludes giver)
	const playable_conns = find_playables(state, playerIndex, suitIndex, rank, ignoreOrders);

	if (playable_conns.length !== 0) {
		if (rank === 1 && playable_conns.some(card => card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1))) {
			const ordered_1s = order_1s(state, playable_conns);

			logger.info(`found playable ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand, reordering to oldest 1`);
			return { type: 'playable', reacting: playerIndex, card: ordered_1s[0] };
		}
		else {
			const playable_conn = playable_conns[0];
			logger.info(`found playable ${Utils.logCard({suitIndex, rank})} in ${state.playerNames[playerIndex]}'s hand, with inferences ${playable_conn.inferred.map(c => Utils.logCard(c)).join()}`);
			return { type: 'playable', reacting: playerIndex, card: playable_conn };
		}
	}
}

/**
 * Finds a (possibly layered) prompt or finesse as a connecting card (or unknown playable).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 		The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection}
 */
function find_unknown_connecting(state, giver, target, playerIndex, suitIndex, rank, ignoreOrders = []) {
	const hand = state.hands[playerIndex];
	const prompt = find_prompt(hand, suitIndex, rank, state.suits, ignoreOrders);
	const finesse = find_finesse(hand, ignoreOrders);

	// Prompt takes priority over finesse
	if (prompt !== undefined) {
		if (prompt.matches(suitIndex, rank)) {
			logger.info(`found prompt ${Utils.logCard(prompt)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'prompt', reacting: playerIndex, card: prompt };
		}

		// Prompted card is delayed playable
		if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[prompt.suitIndex] + 1 === prompt.rank) {
			logger.info(`found playable prompt ${Utils.logCard(prompt)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'prompt', reacting: playerIndex, card: prompt, hidden: true };
		}
		else {
			logger.info(`wrong prompt on ${Utils.logCard(prompt)}`);
			return;
		}
	}
	else if (finesse !== undefined) {
		if (finesse.matches(suitIndex, rank)) {
			// At level 1, only forward finesses are allowed.
			if (state.level === 1 && !inBetween(state.numPlayers, playerIndex, giver, target)) {
				logger.warn(`found finesse ${Utils.logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand, but not between giver and target`);
				return;
			}
			logger.info(`found finesse ${Utils.logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'finesse', reacting: playerIndex, card: finesse };
		}
		// Finessed card is delayed playable
		else if (state.level >= LEVEL.INTERMEDIATE_FINESSES && state.play_stacks[finesse.suitIndex] + 1 === finesse.rank) {
			logger.info(`found playable finesse ${Utils.logCard(finesse)} in ${state.playerNames[playerIndex]}'s hand`);
			return { type: 'finesse', reacting: playerIndex, card: finesse, hidden: true };
		}
	}
}

/**
 * Looks for an inferred connecting card (i.e. without forcing a prompt/finesse).
 * @param {State} state
 * @param {number} giver 		The player index that gave the clue. They cannot deduce unknown information about their own hand.
 * @param {number} target 		The player index receiving the clue. They will not find self-prompts or self-finesses.
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignoreOrders]		The orders of cards to ignore when searching.
 * @returns {Connection[]}
 */
export function find_connecting(state, giver, target, suitIndex, rank, ignoreOrders = []) {
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank)) {
		logger.info(`all ${Utils.logCard({suitIndex, rank})} in trash`);
		return [];
	}

	ignoreOrders = ignoreOrders.concat(state.next_ignore);

	for (let i = 0; i < state.numPlayers; i++) {
		// Prioritize other players' hands first, since those are known
		const playerIndex = (state.ourPlayerIndex + 1 + i) % state.numPlayers;
		const connecting = find_known_connecting(state, giver, target, playerIndex, suitIndex, rank, ignoreOrders);

		if (connecting) {
			return [connecting];
		}
	}

	// Only consider prompts/finesses if no connecting cards found
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

		if (playerIndex === giver) {
			// Clue giver cannot finesse/prompt themselves
			continue;
		}
		else if (playerIndex === target && state.hypo_stacks.some(stack => stack + 1 === rank)) {
			// Clue receiver will not find known prompts/finesses in their hand unless no identities are delayed playable
			continue;
		}
		else {
			const connections = [];
			const newIgnoreOrders = ignoreOrders.slice();

			let connecting = find_unknown_connecting(state, giver, target, playerIndex, suitIndex, rank, newIgnoreOrders);

			// If the connection is hidden, that player must have the actual card playable in order for the layer to work.
			// Thus, we keep searching for unknown connections in their hand until we find a non-hidden connection.
			while (connecting?.hidden) {
				connections.push(connecting);
				newIgnoreOrders.push(connecting.card.order);

				connecting = find_unknown_connecting(state, giver, target, playerIndex, suitIndex, rank, newIgnoreOrders);
			}

			if (connecting) {
				connections.push(connecting);
			}

			// The final card must not be hidden
			if (connections.length > 0){
				if (!connections.at(-1).hidden) {
					return connections;
				}
				else {
					logger.info(`couldn't finish layered finesse`);
				}
			}
		}
	}

	logger.info(`couldn't find connecting ${Utils.logCard({suitIndex, rank})}`);
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
	let connections = [];

	let feasible = true;
	let ignoreOrders = [], finesses = 0;

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		if (hypo_state.discard_stacks[suitIndex][next_rank - 1] === cardCount(hypo_state.suits[suitIndex], next_rank)) {
			logger.info(`impossible to find ${Utils.logCard({suitIndex, rank: next_rank})}, both cards in trash`);
			feasible = false;
			break;
		}

		// First, see if someone else has the connecting card
		const other_connecting = find_connecting(hypo_state, giver, target, suitIndex, next_rank, ignoreOrders);
		if (other_connecting.length > 0) {
			connections = connections.concat(other_connecting);
			ignoreOrders = ignoreOrders.concat(other_connecting.map(conn => conn.card.order));
		}
		else {
			// Otherwise, try to find prompt in our hand
			const prompt = find_prompt(our_hand, suitIndex, next_rank, hypo_state.suits, ignoreOrders);
			logger.debug('prompt in slot', prompt ? our_hand.findIndex(c => c.order === prompt.order) + 1 : '-1');
			if (prompt !== undefined) {
				if (state.level === 1 && finesses >= 1) {
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
				ignoreOrders.push(prompt.order);
			}
			else {
				// Otherwise, try to find finesse in our hand
				const finesse = find_finesse(our_hand, ignoreOrders);
				logger.debug('finesse in slot', finesse ? our_hand.findIndex(c => c.order === finesse.order) + 1 : '-1');

				if (finesse?.inferred.some(p => p.matches(suitIndex, next_rank))) {
					if (state.level === 1 && ignoreOrders.length >= 1) {
						logger.warn(`blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);
						feasible = false;
						break;
					}

					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', reacting: hypo_state.ourPlayerIndex, card: finesse, self: true });

					// Assume this is actually the card
					finesse.intersect('inferred', [{suitIndex, rank: next_rank}]);
					finesse.intersect('possible', [{suitIndex, rank: next_rank}]);
					card_elim(hypo_state, suitIndex, next_rank);
					ignoreOrders.push(finesse.order);
					finesses++;
				}
				else if (finesse?.rewinded && playableAway(state, finesse.possible[0].suitIndex, finesse.possible[0].rank) === 0) {
					if (state.level < LEVEL.INTERMEDIATE_FINESSES) {
						logger.warn(`blocked layered finesse at level ${state.level}`);
						feasible = false;
						break;
					}

					logger.info('found layered finesse in our hand');
					connections.push({ type: 'finesse', reacting: hypo_state.ourPlayerIndex, card: finesse, hidden: true, self: true });

					ignoreOrders.push(finesse.order);
					next_rank--;
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
