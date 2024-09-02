import { CLUE } from '../../../constants.js';
import { CLUE_INTERP } from '../h-constants.js';
import { determine_focus, getIgnoreOrders, rankLooksPlayable } from '../hanabi-logic.js';
import { find_connecting, resolve_bluff } from './connecting-cards.js';
import { cardTouched, colourableSuits, variantRegexes } from '../../../variants.js';
import { finalize_connections } from './interpret-clue.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnections } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * Returns all the valid focus possibilities of the focused card from a clue of the given colour.
 * @param {Game} game
 * @param {number} suitIndex
 * @param {ClueAction} action
 */
function find_colour_focus(game, suitIndex, action) {
	const { common, state } = game;
	const { clue, list, target } = action;
	const { focused_card, chop } = determine_focus(game, state.hands[target], common, list, clue);

	/** @type {FocusPossibility[]} */
	const focus_possible = [];
	let next_rank = state.play_stacks[suitIndex] + 1;

	if (next_rank > state.max_ranks[suitIndex])
		return [];

	// Play clue
	/** @type {Connection[]} */
	let connections = [];

	// Try looking for a connecting card (other than itself)
	const old_play_stacks = state.play_stacks.slice();
	let already_connected = [focused_card.order];

	let finesses = 0;

	while (next_rank < state.max_ranks[suitIndex]) {
		const identity = { suitIndex, rank: next_rank };

		// Note that a colour clue always looks direct
		const ignoreOrders = getIgnoreOrders(game, next_rank - old_play_stacks[suitIndex] - 1, suitIndex);
		const looksDirect = common.thoughts[focused_card.order].identity() === undefined;

		const connect_options = action.hypothetical ? { knownOnly: [state.ourPlayerIndex] } : {};
		const connecting = find_connecting(game, action, identity, looksDirect, already_connected, ignoreOrders, connect_options);

		if (connecting.length === 0 || connecting[0].type === 'terminate')
			break;

		const { type, card } = connecting.at(-1);

		if (type === 'known' && card.newly_clued && common.thoughts[card.order].possible.length > 1 &&
			common.thoughts[focused_card.order].inferred.has(identity)) {
			// Trying to use a newly 'known' connecting card, but the focused card could be that
			// e.g. If 2 reds are clued with only r5 remaining, the focus should not connect to the other card as r6
			logger.warn(`blocked connection - focused card could be ${logCard(identity)}`);
			break;
		}
		else if (type === 'finesse') {
			finesses++;
			if (game.level === 1 && finesses === 2) {
				logger.warn('blocked double finesse at level 1');
				break;
			}

			// Even if a finesse is possible, it might not be a finesse (unless the card is critical)
			const possible_connections = resolve_bluff(game, connections);
			if ((connections.length == 0 || possible_connections.length > 0) && !state.isCritical(card))
				focus_possible.push({ suitIndex, rank: next_rank, save: false, connections: possible_connections, interp: CLUE_INTERP.PLAY });
		}

		for (const { card } of connecting)
			state.play_stacks[card.suitIndex]++;

		next_rank++;
		connections = connections.concat(connecting);
		already_connected = already_connected.concat(connecting.map(conn => conn.card.order));
	}

	// Restore play stacks
	state.play_stacks = old_play_stacks;

	connections = resolve_bluff(game, connections);
	if (connections.length == 0) {
		// Undo plays invalidated by a false bluff.
		next_rank = old_play_stacks[suitIndex] + 1;
	}

	const next_identity = { suitIndex, rank: next_rank };
	if (cardTouched(next_identity, game.state.variant, action.clue) && common.thoughts[focused_card.order].possible.has(next_identity)) {
		logger.info('found connections:', logConnections(connections, next_identity));

		// Our card could be the final rank that we can't find
		focus_possible.push({ suitIndex, rank: next_rank, save: false, connections, interp: CLUE_INTERP.PLAY });
	}

	// Save clue on chop
	if (chop) {
		for (let rank = state.play_stacks[suitIndex] + 1; rank <= Math.min(state.max_ranks[suitIndex], 5); rank++) {
			// Skip if the card would not be touched.
			if (!cardTouched({ suitIndex, rank }, game.state.variant, action.clue))
				continue;

			const brown_poss = common.thoughts[focused_card.order].possible.filter(c => state.variant.suits[c.suitIndex].match(variantRegexes.brownish) !== null);

			// Skip 5 possibility if the focused card does not include a brownish variant. (ex. No Variant games or a negative Brown card)
			// OR if the clue given is not black.
			if (rank === 5 && state.variant.suits[suitIndex] !== 'Black' && brown_poss.length === 0)
				continue;

			// Determine if possible save on k2, k5 with colour
			if (state.variant.suits[suitIndex] === 'Black' && (rank === 2 || rank === 5)) {
				const fill_ins = state.hands[target].filter(c =>
					list.includes(c.order) &&
					(c.newly_clued || c.clues.some((clue, i) =>
						i !== c.clues.length - 1 && !(c.clues.at(-1).type === clue.type && c.clues.at(-1).value === clue.value)))).length;

				const trash = state.hands[target].filter(c => c.rank === rank && !c.clued && state.isBasicTrash(c)).length;

				// Only touched/filled in 1 new card and wasn't to keep GTP
				if (fill_ins < 2 && trash === 0)
					continue;
			}

			// Check if card is critical or a brownish-2
			if (state.isCritical({ suitIndex, rank }) || brown_poss.some(c => c.rank === 2))
				focus_possible.push({ suitIndex, rank, save: true, connections: [], interp: CLUE_INTERP.SAVE });
		}
	}
	return focus_possible;
}

