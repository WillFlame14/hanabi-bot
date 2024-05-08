import { CLUE } from '../../../constants.js';
import { determine_focus, rankLooksPlayable } from '../hanabi-logic.js';
import { find_connecting } from './connecting-cards.js';
import { visibleFind } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';
import { logCard, logConnections } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';
import { variantRegexes } from '../../../variants.js';
import { CLUE_INTERP } from '../h-constants.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Returns all the valid focus possibilities of the focused card from a clue of the given colour.
 * @param {Game} game
 * @param {number} suitIndex
 * @param {ClueAction} action
 */
function find_colour_focus(game, suitIndex, action) {
	const { common, state } = game;
	const { giver, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list);

	/** @type {FocusPossibility[]} */
	const focus_possible = [];
	let next_rank = state.play_stacks[suitIndex] + 1;

	if (next_rank > state.max_ranks[suitIndex])
		return [];

	// Play clue
	/** @type {Connection[]} */
	let connections = [];

	// Try looking for a connecting card (other than itself)
	const old_play_stacks = state.play_stacks;
	let already_connected = [focused_card.order];

	let finesses = 0;

	while (next_rank < state.max_ranks[suitIndex]) {
		const identity = { suitIndex, rank: next_rank };
		state.play_stacks = old_play_stacks.slice();

		// Note that a colour clue always looks direct
		const ignoreOrders = game.next_ignore[next_rank - old_play_stacks[suitIndex] - 1];
		const looksDirect = common.thoughts[focused_card.order].identity() === undefined;
		const connecting = find_connecting(game, giver, target, identity, looksDirect, already_connected, ignoreOrders);
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

			// Even if a finesse is possible, it might not be a finesse
			focus_possible.push({ suitIndex, rank: next_rank, save: false, connections: Utils.objClone(connections), interp: CLUE_INTERP.PLAY });
		}
		state.play_stacks[suitIndex]++;
		next_rank++;

		connections = connections.concat(connecting);
		already_connected = already_connected.concat(connecting.map(conn => conn.card.order));
	}

	// Restore play stacks
	state.play_stacks = old_play_stacks;

	logger.info('found connections:', logConnections(connections, { suitIndex, rank: next_rank }));

	// Our card could be the final rank that we can't find
	focus_possible.push({ suitIndex, rank: next_rank, save: false, connections, interp: CLUE_INTERP.PLAY });

	// Save clue on chop (5 save cannot be done with colour)
	if (chop) {
		for (let rank = state.play_stacks[suitIndex] + 1; rank <= Math.min(state.max_ranks[suitIndex], 5); rank++) {
			// Skip 5 possibility if the focused card does not include a brownish variant. (ex. No Variant games or a negative Brown card)
			// OR if the clue given is not black.
			if (rank === 5 &&
				!(state.variant.suits[suitIndex] === 'Black' ||
					common.thoughts[focused_card.order].possible.some(c => state.variant.suits[c.suitIndex].match(variantRegexes.brownish))))
				continue;
			// Determine if possible save on k2, k5 with colour
			if (state.variant.suits[suitIndex] === 'Black' && (rank === 2 || rank === 5)) {
				let fill_ins = 0;

				for (const card of state.hands[target]) {
					if (!list.includes(card.order))
						continue;

					if (card.newly_clued ||
						card.clues.some((clue, index) => index !== card.clues.length - 1 && !Utils.objEquals(clue, card.clues.at(-1)))
					)
						fill_ins++;
				}

				// Only touched/filled in 1 new card
				if (fill_ins < 2)
					continue;
			}

			// Check if card is critical
			if (state.isCritical({ suitIndex, rank })) {
				focus_possible.push({ suitIndex, rank, save: true, connections: [], interp: CLUE_INTERP.SAVE });
				continue;
			}

			// Check if the card is a brownish-2
			if (common.thoughts[focused_card.order].possible.some(c => state.variant.suits[c.suitIndex].match(variantRegexes.brownish) && c.rank === 2))
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
	const { giver, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list);
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

			// Critical save or 2 save
			if (state.isCritical(identity) || (rank === 2 && visibleFind(state, game.players[target], identity, { ignore: [giver] }).length === 0)) {
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

		if (rank < next_rank)
			continue;

		if (rank === next_rank) {
			focus_possible.push({ suitIndex, rank, save: false, connections: [], interp: CLUE_INTERP.PLAY });
			continue;
		}

		/** @type {Connection[]} */
		let connections = [];
		let finesses = 0;
		let already_connected = [focused_card.order];

		// Try looking for all connecting cards
		state.play_stacks = old_play_stacks.slice();

		let ignoreOrders = game.next_ignore[next_rank - old_play_stacks[suitIndex] - 1];
		let looksDirect = focus_thoughts.identity() === undefined && (looksSave || rankLooksPlayable(game, rank, giver, target, focused_card.order));
		let connecting = find_connecting(game, giver, target, { suitIndex, rank: next_rank }, looksDirect, already_connected, ignoreOrders);

		while (connecting.length !== 0) {
			const { type, card } = connecting.at(-1);

			if (type === 'terminate') {
				// Trying to look for the same identity as the focused card and being "wrong prompted"
				// if (!focus_thoughts.inferred.has({ suitIndex, rank: next_rank })) {
				for (const { reacting } of connecting)
					wrong_prompts.add(reacting);
				// }
				break;
			}

			if (card.newly_clued && common.thoughts[card.order].possible.length > 1 && focus_thoughts.inferred.has({ suitIndex, rank: next_rank })) {
				// Trying to use a newly known/playable connecting card, but the focused card could be that
				// e.g. If two 4s are clued (all other 4s visible), the other 4 should not connect and render this card with only one inference
				logger.warn(`blocked connection - focused card could be ${logCard({suitIndex, rank: next_rank})}`);
				break;
			}

			// Saving 2s or criticals will never cause a prompt or finesse.
			if (chop && (rank === 2 || state.isCritical({ suitIndex, rank })) && (type === 'prompt' || type === 'finesse'))
				break;

			finesses += connecting.filter(conn => conn.type === 'finesse').length;
			if (game.level === 1 && finesses === 2) {
				logger.warn('blocked double finesse at level 1');
				break;
			}

			if (type === 'finesse') {
				// A finesse proves that this is not direct
				looksDirect = focus_thoughts.identity() === undefined && looksSave;

				if (rank === next_rank) {
					// Even if a finesse is possible, it might not be a finesse
					focus_possible.push({ suitIndex, rank, save: false, connections: Utils.objClone(connections), interp: CLUE_INTERP.PLAY });
				}
			}

			connections = connections.concat(connecting);
			already_connected = already_connected.concat(connecting.map(conn => conn.card.order));

			next_rank++;
			state.play_stacks[suitIndex]++;

			if (next_rank > rank) {
				logger.warn(`stacked beyond clued rank ${logConnections(connections, { suitIndex, rank: next_rank})}, ignoring`);
				break;
			}

			ignoreOrders = game.next_ignore[next_rank - old_play_stacks[suitIndex] - 1];
			connecting = find_connecting(game, giver, target, { suitIndex, rank: next_rank }, looksDirect, already_connected, ignoreOrders);
		}

		if (next_rank <= rank)
			logger.info('found connections:', logConnections(connections, { suitIndex, rank: next_rank }));

		// Connected cards can stack up to this rank
		if (rank === next_rank) {
			if (connections.some(conn => conn.reacting === target && conn.hidden && conn.identities[0].rank + 1 === rank))
				logger.warn('illegal clandestine self-finesse!');

			else if (connections.some(conn => conn.reacting === target && conn.type === 'finesse' && wrong_prompts.has(target)))
				logger.warn('illegal self-finesse that will cause a wrong prompt!');

			else
				focus_possible.push({ suitIndex, rank, save: false, connections, interp: CLUE_INTERP.PLAY });
		}
	}

	// Restore play stacks
	state.play_stacks = old_play_stacks;
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

	/** @type {FocusPossibility[]} */
	let focus_possible = [];

	if (clue.type === CLUE.COLOUR) {
		const colours = state.variant.suits.filter(s => s.match(variantRegexes.rainbowish)).map(s => state.variant.suits.indexOf(s));
		colours.push(clue.value);
		for (const colour of colours)
			focus_possible = focus_possible.concat(find_colour_focus(game, colour, action));
	}
	else {
		// Pink promise assumed
		focus_possible = find_rank_focus(game, clue.value, action);
	}

	// Remove play duplicates (since save overrides play)
	return focus_possible.filter((p1, index1) => {
		return !focus_possible.some((p2, index2) => index2 !== index1 && p1.suitIndex === p2.suitIndex && p1.rank === p2.rank && p2.save);
	});
}
