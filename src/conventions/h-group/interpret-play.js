import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { team_elim } from '../../basics/helper.js';
import { order_1s } from './action-helper.js';

import * as Basics from '../../basics.js';
import logger from '../../tools/logger.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * @param {Game} game
 * @param {PlayAction} action
 */
function check_ocm(game, action) {
	const { common, state } = game;
	const { order, playerIndex } = action;
	const card = common.thoughts[order];

	// Played an unknown 1
	if (card.clues.length > 0 &&
		card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1) &&
		(card.inferred.length > 1 || card.rewinded)
	) {
		const ordered_1s = order_1s(state, common, state.hands[playerIndex]);
		const offset = ordered_1s.findIndex(c => c.order === order);

		if (offset === 0) {
			logger.info('played unknown 1 in correct order, no ocm');
			return;
		}

		const target = (playerIndex + offset) % state.numPlayers;
		if (target === playerIndex) {
			// Just going to assume no double order chop moves in 3p
			logger.error('double order chop move???');
			return;
		}

		const chop = common.chop(state.hands[target]);
		if (chop === undefined) {
			logger.warn(`attempted to interpret ocm on ${state.playerNames[target]}, but they have no chop`);
			return;
		}

		common.thoughts[chop.order].chop_moved = true;
		logger.warn(`order chop move on ${state.playerNames[target]}, distance ${offset}`);
	}
}

/**
 * @param  {Game} game
 * @param  {PlayAction} action
 */
export function interpret_play(game, action) {
	const { common, state } = game;
	const { playerIndex, order, suitIndex, rank } = action;
	const identity = { suitIndex, rank };

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex) {
		const card = common.thoughts[order];
		if ((card.inferred.length !== 1 || !card.inferred.array[0].matches(identity)) && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			if (game.rewind(card.drawn_index, { type: 'identify', order, playerIndex, suitIndex, rank }))
				return;
		}
		// Possible self connections can be resolved.
		// TODO: Should only remove them if the card may not be queued behind other plays.
		for (const card of game.common.thoughts) {
			card.self_connection = false;
		}
	}

	if (common.thoughts[order].finessed)
		game.finesses_while_finessed[playerIndex] = [];

	if (game.level >= LEVEL.BASIC_CM && rank === 1)
		check_ocm(game, action);

	Basics.onPlay(this, action);

	common.good_touch_elim(state);
	common.update_hypo_stacks(state);
	team_elim(game);
}
