import { CLUE, HAND_SIZE } from '../constants.js';
import { cardTouched } from '../variants.js';
import { visibleFind } from './hanabi-util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../variants.js').Variant} Variant
 */

/**
 * @param {string[]} suits
 */
export function all_identities(suits) {
	const identities = [];

	for (let suitIndex = 0; suitIndex < suits.length; suitIndex++) {
		for (let rank = 1; rank <= 5; rank++)
			identities.push({ suitIndex, rank });
	}
	return identities;
}

/**
 * @param {BaseClue} clue
 * @param {Variant} variant
 */
export function find_possibilities(clue, variant) {
	return all_identities(variant.suits).filter(id => cardTouched(id, variant, clue));
}

/**
 * @param {State} state
 * @param {number} target
 */
export function all_valid_clues(state, target) {
	const hand = state.hands[target];
	const clues = /** @type {Clue[]} */ ([]);

	for (let rank = 1; rank <= 5; rank++)
		clues.push({ type: CLUE.RANK, value: rank, target });

	for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++)
		clues.push({ type: CLUE.COLOUR, value: suitIndex, target });

	return clues.filter(clue => hand.clueTouched(clue, state.variant).length > 0);
}

/**
 * @param {State} state
 * @param {Player} player
 * 
 * Updates the hypo stacks for all players.
 */
export function update_hypo_stacks(state, player) {
	// Reset hypo stacks to play stacks
	const hypo_stacks = state.play_stacks.slice();
	const unknown_plays = new Set();

	let found_new_playable = true;
	const good_touch_elim = /** @type {BasicCard[]}*/ ([]);

	const linked_orders = player.linkedOrders(state);

	// Attempt to play all playable cards
	while (found_new_playable) {
		found_new_playable = false;

		for (const { order } of state.hands.flat()) {
			const card = player.thoughts[order];

			if (!card.saved || good_touch_elim.some(e => e.matches(card)) || linked_orders.has(order))
				continue;

			/**
			 * Checks if all possibilities have been either eliminated by good touch or are playable (but not all eliminated).
			 * @param {BasicCard[]} poss
			 */
			const delayed_playable = (poss) => {
				const remaining_poss = poss.filter(c => !good_touch_elim.some(e => e.matches(c)));
				return remaining_poss.length > 0 && remaining_poss.every(c => hypo_stacks[c.suitIndex] + 1 === c.rank);
			};

			const fake_wcs = player.waiting_connections.filter(wc => {
				const { fake, focused_card, inference } = wc;
				return focused_card.order === order && (fake || !state.me.thoughts[focused_card.order].matches(inference, { assume: true }));
			});

			// Ignore all waiting connections that will be proven wrong
			const diff = card.clone();
			diff.subtract('inferred', fake_wcs.flatMap(wc => wc.inference));

			if (diff.matches_inferences() &&
				(delayed_playable(diff.possible) || delayed_playable(diff.inferred) || (diff.finessed && delayed_playable([card])))
			) {
				const id = card.identity({ infer: true });
				const actual_id = state.me.thoughts[order].identity();

				// Do not allow false updating of hypo stacks
				if (player.playerIndex === -1 && (
					(id && actual_id && !id.matches(actual_id)) ||		// Identity doesn't match
					(actual_id && state.hands.flat().some(c => unknown_plays.has(c.order) && c.matches(actual_id)))	||	// Duping playable
					(player.waiting_connections.some(wc =>				// Only part of a fake ambiguous connection
						!state.me.thoughts[wc.focused_card.order].matches(wc.inference, { assume: true }) &&
						wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order))
					&&
						!player.waiting_connections.some(wc =>
							state.me.thoughts[wc.focused_card.order].matches(wc.inference, { assume: true }) &&
							wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === order)))
				))
					continue;

				if (id === undefined) {
					// Playable, but the player doesn't know what card it is so hypo stacks aren't updated
					unknown_plays.add(order);
					continue;
				}

				const { suitIndex, rank } = id;

				if (rank !== hypo_stacks[suitIndex] + 1) {
					// e.g. a duplicated 1 before any 1s have played will have all bad possibilities eliminated by good touch
					logger.warn(`tried to add new playable card ${logCard(card)} but was duplicated`);
					continue;
				}

				hypo_stacks[suitIndex] = rank;
				good_touch_elim.push(id);
				found_new_playable = true;
			}
		}
	}
	player.hypo_stacks = hypo_stacks;
	player.unknown_plays = unknown_plays;
}

