import { LEVEL } from './h-constants.js';
import { team_elim } from '../../basics/helper.js';
import { order_1s } from './action-helper.js';

import * as Basics from '../../basics.js';
import logger from '../../tools/logger.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../types.js').CardAction} CardAction
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * @param {Game} game
 * @param {CardAction} action
 * @returns The order of the chop moved card, or -1 if no card was chop moved.
 */
export function check_ocm(game, action) {
	const { common, state } = game;
	const { order, playerIndex } = action;

	const ordered_1s = order_1s(state, common, state.hands[playerIndex]);
	const offset = ordered_1s.findIndex(o => o === order);

	if (offset === -1)
		return -1;

	if (offset === 0) {
		logger.info('played unknown 1 in correct order, no ocm');
		return -1;
	}

	const target = (playerIndex + offset) % state.numPlayers;
	if (target === playerIndex) {
		// Just going to assume no double order chop moves in 3p
		logger.error('double order chop move???');
		return -1;
	}

	const chop = common.chop(state.hands[target]);
	if (chop === undefined) {
		logger.warn(`attempted to interpret ocm on ${state.playerNames[target]}, but they have no chop`);
		return -1;
	}

	logger.highlight('cyan', `order chop move on ${state.playerNames[target]}, distance ${offset}`);
	return chop;
}

/**
 * Impure!
 * @param  {Game} game
 * @param  {PlayAction} action
 */
export function interpret_play(game, action) {
	const { common, state } = game;
	const { playerIndex, order, suitIndex, rank } = action;
	const identity = { suitIndex, rank };

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex && suitIndex !== -1) {
		const card = common.thoughts[order];
		const need_rewind = card.inferred.length !== 1 || !card.inferred.array[0].matches(identity) || common.play_links.some(link => link.orders.includes(order));

		if (need_rewind && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			const new_game = game.rewind(card.drawn_index, [{ type: 'identify', order, playerIndex, identities: [identity] }]);
			if (new_game) {
				Object.assign(game, new_game);
				return;
			}
		}
	}

	if (common.thoughts[order].finessed)
		game.finesses_while_finessed[playerIndex] = [];

	if (game.level >= LEVEL.BASIC_CM && rank === 1) {
		const ocm_order = check_ocm(game, action);

		if (ocm_order !== -1)
			common.updateThoughts(ocm_order, (draft) => { draft.chop_moved = true; });
	}

	Basics.onPlay(this, action);

	common.good_touch_elim(state);
	common.update_hypo_stacks(state);
	team_elim(game);

	if (playerIndex === state.ourPlayerIndex) {
		for (const order of state.ourHand) {
			if (common.thoughts[order].uncertain)
				common.updateThoughts(order, (draft) => { draft.uncertain = false; });
		}
	}
}
