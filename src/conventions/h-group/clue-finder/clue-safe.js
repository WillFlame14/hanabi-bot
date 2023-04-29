import { CLUE } from '../../../constants.js';
import { find_chop } from '../hanabi-logic.js';
import { handLoaded } from '../../../basics/helper.js';
import { isCritical, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 */

/**
 * Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
 * @param {State} state
 * @param {Clue} clue
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
	logger.debug(chop ? `chop after clue is ${Utils.logCard(chop)}` : 'no chop after clue');

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

/**
 * Returns whether a card is a unique 2 on the board, according to us.
 * @param  {State} state
 * @param  {{ suitIndex: number, rank: number }} card
 */
function unique2(state, card) {
	const { suitIndex, rank } = card;

	return state.play_stacks[suitIndex] === 0 &&													// play stack at 0
		visibleFind(state, state.ourPlayerIndex, suitIndex, 2).length === 1 &&						// other copy isn't visible
		!state.hands[state.ourPlayerIndex].some(c => c.matches(suitIndex, rank, { infer: true }));  // not in our hand
}

/**
 * Returns the relative "value" of a card. 0 is worthless, 5 is critical.
 * TODO: Improve general algorithm. (e.g. having clued cards of a suit makes it better, a dead suit is worse)
 * @param  {State} state
 * @param  {{ suitIndex: number, rank: number }} card
 */
export function card_value(state, card) {
	const { suitIndex, rank } = card;

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

	return rank - state.hypo_stacks[suitIndex];
}

/**
 * Checks if the card is a valid (and safe) 2 save.
 * @param {State} state
 * @param {number} target 	The player with the card
 * @param {{ suitIndex: number, rank: number }} card
 */
export function save2(state, target, card) {
	if (card.rank !== 2) {
		return false;
	}

	const clue = { type: CLUE.RANK, value: 2, target };
	return unique2(state, card) && clue_safe(state, clue);
}
