import { visibleFind } from './hanabi-util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./Game.js').Game} Game
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
 * Updates all players with info from common knowledge.
 * @param {Game} game
 */
export function team_elim(game) {
	const { state } = game;

	for (const player of game.players) {
		for (let i = 0; i < game.common.thoughts.length; i++) {
			const card = player.thoughts[i];
			const ccard = game.common.thoughts[i];

			card.possible = ccard.possible.intersect(card.possible);
			card.inferred = ccard.inferred.intersect(card.possible);

			// Reset to GTP if common interpretation doesn't make sense
			if (card.inferred.length === 0)
				card.inferred = card.possible;

			card.old_inferred = ccard.old_inferred;

			for (const property of ['focused', 'finessed', 'chop_moved', 'reset', 'chop_when_first_clued', 'hidden', 'called_to_discard', 'finesse_index', 'rewinded', 'certain_finessed'])
				card[property] = ccard[property];

			card.reasoning = ccard.reasoning.slice();
			card.reasoning_turn = ccard.reasoning_turn.slice();
		}

		player.waiting_connections = game.common.waiting_connections.slice();
		player.good_touch_elim(state, state.numPlayers === 2);
		player.refresh_links(state);
		player.update_hypo_stacks(state);
	}
}

/**
 * @param {Game} game
 * @param {Card[]} oldThoughts
 * @param {ClueAction} clueAction
 */
export function checkFix(game, oldThoughts, clueAction) {
	const { giver, list, target } = clueAction;
	const { common, state } = game;

	/** @type {Set<number>} */
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
		const reset_order = Array.from(all_resets).find(order =>
			common.thoughts[order].possible.length === 1 && common.dependentConnections(order).length > 0);

		// There is a waiting connection that depends on this card
		if (reset_order !== undefined) {
			const reset_card = common.thoughts[reset_order];
			const { suitIndex, rank } = reset_card.possible.array[0];
			game.rewind(reset_card.drawn_index, { type: 'identify', order: reset_card.order, playerIndex: target, suitIndex, rank });
			return;
		}

		// TODO: Support undoing recursive eliminations by keeping track of which elims triggered which other elims
		const infs_to_recheck = [];

		for (const order of all_resets) {
			const old_id = oldThoughts[order].identity({ infer: true });

			if (old_id !== undefined) {
				infs_to_recheck.push(old_id);

				common.hypo_stacks[old_id.suitIndex] = old_id.rank - 1;
				logger.info('setting hypo stacks to', common.hypo_stacks);

				const id_hash = logCard(old_id);
				const elims = common.elims[id_hash];

				// Don't allow the card being reset to regain this inference
				if (elims && elims.includes(order))
					elims.splice(elims.indexOf(order), 1);
			}
		}

		for (const inf of infs_to_recheck)
			common.restore_elim(inf);
	}

	// Any clued cards that lost all inferences
	const clued_reset = list.some(order => all_resets.has(order) && !state.hands[target].findOrder(order).newly_clued);

	const duplicate_reveal = state.hands[target].some(({ order }) => {
		const card = common.thoughts[order];

		// The fix can be in anyone's hand except the giver's
		return game.common.thoughts[order].identity() !== undefined &&
			visibleFind(state, common, card.identity(), { ignore: [giver], infer: true }).some(c => common.thoughts[c.order].touched && c.order !== order);
	});

	return clued_reset || duplicate_reveal;
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {Game} game
 * @param {Identity} identity
 */
export function undo_hypo_stacks(game, { suitIndex, rank }) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	game.common.hypo_stacks[suitIndex] = Math.min(game.common.hypo_stacks[suitIndex], rank - 1);
}

/**
 * Resets superposition on all cards.
 * @param {Game} game
 */
export function reset_superpositions(game) {
	for (const { order } of game.state.hands.flat())
		game.common.thoughts[order].superposition = false;
}
