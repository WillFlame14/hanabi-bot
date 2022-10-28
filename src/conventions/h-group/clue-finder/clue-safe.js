import { find_chop } from '../hanabi-logic.js';
import { handLoaded } from '../../../basics/helper.js';
import { isCritical } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
 * @param {import('../../../basics/State.js').State} state
 * @param {import('../../../types.js').Clue} clue
 */
export function clue_safe(state, clue) {
	const { target } = clue;

	const list = state.hands[target].clueTouched(state.suits, clue).map(c => c.order);
	const action = { type: 'clue', giver: state.ourPlayerIndex, target, list, clue };
	const hypo_state = state.simulate_clue(action);//, { simulatePlayerIndex: target });

	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	const hand = hypo_state.hands[nextPlayerIndex];

	// They won't discard next turn
	if (handLoaded(hypo_state, nextPlayerIndex)) {
		return true;
	}

	// Note that chop will be undefined if the entire hand is clued
	const chop = hand[find_chop(hand, { includeNew: true })];
	if (chop === undefined) {
		logger.debug('no chop after clue');
	}
	else {
		logger.debug(`chop after clue is ${Utils.logCard(chop)}`);
	}

	let give_clue = true;

	// New chop is critical
	if (chop !== undefined && isCritical(hypo_state, chop.suitIndex, chop.rank)) {
		// No time to give second save
		if (state.clue_tokens === 1) {
			logger.error(`Not giving clue ${Utils.logClue(clue)}, as ${Utils.logCard(chop)} is critical.`);
			give_clue = false;
		}
	}

	// Locked hand and no clues
	if (chop === undefined && hypo_state.clue_tokens === 0) {
		logger.error(`Not giving clue ${Utils.logClue(clue)}, as hand would be locked with no clues.`);
		give_clue = false;
	}

	return give_clue;
}
