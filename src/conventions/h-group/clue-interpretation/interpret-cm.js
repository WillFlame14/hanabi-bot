import { CLUE } from '../../../constants.js';
import { find_chop } from '../hanabi-logic.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import logger from '../../../logger.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 */

/**
 * Executes a Trash Chop Move on the target (i.e. writing notes). The clue must have already been registered.
 * @param {State} state
 * @param {number} target
 */
export function interpret_tcm(state, target) {
	let oldest_trash_index;
	// Find the oldest newly clued trash
	for (let i = state.hands[target].length - 1; i >= 0; i--) {
		const card = state.hands[target][i];

		if (card.newly_clued && card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank, card.order))) {
			oldest_trash_index = i;
			break;
		}
	}

	logger.info(`oldest trash card is ${Utils.logCard(state.hands[target][oldest_trash_index])}`);

	const cm_cards = [];

	// Chop move every unclued card to the right of this
	for (let i = oldest_trash_index + 1; i < state.hands[target].length; i++) {
		const card = state.hands[target][i];

		if (!card.clued) {
			card.chop_moved = true;
			cm_cards.push(Utils.logCard(card));
		}
	}
	logger.warn(cm_cards.length === 0 ? 'no cards to tcm' : `trash chop move on ${cm_cards.join(',')}`);
}

/**
 * Executes a 5's Chop Move on the target (i.e. writing notes), if valid. The clue must have already been registered.
 * @param {State} state
 * @param {number} target
 * @returns Whether a 5cm was performed or not.
 */
export function interpret_5cm(state, target) {
	logger.info('interpreting potential 5cm');
	const hand = state.hands[target];
	const chopIndex = find_chop(hand);

	// Find the oldest 5 clued and its distance from chop
	let distance_from_chop = 0;
	for (let i = chopIndex; i >= 0; i--) {
		const card = hand[i];

		// Skip previously clued cards
		if (card.clued && !card.newly_clued) {
			continue;
		}

		// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
		// TODO: Asymmetric 5cm - If we aren't the target, we can see the card being chop moved
		// However, this requires that there is some kind of finesse/prompt to prove it is not 5cm
		if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
			if (distance_from_chop === 1) {
				logger.info(`5cm, saving ${Utils.logCard(state.hands[target][chopIndex])}`);
				state.hands[target][chopIndex].chop_moved = true;
				return true;
			}
			else {
				logger.info(`rightmost 5 was clued ${distance_from_chop} away from chop, not interpreting 5cm`);
				return false;
			}
		}
		distance_from_chop++;
	}
	return false;
}
