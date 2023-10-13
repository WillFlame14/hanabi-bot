import { CLUE } from '../../constants.js';
import { Hand } from '../../basics/Hand.js';
import { elim_result, playables_result } from '../../basics/clue-result.js';
import { cardValue, isTrash, refer_right } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
export function get_result(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const touch = state.hands[partner].clueTouched(clue, state.suits);

	if (touch.length === 0) {
		throw new Error(`Tried to get a result with a clue ${logClue(clue)} that touches no cards!`);
	}
	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target: partner, list: touch.map(c => c.order), clue });
	const bad_touch = touch.filter(card => !card.clued && isTrash(hypo_state, state.ourPlayerIndex, card, card.order));
	const trash = bad_touch.filter(card => card.possible.every(p => isTrash(hypo_state, partner, p, card.order)));

	const { new_touched, fill, elim } = elim_result(state, hypo_state, partner, touch.map(c => c.order));
	const revealed_trash = Hand.find_known_trash(hypo_state, partner);
	const { safe_playables: playables } = playables_result(state, hypo_state, state.ourPlayerIndex);

	const good_touch = new_touched - (bad_touch.length - trash.length);

	const value = 0.25*good_touch +
		playables.length +
		0.5*revealed_trash.length +
		0.25*fill +
		0.05*elim -
		0.1*bad_touch.length;

	logger.info(logClue(clue), value, good_touch, playables.length, revealed_trash.length, fill, elim, bad_touch.length);

	return { hypo_state, value, referential: playables.length === 0 && revealed_trash.length === 0 };
}

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
export function clue_value(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];
	const touch = partner_hand.clueTouched(clue, state.suits);

	if (touch.length === 0) {
		return -1;
	}

	const result = get_result(state, clue);
	const { hypo_state, referential } = result;
	let value = result.value;

	if (referential) {
		const newly_touched = Utils.findIndices(hypo_state.hands[partner], card => card.newly_clued);

		if (clue.type === CLUE.RANK) {
			const get_target_index = () => {
				if (newly_touched.length === 0) {
					// Fill in with no playables (discard chop)
					return 0;
				}

				const referred = newly_touched.map(index =>
					Math.max(0, Utils.nextIndex(hypo_state.hands[partner], (card) => !card.clued, index)));
				return referred.reduce((min, curr) => Math.min(min, curr));
			};

			const target_index = get_target_index();
			const dc_value = cardValue(state, partner_hand[target_index]);

			logger.info('targeting slot', target_index + 1, logCard(partner_hand[target_index]), 'for discard with clue', clue.value, 'and value', dc_value, (3.5 - dc_value) / 3.5);
			if (dc_value >= 4) {
				logger.warn('high value card, skipping');
				return -1;
			}

			value += (3.5 - dc_value) / 3.5;
		}
		else {
			const newly_touched = Utils.findIndices(partner_hand, card => touch.some(c => c.order === card.order) && !card.clued);
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(partner_hand, index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Referential play on chop is not a play
				if (target_index === 0) {
					return -2;
				}

				const target_card = partner_hand[target_index];

				// Target card is not delayed playable
				if (state.hypo_stacks[state.ourPlayerIndex][target_card.suitIndex] + 1 !== target_card.rank) {
					return -1;
				}
				return 10;
			}
			// Fill in with no playables (discard chop)
			else {
				value += (3.5 - cardValue(state, partner_hand[0])) / 3.5;
			}
		}
	}
	return value;
}
