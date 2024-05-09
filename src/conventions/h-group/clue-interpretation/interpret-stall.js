import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { CLUE_INTERP } from '../h-constants.js';
import { find_clue_value } from '../action-helper.js';
import { get_result } from '../clue-finder/determine-clue.js';
import { determine_focus, minimum_clue_value, stall_severity } from '../hanabi-logic.js';
import logger from '../../../tools/logger.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 */

/**
 * Returns whether a clue could be a stall or not, given the severity level.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} giver
 * @param {number} severity
 * @param {Game} prev_game
 */
function isStall(game, action, giver, severity, prev_game) {
	const { common, state } = game;
	const { clue, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list);
	const hand = state.hands[target];

	if (severity === 0)
		return;

	// 5 Stall given
	if (severity >= 1 && clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !common.thoughts[focused_card.order].chop_moved && !chop) {
		logger.info('5 stall!');
		return CLUE_INTERP.STALL_5;
	}

	const provisions = { touch: list.map(order => hand.findOrder(order)), list };
	const clue_result = get_result(prev_game, game, Object.assign({}, action.clue, { target }), giver, provisions);
	const { new_touched, playables, elim } = clue_result;

	if (severity >= 2) {
		// 5 Stall was available on someone other than giver
		// Note: target won't be able to tell if there was a 5 in their hand, but we could potentially prove it via a finesse
		if (state.hands.some((hand, index) => index !== giver && hand.some(c => c.rank === 5 && !c.clued))) {
			logger.info('5 stall was available but not given, so must not be stall');
			return;
		}

		// Fill-in given
		if (new_touched.length === 0 && elim > 0) {
			logger.info('fill in stall!');
			return CLUE_INTERP.STALL_FILLIN;
		}

		// Tempo clue given
		if (playables.length > 0 && find_clue_value(clue_result) < minimum_clue_value(state)) {
			logger.info('tempo clue stall! value', find_clue_value(clue_result));
			return CLUE_INTERP.STALL_TEMPO;
		}

		if (severity >= 3) {
			// Tempo clue was available
			/*if (play_clues.some(clues => clues.some(clue => clue.bad_touch < 2))) {
				logger.info('tempo was available but not given, so must not be stall');
				return false;
			}*/

			// Locked hand stall given, not touching slot 1
			if (chop && state.hands[target].findIndex(c => c.order === focused_card.order) !== 0) {
				logger.info('locked hand stall!');
				return CLUE_INTERP.STALL_LOCKED;
			}

			if (severity === 4) {
				// 8 clue save given
				if (state.clue_tokens === 7 && focused_card.newly_clued && !list.includes(state.hands[target][0].order)) {
					logger.info('8 clue stall!');
					return CLUE_INTERP.STALL_8CLUES;
				}
				// 8 clue save was available
			}
			// Locked hand stall was available
		}
		// Fill-in was available
	}

	// Hard burn given
	if (severity > 1 && new_touched.length === 0 && elim === 0) {
		logger.info('hard burn!');
		return CLUE_INTERP.STALL_BURN;
	}
}

/**
 * Returns whether the clue was given in a valid stalling situation.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Game} prev_game
 */
export function stalling_situation(game, action, prev_game) {
	const { giver } = action;
	const severity = stall_severity(prev_game.state, prev_game.common, giver);

	logger.info('severity', severity);

	const stall = isStall(game, action, giver, severity, prev_game);

	// Check at the very end - only if the conditions are right for a stall, then see if a play/save could have been given
	// TODO: Add this back in. For now, it's causing a large number of infinite loops and isn't even correct most of the time.
	if (stall !== undefined) {
		/*const { play_clues, save_clues } = find_clues(state, { ignorePlayerIndex: giver, ignoreCM: true });

		// There was a play (no bad touch, not tempo) or save available
		if (play_clues.some(clues => clues.some(clue => clue.bad_touch === 0 && clue.result.new_touched.length > 0)) ||
			save_clues.some(clue => clue !== undefined)
		) {
			logger.info('play or save available, not interpreting stall');
			return;
		}
		else {
			return stall;
		}*/

		// Only early game 5 stall exists before level 9
		if (game.level < LEVEL.STALLING && severity !== 1)
			logger.warn('stall found before level 9');

		return stall;
	}
}
