import { CLUE } from '../../../constants.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';
import { update_hypo_stacks } from '../../../basics/helper.js';

/**
 * @typedef {import('../../h-group.js').default} State
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

		if (card.newly_clued && card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank, card.order))) {
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
			card.chop_moved = true;
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
	const chopIndex = hand.chopIndex();

	// Find the oldest 5 clued and its distance from chop
	let distance_from_chop = 0;
	for (let i = chopIndex; i >= 0; i--) {
		const card = hand[i];

		// Skip previously clued cards
		if (card.clued && !card.newly_clued) {
			continue;
		}

		// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
		// TODO: Asymmetric 5cm - If we aren't the target, we can see the card being chop moved
		// However, this requires that there is some kind of finesse/prompt to prove it is not 5cm
		if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
			if (distance_from_chop === 1) {
				const saved_card = state.hands[target][chopIndex];

				if (saved_card.possible.every(p => isTrash(state, target, p.suitIndex, p.rank, saved_card.order))) {
					logger.info(`saved card ${logCard(saved_card)} has only trash possibilities, not 5cm`);
					return false;
				}

				logger.info(`5cm, saving ${logCard(saved_card)}`);
				state.hands[target][chopIndex].chop_moved = true;
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
 * @param {State} old_state
 * @param {number} giver
 * @param {number} target
 * @param {number[]} list
 * @param {Card} focused_card
 */
export function interpret_tccm(state, old_state, giver, target, list, focused_card) {
	// Some hypo stacks went down, assume fix
	if (old_state.hypo_stacks[giver].some((stack, index) => stack > state.hypo_stacks[giver][index])) {
		logger.info(`hypo stacks went from ${old_state.hypo_stacks[giver]} to ${state.hypo_stacks[giver]}, not tccm`);
		return false;
	}

	const chop = state.hands[target].chop({ afterClue: true });

	// Target was locked
	if (chop === undefined) {
		logger.info('target locked, not tccm');
		return false;
	}

	const touched_cards = state.hands[target].filter(card => list.includes(card.order));

	// At least one card touched was newly clued
	if (touched_cards.some(card => card.newly_clued)) {
		logger.info('at least one newly touched, not tccm');
		return false;
	}

	/**
	 * @param {State} state
	 */
	function sum_plays(state) {
		return state.hypo_stacks[giver].reduce((sum, curr) => sum + curr, 0) + state.unknown_plays[giver].length;
	}

	// The new state does not have exactly 1 extra play
	if (sum_plays(state) !== sum_plays(old_state) + 1) {
		logger.info(`sum_plays was ${sum_plays(state)} whereas old_plays was ${sum_plays(old_state) + 1}, not tccm`);
		return false;
	}

	// The card was not a 5 and not promptable (valuable)
	const prompt = old_state.hands[target].find_prompt(focused_card.suitIndex, focused_card.rank, state.suits);
	if (prompt && prompt.rank !== 5 && prompt.order !== focused_card.order) {
		logger.info('targeted a out-of-order card not a 5, not tccm');
		return false;
	}

	// Check for double tempo clue
	if (list.length > 1) {
		const possibly_playable = touched_cards.filter(card =>
			card.inferred.length > 1 &&
			card.inferred.some(i => i.rank === state.hypo_stacks[target][i.suitIndex] + 1));

		if (possibly_playable.length > 0) {
			// All touched cards must be delayed playable
			for (const card of possibly_playable) {
				card.inferred = card.inferred.filter(inf => inf.rank === state.hypo_stacks[target][inf.suitIndex] + 1);
				update_hypo_stacks(state);
			}
			const slots = possibly_playable.map(c => state.hands[target].findIndex(card => card.order === c.order) + 1);
			logger.info(`multiple tempo clue on ${slots.length > 1 ? `slots [${slots.join(',')}]` : `slot ${slots[0]}`}`);
			return false;
		}
	}

	// Valid tempo clue chop move
	chop.chop_moved = true;
	logger.info('tccm, chop moving', target === state.ourPlayerIndex ? `slot ${state.hands[target].chopIndex({ afterClue: true })}` : logCard(chop));
	return true;
}
