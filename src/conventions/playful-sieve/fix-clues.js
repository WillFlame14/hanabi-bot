import { CLUE } from '../../constants.js';
import { playableAway } from '../../basics/hanabi-util.js';
import { get_result } from './action-helper.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../types.js').Clue} Clue
 */

/**
 * @param {State} state
 */
export function find_fix_clue(state) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];

	const fix_needed = partner_hand.find_playables().filter(c => playableAway(state, c.suitIndex, c.rank) !== 0);

	if (fix_needed.length === 0) {
		logger.info('no fix needed');
		return;
	}

	logger.info(`fix needed on [${fix_needed.map(c => logCard(c))}]`);

	const clues = [];

	/** @type {Clue} */
	let best_clue;
	let best_clue_value = -10;

	for (let rank = 1; rank <= 5; rank++) {
		const clue = { type: CLUE.RANK, value: rank, target: partner };
		clues.push(clue);
	}

	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		const clue = { type: CLUE.COLOUR, value: suitIndex, target: partner };
		clues.push(clue);
	}

	for (const clue of clues) {
		const touch = partner_hand.clueTouched(clue);

		// Can't give empty clues
		if (touch.length === 0) {
			continue;
		}

		const { hypo_state, value } = get_result(state, clue);
		const fixed = fix_needed.some(c => {
			const card = hypo_state.hands[partner].findOrder(c.order);
			return card.matches_inferences() || card.inferred.length === 0;
		});

		if (fixed) {
			logger.info('clue', logClue(clue), 'fixes with value', value);
		}

		if (fixed && value > best_clue_value) {
			best_clue = clue;
			best_clue_value = value;
		}
	}
	return best_clue;
}
