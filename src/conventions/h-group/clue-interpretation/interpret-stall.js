import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { CLUE_INTERP } from '../h-constants.js';
import { find_clue_value } from '../action-helper.js';
import { get_result } from '../clue-finder/determine-clue.js';
import { determine_focus, minimum_clue_value, stall_severity } from '../hanabi-logic.js';
import { find_clues } from '../clue-finder/clue-finder.js';

import logger from '../../../tools/logger.js';
import { logClue } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 */

const stall_to_severity = {
	[CLUE_INTERP.STALL_5]: 0,
	[CLUE_INTERP.STALL_TEMPO]: 1,
	[CLUE_INTERP.STALL_FILLIN]: 2,
	[CLUE_INTERP.STALL_LOCKED]: 2,
	[CLUE_INTERP.STALL_8CLUES]: 2,
	[CLUE_INTERP.STALL_BURN]: 5
};

/**
 * Returns whether a clue could be a stall or not, given the severity level.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} giver
 * @param {number} severity
 * @param {Game} prev_game
 */
function isStall(game, action, giver, severity, prev_game) {
	const { common, me, state } = game;
	const { clue, list, target } = action;
	const { focused_card, chop } = determine_focus(game, state.hands[target], common, list, clue);
	const focus_thoughts = common.thoughts[focused_card.order];
	const hand = state.hands[target];

	if (severity === 0)
		return;

	const trash = target !== state.ourPlayerIndex ?
		state.isBasicTrash(focused_card) :
		me.thoughts[focused_card.order].possible.every(c => state.isBasicTrash(c));

	if (trash && focused_card.newly_clued)
		return;

	// 5 Stall given
	if (severity >= 1 && clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !focus_thoughts.chop_moved && !chop) {
		logger.info('5 stall!');
		return CLUE_INTERP.STALL_5;
	}

	const provisions = { touch: list.map(order => hand.findOrder(order)), list };
	const clue_result = get_result(prev_game, game, Object.assign({}, action.clue, { target }), giver, provisions);
	const { new_touched, playables, elim } = clue_result;

	if (severity >= 2) {
		// Fill-in given
		if (new_touched.length === 0 && elim > 0) {
			logger.info('fill in stall!');
			return CLUE_INTERP.STALL_FILLIN;
		}

		// Tempo clue given
		if (playables.length > 0 && find_clue_value(clue_result) < minimum_clue_value(state)) {
			logger.info('tempo clue stall! value', find_clue_value(clue_result), playables.map(p => p.card.order));
			return CLUE_INTERP.STALL_TEMPO;
		}

		if (severity >= 3) {
			// Locked hand stall given, not touching slot 1 and not locked
			if (chop && state.hands[target].findIndex(c => c.order === focused_card.order) !== 0 && !common.thinksLocked(state, target)) {
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
 * @param {Game} _game
 * @param {Clue} clue
 * @param {typeof CLUE_INTERP[keyof typeof CLUE_INTERP]} interp
 */
function expected_clue(_game, clue, interp) {
	switch(interp) {
		case CLUE_INTERP.PLAY:
			return clue.result.playables.some(({ card }) => card.newly_clued) && clue.result.bad_touch === 0;

		case CLUE_INTERP.SAVE: {
			const save_clue = /** @type {SaveClue} */(clue);
			return save_clue.cm === undefined || save_clue.cm.length === 0;
		}

		default:
			return false;
	}
}

/**
 * Returns whether the clue was given in a valid stalling situation.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Game} prev_game
 */
export function stalling_situation(game, action, prev_game) {
	const { common, state, me } = game;
	const { clue, giver, list, target, noRecurse } = action;

	const { focused_card } = determine_focus(game, state.hands[target], common, list, clue);
	const severity = stall_severity(prev_game.state, prev_game.common, giver);

	logger.info('severity', severity);

	const stall = isStall(game, action, giver, severity, prev_game);

	if (stall === undefined)
		return;

	if (noRecurse)
		return stall;

	const options = { giver, hypothetical: true, no_fix: true, noRecurse: true, early_exits: expected_clue };

	logger.collect();
	const { play_clues, save_clues, stall_clues } = find_clues(prev_game, options);
	logger.flush(false);

	const expected_play = () => play_clues.flat().find(cl =>
		cl.result.playables.some(({ card }) => card.newly_clued) && cl.result.bad_touch === 0 && focused_card.order !== cl.result.focus);

	const expected_save = () => save_clues.find((cl, target) => {
		if (cl === undefined || cl.cm?.length > 0 || focused_card.order === cl.result.focus)
			return false;

		const chop = common.chop(state.hands[target]);

		// Not a 2 save that could be duplicated in our hand
		return !(cl.type === CLUE.RANK && cl.value === 2 && state.ourHand.some(c => me.thoughts[c.order].possible.has(chop)));
	});

	const expected_stall = () => stall_clues.slice(0, stall_to_severity[stall]).find(clues => clues.some(cl => focused_card.order !== cl.result.focus))?.[0];

	const expected = expected_play() ?? expected_save() ?? expected_stall();

	if (expected !== undefined) {
		logger.highlight('yellow', `expected ${logClue(expected)}, not interpreting stall`);
		return;
	}

	// Only early game 5 stall exists before level 9
	if (game.level < LEVEL.STALLING && severity !== 1)
		logger.warn('stall found before level 9');
	else
		logger.highlight('yellow', 'valid stall!');

	return stall;
}
