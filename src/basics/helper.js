import { CLUE } from '../constants.js';
import { variantRegexes } from '../variants.js';
import { visibleFind } from './hanabi-util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';
import { applyPatches } from '../StateProxy.js';

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
	const { common, state } = game;

	for (const player of game.players) {
		for (const [order, patches] of common.patches) {
			const { possible, inferred } = common.thoughts[order];
			const { possible: player_possible } = player.thoughts[order];

			player.updateThoughts(order, (draft) => {
				applyPatches(draft, patches.filter(p => p.path[0] !== 'possible' && p.path[0] !== 'inferred'));
				draft.possible = possible.intersect(player_possible);
				draft.inferred = inferred.intersect(player_possible);
			}, false);
		}

		player.waiting_connections = common.waiting_connections.slice();
		player.good_touch_elim(state, state.numPlayers === 2);
		player.refresh_links(state);
		player.update_hypo_stacks(state);
	}

	common.patches = new Map();
}

/**
 * @param {Game} game
 * @param {Card[]} oldThoughts
 * @param {ClueAction} clueAction
 */
export function checkFix(game, oldThoughts, clueAction) {
	const { clue, giver, list, target } = clueAction;
	const { common, state } = game;

	/** @type {Set<number>} */
	const clue_resets = new Set();
	for (const order of state.hands[target]) {
		const clued_reset = (oldThoughts[order].inferred.length > 0 && common.thoughts[order].inferred.length === 0) ||
			(list.includes(order) && state.includesVariant(variantRegexes.pinkish) &&
				oldThoughts[order].inferred.every(i => i.rank === 1) && clue.type === CLUE.RANK && clue.value !== 1);

		if (clued_reset) {
			common.thoughts = common.thoughts.with(order, common.reset_card(order));
			clue_resets.add(order);
		}
	}

	const resets = common.good_touch_elim(state);
	common.refresh_links(state);

	// Includes resets from negative information
	const all_resets = new Set([...clue_resets, ...resets]);

	if (all_resets.size > 0) {
		const reset_order = Array.from(all_resets).find(order =>
			!common.thoughts[order].rewinded &&
			common.thoughts[order].possible.length === 1 && common.dependentConnections(order).length > 0);

		// There is a waiting connection that depends on this card
		if (reset_order !== undefined) {
			const reset_card = common.thoughts[reset_order];
			const new_game = game.rewind(reset_card.drawn_index, [{ type: 'identify', order: reset_order, playerIndex: target, identities: [reset_card.possible.array[0].raw()] }]);
			Object.assign(game, new_game);
			return { rewinded: true };
		}

		// TODO: Support undoing recursive eliminations by keeping track of which elims triggered which other elims
		const infs_to_recheck = [];

		for (const order of all_resets) {
			const old_id = oldThoughts[order].identity({ infer: true });

			if (old_id !== undefined) {
				infs_to_recheck.push(old_id);

				common.hypo_stacks[old_id.suitIndex] = Math.min(common.hypo_stacks[old_id.suitIndex], old_id.rank - 1);
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
	const clued_reset = list.find(order => all_resets.has(order) && !state.deck[order].newly_clued);

	if (clued_reset)
		logger.info('clued card', clued_reset, 'was newly reset!');

	const duplicate_reveal = state.hands[target].find(order => {
		const card = common.thoughts[order];

		if (!list.includes(order) || game.common.thoughts[order].identity() === undefined)
			return false;

		// The fix can be in anyone's hand except the giver's
		const copy = visibleFind(state, common, card.identity(), { ignore: [giver], infer: true })
			.find(o => common.thoughts[o].touched && o !== order);// && !c.newly_clued);

		if (copy)
			logger.info('duplicate', logCard(card.identity()), 'revealed! copy of order', copy, card.possible.map(logCard));

		return copy !== undefined;
	});

	return { fix: clued_reset !== undefined || duplicate_reveal !== undefined };
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
	for (const order of game.state.hands.flat())
		game.common.updateThoughts(order, (draft) => { draft.superposition = false; });
}

/**
 * @param {Game} game
 * @param {number} start
 * @param {number} target
 * @param {Identity} [identity]		The identity we want to make playable (if undefined, any identity).
 * @returns {boolean} 				Whether the target's hand becomes playable.
 */
export function connectable_simple(game, start, target, identity) {
	if (identity !== undefined && game.state.isPlayable(identity))
		return true;

	if (start === target)
		return game.players[target].thinksPlayables(game.state, target, { assume: false }).length > 0;

	const playables = game.players[start].thinksPlayables(game.state, start, { assume: false });

	for (const order of playables) {
		const id = game.players[start].thoughts[order].identity({ infer: true });

		if (id === undefined)
			continue;

		const new_state = game.state.shallowCopy();
		new_state.play_stacks = new_state.play_stacks.slice();
		new_state.play_stacks[id.suitIndex]++;

		const new_game = game.shallowCopy();
		new_game.state = new_state;

		if (connectable_simple(new_game, game.state.nextPlayerIndex(start), target, identity))
			return true;
	}
	return connectable_simple(game, game.state.nextPlayerIndex(start), target, identity);
}
