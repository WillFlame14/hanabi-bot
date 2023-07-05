import { CLUE } from '../../../constants.js';
import { Card } from '../../../basics/Card.js';
import { find_chop } from '../hanabi-logic.js';
import { isCritical, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').BasicCard} BasicCard
 */

/**
 * Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
 * @param {State} state
 * @param {Clue} clue
 */
export function clue_safe(state, clue) {
	const { target } = clue;

	const list = state.hands[target].clueTouched(clue).map(c => c.order);
	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });	//, { simulatePlayerIndex: target });

	let next_unoccupied = (state.ourPlayerIndex + 1) % state.numPlayers;
	let finessed_card = hypo_state.hands[next_unoccupied].find(c => c.finessed && playableAway(hypo_state, c.suitIndex, c.rank) === 0);

	// Find the next player without a playable finessed card
	while (finessed_card && next_unoccupied !== state.ourPlayerIndex) {
		next_unoccupied = (next_unoccupied + 1) % state.numPlayers;
		hypo_state.play_stacks[finessed_card.suitIndex]++;
		finessed_card = hypo_state.hands[next_unoccupied].find(c => c.finessed && playableAway(hypo_state, c.suitIndex, c.rank) === 0);
	}

	// If everyone has a finessed card and it loops back to us, we assume we are fine. (TODO: Possibly allow someone to scream?)
	if (next_unoccupied !== state.ourPlayerIndex) {
		// Not dangerous, clue is fine to give
		if (!chopUnsafe(hypo_state, next_unoccupied)) {
			return true;
		}

		// Dangerous and not loaded, clue is not fine
		if (!hypo_state.hands[next_unoccupied].isLoaded()) {
			logger.warn(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop and not loaded`);
			return false;
		}

		// Dangerous and loaded
		let next_unoccupied2 = (next_unoccupied + 1) % state.numPlayers;
		let finessed_card2 = hypo_state.hands[next_unoccupied2].find(c => c.finessed && playableAway(hypo_state, c.suitIndex, c.rank) === 0);

		// Find the next next player without a playable finessed card
		while (finessed_card2 && next_unoccupied2 !== state.ourPlayerIndex) {
			next_unoccupied2 = (next_unoccupied2 + 1) % state.numPlayers;
			hypo_state.play_stacks[finessed_card2.suitIndex]++;
			finessed_card2 = hypo_state.hands[next_unoccupied2].find(c => c.finessed && playableAway(hypo_state, c.suitIndex, c.rank) === 0);
		}

		if (next_unoccupied2 === state.ourPlayerIndex) {
			return true;
		}

		logger.info(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop but loaded, next next ${state.playerNames[next_unoccupied2]} has ${chopUnsafe(hypo_state, next_unoccupied2) ? 'unsafe' : 'safe'} chop with ${hypo_state.clue_tokens} clues`);

		// Safe chop or can be saved
		return !chopUnsafe(hypo_state, next_unoccupied2) || hypo_state.clue_tokens > 0;
	}
	return true;
}

/**
 * Returns whether a card is a unique 2 on the board, according to us.
 * @param  {State} state
 * @param  {BasicCard} card
 */
function unique2(state, card) {
	const { suitIndex, rank } = card;

	return rank === 2 &&
		state.play_stacks[suitIndex] === 0 &&														// play stack at 0
		visibleFind(state, state.ourPlayerIndex, suitIndex, 2).length === 1 &&						// other copy isn't visible
		!state.hands[state.ourPlayerIndex].some(c => c.matches(suitIndex, rank, { infer: true }));  // not in our hand
}

/**
 * Returns the relative "value" of a card. 0 is worthless, 5 is critical.
 * TODO: Improve general algorithm. (e.g. having clued cards of a suit makes it better, a dead suit is worse)
 * @param  {State} state
 * @param  {BasicCard} card
 * @returns {number}
 */
export function card_value(state, card) {
	const { suitIndex, rank } = card;

	// Unknown card in our hand, return average of possibilities
	if (suitIndex === -1 && card instanceof Card) {
		return card.possible.reduce((sum, curr) => sum += card_value(state, curr), 0) / card.possible.length;
	}

	// Basic trash, saved already, duplicate visible
	if (isTrash(state, state.ourPlayerIndex, suitIndex, rank) || visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length > 1) {
		return 0;
	}

	if (isCritical(state, suitIndex, rank)) {
		return 5;
	}

	if (unique2(state, card)) {
		return 4;
	}

	// Next playable rank is value 4, rank 4 with nothing on the stack is value 1
	return 5 - (rank - state.hypo_stacks[suitIndex]);
}

/**
 * Checks if the card is a valid (and safe) 2 save.
 * @param {State} state
 * @param {number} target 	The player with the card
 * @param {BasicCard} card
 */
export function save2(state, target, card) {
	if (card.rank !== 2) {
		return false;
	}

	const clue = { type: CLUE.RANK, value: 2, target };
	return unique2(state, card) && clue_safe(state, clue);
}

/**
 * Checks if a player's chop is safe after a clue, according to us.
 * @param {State} state
 * @param {number} playerIndex
 */
export function chopUnsafe(state, playerIndex) {
	// Note that chop will be undefined if the entire hand is clued
	const hand = state.hands[playerIndex];
	const chop = hand[find_chop(hand, { afterClue: true })];

	return (chop && isCritical(state, chop.suitIndex, chop.rank) && !unique2(state, chop)) ||	// Crit or unique 2 on chop
			(state.clue_tokens === 0 && chop === undefined);									// Locked with no clue tokens (TODO: See if a 5 can be played?)
}
