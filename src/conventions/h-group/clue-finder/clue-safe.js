import { HGroup_Hand as Hand } from '../../h-hand.js';
import { isCritical, playableAway, unique2 } from '../../../basics/hanabi-util.js';

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

	const list = state.hands[target].clueTouched(clue, state.suits).map(c => c.order);
	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });

	/** @param {number} startIndex */
	const getNextUnoccupied = (startIndex) => {
		let nextIndex = (startIndex + 1) % state.numPlayers;
		let finessed_card = hypo_state.hands[nextIndex].find(c => c.finessed && playableAway(hypo_state, c) === 0);

		// Find the next player without a playable finessed card
		while (finessed_card && nextIndex !== state.ourPlayerIndex) {
			nextIndex = (nextIndex + 1) % state.numPlayers;
			hypo_state.play_stacks[finessed_card.suitIndex]++;
			finessed_card = hypo_state.hands[nextIndex].find(c => c.finessed && playableAway(hypo_state, c) === 0);
		}
		return nextIndex;
	};

	const next_unoccupied = getNextUnoccupied(state.ourPlayerIndex);

	// If everyone has a finessed card and it loops back to us, we assume we are fine. (TODO: Possibly allow someone to scream?)
	if (next_unoccupied === state.ourPlayerIndex) {
		return true;
	}

	// Not dangerous, clue is fine to give
	if (!chopUnsafe(hypo_state, next_unoccupied)) {
		return true;
	}

	// Dangerous and not loaded, clue is not fine
	if (!Hand.isLoaded(hypo_state, next_unoccupied)) {
		logger.warn(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop and not loaded`);
		return false;
	}

	// Dangerous and loaded
	const next_unoccupied2 = getNextUnoccupied(next_unoccupied);

	if (next_unoccupied2 === state.ourPlayerIndex) {
		return true;
	}

	logger.info(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop but loaded, next next ${state.playerNames[next_unoccupied2]} has ${chopUnsafe(hypo_state, next_unoccupied2) ? 'unsafe' : 'safe'} chop with ${hypo_state.clue_tokens} clues`);

	// Safe chop or can be saved
	return !chopUnsafe(hypo_state, next_unoccupied2) || hypo_state.clue_tokens > 0;
}

/**
 * Checks if a player's chop is safe after a clue, according to us.
 * @param {State} state
 * @param {number} playerIndex
 */
export function chopUnsafe(state, playerIndex) {
	// Note that chop will be undefined if the entire hand is clued
	const chop = state.hands[playerIndex].chop({ afterClue: true });

	return (chop && (isCritical(state, chop) || unique2(state, chop))) ||	// Crit or unique 2 on chop
			(state.clue_tokens === 0 && chop === undefined);				// Locked with no clue tokens (TODO: See if a 5 can be played?)
}
