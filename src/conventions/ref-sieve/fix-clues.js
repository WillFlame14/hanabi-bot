import { get_result } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';

/**
 * @typedef {import('../ref-sieve.js').default} Game
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').ClueAction} ClueAction
 */

/**
 * @param {Game} game
 */
export function find_fix_clue(game) {
	const { state } = game;

	const partner = state.nextPlayerIndex(state.ourPlayerIndex);
	const fix_needed = game.players[partner].thinksPlayables(state, partner, { symmetric: true }).filter(o => !state.isPlayable(state.deck[o]));

	if (fix_needed.length === 0) {
		logger.info('no fix needed');
		return;
	}

	logger.info(`fix needed on [${fix_needed.map(o => logCard(state.deck[o]))}]`);

	const best_clue = Utils.maxOn(state.allValidClues(partner), clue => {
		const action = /** @type {ClueAction} */ (Utils.performToAction(state, Utils.clueToAction(clue, -1), state.ourPlayerIndex, state.deck));
		const hypo_game = game.simulate_clue(action);
		const value = get_result(game, hypo_game, action);

		const fixed = fix_needed.some(o => {
			const actual = hypo_game.state.deck[o];
			const card = hypo_game.common.thoughts[o];
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