/**
 * Returns all the valid focus possibilities of the focused card from a clue of the given rank.
 * @param {Game} game
 * @param {number} rank
 * @param {ClueAction} action
 */
function find_rank_focus(game, rank, action) {
	const { common, state } = game;
	const { clue, giver, list, target } = action;
	const { focused_card, chop, positional } = determine_focus(game, state.hands[target], common, list, clue);
	const focus_thoughts = common.thoughts[focused_card.order];

	/** @type {FocusPossibility[]} */
	const focus_possible = [];
	let looksSave = false;

	// Save clue on chop
	if (chop) {
		for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
			const identity = { suitIndex, rank };

			// Don't consider save on k3, k4 with rank
			if (state.variant.suits[suitIndex] === 'Black' && (rank === 3 || rank === 4))
				continue;

			// Don't consider loaded save with 3,4 in whitish variants
			if (common.thinksLoaded(state, target) && state.includesVariant(variantRegexes.whitish) && (rank === 3 || rank === 4))
				continue;

			// Critical save or 2 save
			if (state.isCritical(identity) || (rank === 2 && !state.isBasicTrash({ suitIndex, rank }))) {
				focus_possible.push({ suitIndex, rank, save: true, connections: [], interp: CLUE_INTERP.SAVE });
				looksSave = true;
			}
		}
	}

	const wrong_prompts = new Set();
	const old_play_stacks = state.play_stacks;

	// Play clue
	for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
		let next_rank = state.play_stacks[suitIndex] + 1;

		if (rank < next_rank || focus_possible.some(fp => fp.suitIndex === suitIndex && fp.rank === rank))
			continue;

		if (rank === next_rank) {
			focus_possible.push({ suitIndex, rank, save: false, connections: [], interp: CLUE_INTERP.PLAY });
			continue;
		}

		/** @type {Connection[]} */
		let connections = [];
		let finesses = 0;
		let already_connected = [focused_card.order];

		state.play_stacks = old_play_stacks.slice();
		let looksDirect = focus_thoughts.identity() === undefined && (looksSave || rankLooksPlayable(game, rank, giver, target, focused_card.order));

		// Try looking for all connecting cards
		while (next_rank <= rank) {
			const identity = { suitIndex, rank: next_rank };
			const ignoreOrders = getIgnoreOrders(game, next_rank - old_play_stacks[suitIndex] - 1, suitIndex);
			const connect_options = action.hypothetical ? { knownOnly: [state.ourPlayerIndex] } : {};
			const connecting = find_connecting(game, action, identity, looksDirect, already_connected, ignoreOrders, connect_options);

			if (connecting.length === 0)
				break;

			const { type, card } = connecting.at(-1);

			if (type === 'terminate') {
				// Trying to look for the same identity as the focused card and being "wrong prompted"
				if (!focus_thoughts.inferred.has(identity)) {
					for (const { reacting } of connecting)
						wrong_prompts.add(reacting);
				}
				break;
			}

			if (card.newly_clued && common.thoughts[card.order].possible.length > 1 && focus_thoughts.inferred.has(identity)) {
				// Trying to use a newly known/playable connecting card, but the focused card could be that
				// e.g. If two 4s are clued (all other 4s visible), the other 4 should not connect and render this card with only one inference
				logger.warn(`blocked connection - focused card could be ${logCard(identity)}`);
				break;
			}

			finesses += connecting.filter(conn => conn.type === 'finesse').length;
			if (game.level === 1 && finesses === 2) {
				logger.warn('blocked double finesse at level 1');
				break;
			}

			if (type === 'finesse') {
				// A finesse proves that this is not direct
				looksDirect = focus_thoughts.identity() === undefined && looksSave;

				if (rank === next_rank) {
					const possible_connections = resolve_bluff(game, connections);
					// Even if a finesse is possible, it might not be a finesse (unless the card is critical)
					if ((connections.length == 0 || possible_connections.length > 0) && !state.isCritical(card))
						focus_possible.push({ suitIndex, rank, save: false, connections: possible_connections, interp: CLUE_INTERP.PLAY });
				}
			}

			connections = connections.concat(connecting);
			already_connected = already_connected.concat(connecting.map(conn => conn.card.order));

			next_rank++;
			for (const { card } of connecting)
				state.play_stacks[card.suitIndex]++;
		}

		// Restore play stacks
		state.play_stacks = old_play_stacks;

		const next_identity = { suitIndex, rank: next_rank };
		if (next_rank > rank) {
			logger.warn(`stacked beyond clued rank ${logConnections(connections, next_identity)}, ignoring`);
			continue;
		}

		connections = resolve_bluff(game, connections);

		if (connections.length == 0)
			next_rank = old_play_stacks[suitIndex] + 1;

		logger.info('found connections:', logConnections(connections, next_identity));

		// Connected cards can stack up to this rank
		if (rank === next_rank || positional) {
			if (connections.some(conn => conn.reacting === target && conn.hidden && conn.identities[0].rank + 1 === rank))
				logger.warn('illegal clandestine self-finesse!');

			else if (connections.some(conn => conn.reacting === target && conn.type === 'finesse' && wrong_prompts.has(target)))
				logger.warn('illegal self-finesse that will cause a wrong prompt!');

			else
				focus_possible.push({ suitIndex, rank: next_rank, save: false, connections, interp: CLUE_INTERP.PLAY });
		}
	}

	return focus_possible;
}

/**
 * Finds all the valid focus possibilities from the given clue.
 * @param {Game} game
 * @param {ClueAction} action
 */
export function find_focus_possible(game, action) {
	const { common, state } = game;
	const { clue } = action;
	logger.debug('play/hypo/max stacks in clue interpretation:', state.play_stacks, common.hypo_stacks, state.max_ranks);

	const focus_possible = clue.type === CLUE.COLOUR ?
		state.variant.suits
			.filter(s => s.match(Utils.combineRegex(variantRegexes.rainbowish, variantRegexes.prism)))
			.concat(colourableSuits(state.variant)[clue.value])
			.flatMap(s => find_colour_focus(game, state.variant.suits.indexOf(s), action)) :
		find_rank_focus(game, clue.value, action);

	// Remove play duplicates (since save overrides play)
	const filtered_fps = focus_possible.filter((p1, index1) => {
		return !focus_possible.some((p2, index2) => index2 !== index1 && p1.suitIndex === p2.suitIndex && p1.rank === p2.rank && p2.save);
	});

	return finalize_connections(filtered_fps);
}
