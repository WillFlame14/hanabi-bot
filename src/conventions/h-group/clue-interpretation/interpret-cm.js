import { CLUE } from '../../../constants.js';
import { isTrash } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').BaseClue} BaseClue
 */

/**
 * Checks whether a Trash Chop Move was performed on the target. The clue must have already been registered.
 * @param {Game} game
 * @param {number} target
 * @param {number} focus_order
 * @returns The orders of any chop moved cards.
 */
export function interpret_tcm(game, target, focus_order) {
	const { common, state } = game;
	const focused_card = state.deck[focus_order];
	const focus_thoughts = common.thoughts[focus_order];

	if (!focused_card.newly_clued ||
		focus_thoughts.possible.some(c => !isTrash(state, common, c, focus_order, { infer: true })) ||
		focus_thoughts.inferred.every(i => state.isPlayable(i) && !isTrash(state, common, i, focus_order, { infer: true })))
		return [];

	const oldest_trash_index = state.hands[target].findLastIndex(o =>
		state.deck[o].newly_clued && common.thoughts[o].possible.every(c => isTrash(state, common, c, o, { infer: true })));

	logger.info(`oldest trash card is ${logCard(state.deck[state.hands[target][oldest_trash_index]])}`);

	const cm_orders = [];

	// Chop move every unclued card to the right of this
	for (let i = oldest_trash_index + 1; i < state.hands[target].length; i++) {
		const order = state.hands[target][i];

		if (!state.deck[order].clued && !common.thoughts[order].chop_moved)
			cm_orders.push(order);
	}

	logger.highlight('cyan', cm_orders.length === 0 ? 'no cards to tcm' : `trash chop move on ${cm_orders.map(o => logCard(state.deck[o])).join(',')}`);
	return cm_orders;
}

/**
 * Checks whether a 5's Chop Move was performed. The clue must have already been registered.
 * @param {Game} game
 * @param {number} target
 * @param {number} focus_order
 * @param {BaseClue} clue
 * @returns The orders of any chop moved cards.
 */
export function interpret_5cm(game, target, focus_order, clue) {
	const { common, state } = game;
	const focused_card = state.deck[focus_order];

	// 5cm can't be done in early game for now
	if (clue.type !== CLUE.RANK || clue.value !== 5 || !focused_card.newly_clued || state.early_game)
		return [];

	logger.info('interpreting potential 5cm');
	const hand = state.hands[target];
	const chopIndex = common.chopIndex(hand);

	// Find the oldest 5 clued and its distance from chop
	let distance_from_chop = 0;
	for (let i = chopIndex; i >= 0; i--) {
		const card = state.deck[hand[i]];

		// Skip previously clued cards
		if (card.clued && !card.newly_clued)
			continue;

		// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
		// TODO: Asymmetric 5cm - If we aren't the target, we can see the card being chop moved
		// However, this requires that there is some kind of finesse/prompt to prove it is not 5cm
		if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
			if (distance_from_chop === 1) {
				const order = state.hands[target][chopIndex];
				const saved_card = common.thoughts[order];

				if (saved_card.possible.every(p => isTrash(state, common, p, order, { infer: true }))) {
					logger.info(`saved card ${logCard(saved_card)} has only trash possibilities, not 5cm`);
					return [];
				}

				logger.info(`5cm, saving ${logCard(saved_card)}`);
				return [order];
			}
			else {
				logger.info(`rightmost 5 was clued ${distance_from_chop} away from chop, not interpreting 5cm`);
				return [];
			}
		}
		distance_from_chop++;
	}
	return [];
}

/**
 * Checks whether a Tempo Clue Chop Move was performed. The clue must have already been registered.
 * @param {Game} game
 * @param {Player} oldCommon
 * @param {number} target
 * @param {number[]} list
 * @param {ActualCard} focused_card
 * @returns The orders of any chop moved cards.
 */
export function interpret_tccm(game, oldCommon, target, list, focused_card) {
	const { common, state } = game;

	logger.info('checking tccm: old score', oldCommon.hypo_stacks, oldCommon.unknown_plays, 'new score', common.hypo_stacks, common.unknown_plays);

	// Some hypo stacks went down, assume fix
	if (oldCommon.hypo_stacks.some((stack, index) => stack > common.hypo_stacks[index])) {
		logger.info(`hypo stacks went down, not tccm`);
		return [];
	}

	const chop = common.chop(state.hands[target], { afterClue: true });

	if (chop === undefined) {
		logger.info('target was locked, not tccm');
		return [];
	}

	if (list.some(o => state.deck[o].newly_clued)) {
		logger.info('touched at least 1 new card, not tccm');
		return [];
	}

	if (common.hypo_score !== oldCommon.hypo_score + 1) {
		logger.info('new score is not 1 exactly more than old score, not tccm');
		return [];
	}

	const id = focused_card.identity();

	if (id !== undefined && common.hypo_stacks[id.suitIndex] < id.rank) {
		logger.info('focused card did not become playable, not tccm');
		return [];
	}

	const focus_thoughts = common.thoughts[focused_card.order];
	const not_promptable = focus_thoughts.inferred.every(i => {
		const prompt = oldCommon.find_prompt(state, target, i);
		return prompt !== undefined && prompt !== focused_card.order;
	});
	const identity = focus_thoughts.identity({ infer: true });

	if (not_promptable && (identity === undefined || identity.rank !== 5)) {
		logger.info(`tempo on non-promptable non-5, not tccm`);
		return [];
	}

	// Check for double tempo clue
	/* if (list.length > 1) {
		const possibly_playable = touched_cards.filter(({ order }) => {
			const card = common.thoughts[order];
			return card.inferred.length > 1 &&
				card.inferred.some(i => i.rank === common.hypo_stacks[i.suitIndex] + 1);
		});

		if (possibly_playable.length > 0) {
			// All touched cards must be delayed playable
			for (const { order } of possibly_playable) {
				const card = common.thoughts[order];
				const playable_identities = card.inferred.filter(inf => inf.rank === common.hypo_stacks[inf.suitIndex] + 1);

				card.inferred = IdentitySet.create(state.variant.suits.length, playable_identities);
				common.update_hypo_stacks(state);
			}
			const slots = possibly_playable.map(c => state.hands[target].findIndex(card => card.order === c.order) + 1);
			logger.info(`multiple tempo clue on ${slots.length > 1 ? `slots [${slots.join(',')}]` : `slot ${slots[0]}`}`);
			return [];
		}
	} */

	if (state.hands.some(hand => hand.some(o => !oldCommon.thoughts[o].finessed && common.thoughts[o].finessed))) {
		logger.info('caused finesse, not tccm');
		return [];
	}

	logger.info('tccm, chop moving', target === state.ourPlayerIndex ? `slot ${state.hands[target].findIndex(o => o === chop) + 1}` : logCard(state.deck[chop]));
	return [chop];
}

/**
 * Updates thoughts after a chop move.
 * 
 * Impure! (modifies player)
 * @param {State} state
 * @param {Player} player
 * @param {number[]} cm_orders
 */
export function perform_cm(state, player, cm_orders) {
	for (const order of cm_orders) {
		const { inferred } = player.thoughts[order];
		player.updateThoughts(order, (draft) => {
			// Remove all commonly trash identities
			draft.inferred = inferred.subtract(inferred.filter(i => isTrash(state, player, i, order, { infer: true })));
			draft.chop_moved = true;
		});
	}
}
