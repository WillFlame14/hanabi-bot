import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { find_chop } from './hanabi-logic.js';
import { good_touch_elim, update_hypo_stacks } from '../../basics/helper.js';
import { order_1s } from './action-helper.js';
import logger from '../../logger.js';
import * as Basics from '../../basics.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * @param  {State} state
 * @param  {PlayAction} action
 */
function check_ocm(state, action) {
	const { order, playerIndex } = action;
	const card = state.hands[playerIndex].findOrder(order);

	// Played an unknown 1
	if (card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1) && (card.inferred.length > 1 || card.rewinded)) {
		const ordered_1s = order_1s(state, state.hands[playerIndex]);

		const offset = ordered_1s.findIndex(c => c.order === card.order);
		// Didn't play the 1 in the correct order
		if (offset !== 0) {
			const target = (playerIndex + offset) % state.numPlayers;

			// Just going to assume no double order chop moves in 3p
			if (target !== playerIndex) {
				const target_hand = state.hands[target];
				const chopIndex = find_chop(target_hand);

				if (chopIndex === -1) {
					logger.warn(`attempted to interpret ocm on ${state.playerNames[target]}, but they have no chop`);
				}
				else {
					target_hand[chopIndex].chop_moved = true;
					logger.warn(`order chop move on ${state.playerNames[target]}, distance ${offset}`);
				}
			}
			else {
				logger.error('double order chop move???');
			}
		}
		else {
			logger.info('played unknown 1 in correct order, no ocm');
		}
	}
}

/**
 * @param  {State} state
 * @param  {PlayAction} action
 */
export function interpret_play(state, action) {
	const { playerIndex, order, rank, suitIndex } = action;

	// Now that we know about this card, rewind from the beginning
	if (playerIndex === state.ourPlayerIndex) {
		const card = state.hands[playerIndex].findOrder(order);
		const action_index = card.reasoning[0];
		if (!card.rewinded && action_index !== undefined) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			if (state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank })) {
				return;
			}
		}
	}

	if (state.level >= LEVEL.BASIC_CM && rank === 1) {
		check_ocm(state, action);
	}

	Basics.onPlay(this, action);

	// Apply good touch principle on remaining possibilities
	for (const hand of this.hands) {
		good_touch_elim(hand, [{suitIndex, rank}], { hard: true });
	}

	// Update hypo stacks
	update_hypo_stacks(this);
}