/**
 * Updates all players with info from common knowledge.
 * @param {State} state
 */
export function team_elim(state) {
	for (const player of state.players) {
		for (let i = 0; i < state.common.thoughts.length; i++) {
			const card = player.thoughts[i];
			const ccard = state.common.thoughts[i];

			card.intersect('possible', ccard.possible);

			card.inferred = ccard.inferred.slice();
			card.intersect('inferred', card.possible);

			card.old_inferred = ccard.old_inferred?.slice();

			for (const property of ['focused', 'finessed', 'chop_moved', 'reset', 'chop_when_first_clued', 'hidden', 'called_to_discard', 'finesse_index', 'rewinded', 'certain_finessed'])
				card[property] = ccard[property];

			card.reasoning = ccard.reasoning.slice();
			card.reasoning_turn = ccard.reasoning_turn.slice();
		}

		player.waiting_connections = state.common.waiting_connections.slice();
		player.good_touch_elim(state, state.numPlayers === 2);
		player.refresh_links(state);
		update_hypo_stacks(state, player);
	}
}

/**
 * @param {State} state
 * @param {Card[]} oldThoughts
 * @param {ClueAction} clueAction
 */
export function checkFix(state, oldThoughts, clueAction) {
	const { giver, list, target } = clueAction;
	const { common } = state;

	const clue_resets = new Set();
	for (const { order } of state.hands[target]) {
		if (oldThoughts[order].inferred.length > 0 && common.thoughts[order].inferred.length === 0) {
			common.reset_card(order);
			clue_resets.add(order);
		}
	}

	const resets = common.good_touch_elim(state);
	common.refresh_links(state);

	// Includes resets from negative information
	const all_resets = new Set([...clue_resets, ...resets]);

	if (all_resets.size > 0) {
		// TODO: Support undoing recursive eliminations by keeping track of which elims triggered which other elims
		const infs_to_recheck = Array.from(all_resets).map(order => oldThoughts[order].identity({ infer: true })).filter(id => id !== undefined);

		for (const inf of infs_to_recheck)
			common.restore_elim(inf);
	}

	// Any clued cards that lost all inferences
	const clued_reset = list.some(order => all_resets.has(order) && !state.hands[target].findOrder(order).newly_clued);

	const duplicate_reveal = state.hands[target].some(({ order }) => {
		const card = common.thoughts[order];

		// The fix can be in anyone's hand except the giver's
		return state.common.thoughts[order].identity() !== undefined &&
			visibleFind(state, common, card.identity(), { ignore: [giver], infer: true }).some(c => common.thoughts[c.order].touched && c.order !== order);
	});

	return clued_reset || duplicate_reveal;
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {State} state
 * @param {Identity} identity
 */
export function undo_hypo_stacks(state, { suitIndex, rank }) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	state.common.hypo_stacks[suitIndex] = Math.min(state.common.hypo_stacks[suitIndex], rank - 1);
}

/**
 * Returns the hand size of the given state.
 * @param {State} state
 */
export function getHandSize(state) {
	return HAND_SIZE[state.numPlayers] + (state.options?.oneLessCard ? -1 : state.options?.oneExtraCard ? 1 : 0);
}

/**
 * Resets superposition on all cards.
 * @param {State} state
 */
export function reset_superpositions(state) {
	for (const { order } of state.hands.flat())
		state.common.thoughts[order].superposition = false;
}
