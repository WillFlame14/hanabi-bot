import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { team_elim, update_hypo_stacks } from '../../basics/helper.js';
import { order_1s } from './action-helper.js';

import * as Basics from '../../basics.js';
import logger from '../../tools/logger.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * @param  {State} state
 * @param  {PlayAction} action
 */
function check_ocm(state, action) {
	const { order, playerIndex } = action;
	const card = state.common.thoughts[order];

	// Played an unknown 1
	if (card.clues.length > 0 &&
		card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1) &&
		(card.inferred.length > 1 || card.rewinded)
	) {
		const ordered_1s = order_1s(state, state.common, state.hands[playerIndex]);

		const offset = ordered_1s.findIndex(c => c.order === order);
		// Didn't play the 1 in the correct order
		if (offset !== 0) {
			const target = (playerIndex + offset) % state.numPlayers;

			// Just going to assume no double order chop moves in 3p
			if (target !== playerIndex) {
				const chop = state.common.chop(state.hands[target]);

				if (chop === undefined) {
					logger.warn(`attempted to interpret ocm on ${state.playerNames[target]}, but they have no chop`);
				}
				else {
					state.common.thoughts[chop.order].chop_moved = true;
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
	const { playerIndex, order, suitIndex, rank } = action;
	const identity = { suitIndex, rank };

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex) {
		const card = state.common.thoughts[order];
		if ((card.inferred.length !== 1 || !card.inferred[0].matches(identity)) && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			if (state.rewind(card.drawn_index, { type: 'identify', order, playerIndex, suitIndex, rank })) {
				return;
			}
		}
	}

	if (state.level >= LEVEL.BASIC_CM && rank === 1) {
		check_ocm(state, action);
	}

	Basics.onPlay(this, action);

	state.common.good_touch_elim(state);
	team_elim(state);

	for (const player of state.allPlayers) {
		player.refresh_links(state);
	}

	// Update hypo stacks
	update_hypo_stacks(this, this.common);
}
