import { CLUE } from '../../../constants.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import { update_hypo_stacks } from '../../../basics/helper.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../basics/Card.js').Card} Card
 */

/**
 * Executes a Trash Chop Move on the target (i.e. writing notes). The clue must have already been registered.
 * @param {State} state
 * @param {number} target
 */
export function interpret_tcm(state, target) {
	let oldest_trash_index;
	// Find the oldest newly clued trash
	for (let i = state.hands[target].length - 1; i >= 0; i--) {
		const card = state.hands[target][i];

		if (card.newly_clued && state.common.thoughts[card.order].possible.every(c => isTrash(state, state.common, c, card.order))) {
			oldest_trash_index = i;
			break;
		}
	}

	logger.info(`oldest trash card is ${logCard(state.hands[target][oldest_trash_index])}`);

	const cm_cards = [];

	// Chop move every unclued card to the right of this
	for (let i = oldest_trash_index + 1; i < state.hands[target].length; i++) {
		const card = state.hands[target][i];

		if (!card.clued) {
			state.common.thoughts[card.order].chop_moved = true;
			cm_cards.push(logCard(card));
		}
	}
	logger.warn(cm_cards.length === 0 ? 'no cards to tcm' : `trash chop move on ${cm_cards.join(',')}`);
}

/**
 * Executes a 5's Chop Move on the target (i.e. writing notes), if valid. The clue must have already been registered.
 * @param {State} state
 * @param {number} target
 * @returns Whether a 5cm was performed or not.
 */
export function interpret_5cm(state, target) {
	logger.info('interpreting potential 5cm');
	const hand = state.hands[target];
	const chopIndex = state.common.chopIndex(hand);

	// Find the oldest 5 clued and its distance from chop
	let distance_from_chop = 0;
	for (let i = chopIndex; i >= 0; i--) {
		const card = hand[i];

		// Skip previously clued cards
		if (card.clued && !card.newly_clued)
			continue;

		// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
		// TODO: Asymmetric 5cm - If we aren't the target, we can see the card being chop moved
		// However, this requires that there is some kind of finesse/prompt to prove it is not 5cm
		if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
			if (distance_from_chop === 1) {
				const { order } = state.hands[target][chopIndex];
				const saved_card = state.common.thoughts[order];

				if (saved_card.possible.every(p => isTrash(state, state.common, p, order, { infer: true }))) {
					logger.info(`saved card ${logCard(saved_card)} has only trash possibilities, not 5cm`);
					return false;
				}

				logger.info(`5cm, saving ${logCard(saved_card)}`);
				saved_card.chop_moved = true;
				return true;
			}
			else {
				logger.info(`rightmost 5 was clued ${distance_from_chop} away from chop, not interpreting 5cm`);
				return false;
			}
		}
		distance_from_chop++;
	}
	return false;
}

/**
 * @param {State} state
 * @param {Player} oldCommon
 * @param {number} target
 * @param {number[]} list
 * @param {ActualCard} focused_card
 */
export function interpret_tccm(state, oldCommon, target, list, focused_card) {
	// Some hypo stacks went down, assume fix
	if (oldCommon.hypo_stacks.some((stack, index) => stack > state.common.hypo_stacks[index])) {
		logger.info(`hypo stacks went from ${oldCommon.hypo_stacks} to ${state.common.hypo_stacks}, not tccm`);
		return false;
	}

	const chop = state.common.chop(state.hands[target], { afterClue: true });
	const touched_cards = state.hands[target].filter(card => list.includes(card.order));
	const prompt = oldCommon.find_prompt(state.hands[target], focused_card, state.variant.suits);

	if (chop === undefined ||											// Target was locked
		touched_cards.some(card => card.newly_clued) ||					// At least one card touched was newly clued
		state.common.hypo_score !== oldCommon.hypo_score + 1 ||			// The new state does not have exactly 1 extra play
		(prompt && prompt.rank !== 5 && prompt.order !== focused_card.order)) {		// The card was not a 5 and not promptable
		return false;
	}

	// Check for double tempo clue
	if (list.length > 1) {
		const possibly_playable = touched_cards.filter(({ order }) => {
			const card = state.common.thoughts[order];
			return card.inferred.length > 1 &&
				card.inferred.some(i => i.rank === state.common.hypo_stacks[i.suitIndex] + 1);
		});

		if (possibly_playable.length > 0) {
			// All touched cards must be delayed playable
			for (const { order } of possibly_playable) {
				const card = state.common.thoughts[order];

				card.inferred = card.inferred.filter(inf => inf.rank === state.common.hypo_stacks[inf.suitIndex] + 1);
				update_hypo_stacks(state, state.common);
			}
			const slots = possibly_playable.map(c => state.hands[target].findIndex(card => card.order === c.order) + 1);
			logger.info(`multiple tempo clue on ${slots.length > 1 ? `slots [${slots.join(',')}]` : `slot ${slots[0]}`}`);
			return false;
		}
	}

	// Valid tempo clue chop move
	state.common.thoughts[chop.order].chop_moved = true;
	logger.info('tccm, chop moving', target === state.ourPlayerIndex ? `slot ${state.common.chopIndex(state.hands[target], { afterClue: true })}` : logCard(chop));
	return true;
}
