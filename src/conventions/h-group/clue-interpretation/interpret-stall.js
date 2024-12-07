import { CLUE } from '../../../constants.js';
import { LEVEL, STALL_INDICES } from '../h-constants.js';
import { CLUE_INTERP } from '../h-constants.js';
import { find_clue_value } from '../action-helper.js';
import { get_result } from '../clue-finder/determine-clue.js';
import { colour_save, rank_save } from './focus-possible.js';
import { minimum_clue_value, stall_severity } from '../hanabi-logic.js';
import { find_expected_clue } from '../clue-finder/clue-finder.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logClue } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').BaseClue} BaseClue
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').FocusResult} FocusResult
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
 * @param {FocusResult} focusResult
 * @param {number} severity
 * @param {Game} prev_game
 */
function isStall(game, action, focusResult, severity, prev_game) {
	const { common, me, state } = game;
	const { clue, giver, list, target } = action;
	const { focus, chop } = focusResult;
	const focus_thoughts = common.thoughts[focus];
	const focused_card = state.deck[focus];

	if (severity === 0)
		return;

	// We are giving a save clue, not a stall
	if (chop && giver === state.ourPlayerIndex && (clue.type === CLUE.COLOUR ? colour_save : rank_save)(game, state.deck[focus], action, focus))
		return;

	const trash = target !== state.ourPlayerIndex ?
		state.isBasicTrash(focused_card) :
		me.thoughts[focus].possible.every(c => state.isBasicTrash(c));

	if (trash && focused_card.newly_clued)
		return;

	// 5 Stall given
	if (severity >= 1 && clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !focus_thoughts.chop_moved && !chop) {
		logger.info('5 stall!');
		return CLUE_INTERP.STALL_5;
	}

	const clue_result = get_result(prev_game, game, Object.assign({}, action, { clue: Object.assign({}, clue, { target }), hypothetical: true }), { list });
	const { new_touched, playables, elim } = clue_result;

	if (severity >= 2) {
		// Tempo clue given
		if (new_touched.length === 0 && playables.length > 0 && find_clue_value(clue_result) < minimum_clue_value(state)) {
			logger.info('tempo clue stall! value', find_clue_value(clue_result), playables.map(p => p.card.order));
			return CLUE_INTERP.STALL_TEMPO;
		}

		// Fill-in given
		if (new_touched.length === 0 && elim > 0) {
			logger.info('fill in stall!');
			return CLUE_INTERP.STALL_FILLIN;
		}

		if (severity >= 3) {
			// Locked hand stall given, not touching slot 1 and not locked
			if (chop && !list.includes(state.hands[target][0]) && !common.thinksLocked(state, target)) {
				logger.info('locked hand stall!');
				return CLUE_INTERP.STALL_LOCKED;
			}

			if (severity === 4) {
				// 8 clue save given
				if (state.clue_tokens === 7 && focused_card.newly_clued && !list.includes(state.hands[target][0])) {
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
 * @param {Game} game
 * @param {number} giver
 * @param {number} focus
 * @param {number} max_stall
 * @param {BaseClue} original_clue
 */
function other_expected_clue(game, giver, focus, max_stall, original_clue) {
	const { state } = game;
	const thinks_stall = new Set(Utils.range(0, state.numPlayers));

	/**
	 * @param {Game} _game
	 * @param {Clue} _clue
	 * @param {{result: ClueResult, interp: typeof CLUE_INTERP[keyof typeof CLUE_INTERP]}} res
	 */
	const satisfied = (_game, _clue, { result, interp }) => {
		switch (interp) {
			case CLUE_INTERP.CM_TEMPO:
			case CLUE_INTERP.STALL_TEMPO:
			case CLUE_INTERP.STALL_FILLIN:
			case CLUE_INTERP.STALL_LOCKED:
			case CLUE_INTERP.STALL_8CLUES:
			case CLUE_INTERP.STALL_BURN:
				logger.info(interp, STALL_INDICES[interp], max_stall, focus, result.focus, STALL_INDICES[interp] < max_stall);
				return STALL_INDICES[interp] < max_stall;

			default:
				return false;
		}
	};

	/** @param {Clue} clue */
	const excludeClue = (clue) =>
		thinks_stall.size === 0 || (clue.type === original_clue.type && clue.value === original_clue.value);

	for (const { clue, res } of find_expected_clue(game, giver, satisfied, excludeClue)) {
		logger.highlight('yellow', `expected ${logClue(clue)}, not interpreting stall`);

		const new_wc = res.hypo_game.common.waiting_connections.find(wc => wc.turn === state.turn_count);

		// Everyone not the target (or with an unknown connection) can see this clue
		for (let i = 0; i < state.numPlayers; i++) {
			if (i === clue.target || new_wc?.connections.some(conn => conn.type !== 'known' && state.hands[i].includes(conn.order)))
				continue;

			thinks_stall.delete(i);
		}
	}
	return thinks_stall;
}

/**
 * Returns whether the clue was given in a valid stalling situation.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {FocusResult} focusResult
 * @param {Game} prev_game
 */
export function stalling_situation(game, action, focusResult, prev_game) {
	const { common, state } = game;
	const { giver, clue, noRecurse } = action;
	const { focus } = focusResult;

	const severity = stall_severity(prev_game.state, prev_game.common, giver);

	logger.info('severity', severity);

	const stall = isStall(game, action, focusResult, severity, prev_game);

	if (stall === undefined || common.thinksLoaded(state, giver, { assume: false }))
		return { stall, thinks_stall: new Set() };

	if (noRecurse)
		return { stall, thinks_stall: new Set(Utils.range(0, state.numPlayers)) };

	const thinks_stall = other_expected_clue(game, giver, focus, stall_to_severity[stall], clue);

	// Only early game 5 stall exists before level 9
	if (game.level < LEVEL.STALLING && severity !== 1)
		logger.warn('stall found before level 9');
	else if (thinks_stall.size === state.numPlayers)
		logger.highlight('yellow', 'valid stall!');
	else
		logger.highlight('yellow', `looks stall to ${Array.from(thinks_stall).map(i => state.playerNames[i]).join()}`);

	return { stall, thinks_stall };
}
