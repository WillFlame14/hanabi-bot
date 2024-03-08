import { playableAway } from '../../basics/hanabi-util.js';
import { all_valid_clues } from '../../basics/helper.js';
import { get_result } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../types.js').Clue} Clue
 */

/**
 * @param {State} state
 */
export function find_fix_clue(state) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const fix_needed = state.common.thinksPlayables(state, partner).filter(c => playableAway(state, c) !== 0);

	if (fix_needed.length === 0) {
		logger.info('no fix needed');
		return;
	}

	logger.info(`fix needed on [${fix_needed.map(logCard)}]`);

	const best_clue = Utils.maxOn(all_valid_clues(state, partner), clue => {
		const { hypo_state, value } = get_result(state, clue);
		const fixed = fix_needed.some(c => {
			const actual = hypo_state.hands[partner].findOrder(c.order);
			const card = hypo_state.common.thoughts[c.order];
			return card.inferred.has(actual) || card.inferred.length === 0 || card.reset;
		});

		if (fixed)
			logger.info('clue', logClue(clue), 'fixes with value', value);

		return fixed ? value : -9999;
	}, -9999);

	if (best_clue === undefined)
		logger.warn('Unable to find fix clue!');

	return best_clue;
}
