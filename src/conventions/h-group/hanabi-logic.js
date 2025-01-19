import { CLUE } from '../../constants.js';
import { cardCount, colourableSuits, variantRegexes } from '../../variants.js';
import { knownAs, visibleFind } from '../../basics/hanabi-util.js';
import { order_1s } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import { logClue } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').BaseClue} BaseClue
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusResult} FocusResult
 */

/**
 * Finds the focused card and whether it was on chop before the clue.
 * 
 * This function must be called before the clue has been given.
 * @param {Game} game
 * @param {number[]} hand
 * @param {Player} player
 * @param {number[]} list 	The orders of all cards that were just clued.
 * @param {BaseClue} clue
 * @returns {FocusResult}
 */
export function determine_focus(game, hand, player, list, clue) {
	const { common, state } = game;
	const chop = player.chop(hand);

	// Chop card exists, check for chop focus
	if (chop !== undefined && list.includes(chop))
		return { focus: chop, chop: true, positional: false };

	const pink_choice_tempo = clue.type === CLUE.RANK && state.includesVariant(variantRegexes.pinkish) &&
		list.every(o => state.deck[o].clued) &&
		clue.value <= hand.length &&
		list.includes(hand[clue.value - 1]) &&
		[Math.max(...list), hand[clue.value - 1]].every(o => state.deck[o].clues.some(cl =>		// leftmost and target must both be pink
			(cl.type === CLUE.COLOUR && variantRegexes.pinkish.test(colourableSuits(state.variant)[cl.value])) ||
			(cl.type === CLUE.RANK && cl.value !== clue.value)));

	if (pink_choice_tempo)
		return { focus: hand[clue.value - 1], chop: false, positional: true };

	const brown_tempo = clue.type === CLUE.COLOUR && /Brown/.test(colourableSuits(state.variant)[clue.value]) &&
		list.every(o => state.deck[o].clued);

	if (brown_tempo)
		return { focus: hand.findLast(o => list.includes(o)), chop: false, positional: true };

	if (clue.type === CLUE.RANK && clue.value === 1) {
		const unknown_1s = list.filter(o => unknown_1(state.deck[o], true));
		const ordered_1s = order_1s(state, common, unknown_1s, { no_filter: true });

		if (ordered_1s.length > 0)
			return { focus: ordered_1s[0], chop: false, positional: false };
	}

	const sorted_list = list.toSorted((a, b) => b - a);
	const focus =
		sorted_list.find(o => !player.thoughts[o].known && !state.deck[o].clued) ??	// leftmost newly clued
		sorted_list.find(o => player.thoughts[o].chop_moved) ??					// leftmost chop moved
		sorted_list[0];															// leftmost reclued

	if (focus === undefined) {
		console.log('list', list, 'hand', hand.map(o => state.deck[o]), logClue(/** @type {Clue} */ (clue)));
		throw new Error('No focus found!');
	}

	return { focus, chop: false, positional: false };
}

/**
 * Returns the current stall severity for the giver. [None, Early game, DDA/SDCM, Locked hand, 8 clues]
 * @param {State} state
 * @param {Player} player
 * @param {number} giver
 * @param {Player} [new_player]		Optionally, a player that has more info about dd risk.
 */
export function stall_severity(state, player, giver, new_player = player) {
	if (state.clue_tokens === 8 && state.turn_count !== 1)
		return 4;

	if (player.thinksLocked(state, giver))
		return 3;

	const chop = player.chop(state.hands[giver]);
	// Use player after clue, because the clue may have given information about the dd card.
	if (state.screamed_at || (state.dda !== undefined && chop !== undefined && new_player.thoughts[chop].possible.has(state.dda)))
		return 2;

	if (state.early_game)
		return 1;

	return 0;
}

/**
 * Returns the current minimum clue value.
 * @param  {State} state
 * @returns {number}
 */
export function minimum_clue_value(state) {
	// -0.5 if 2 players (allows tempo clues to be given)
	// -10 if endgame
	return 1 - (state.numPlayers === 2 ? 0.5 : 0) - (state.inEndgame() ? 10 : 0);
}

/**
 * @param {Game} game
 * @param {number} rank
 * @param {number} giver
 * @param {number} target
 * @param {number} order 	The order to exclude when searching for duplicates.
 */
export function rankLooksPlayable(game, rank, giver, target, order) {
	const { common, state } = game;
	const resolved_hypo_stacks = common.hypo_stacks.slice();

	// Update the hypo stacks to everything the giver thinks the target knows
	for (const order of common.unknown_plays) {
		// Target can't resolve unknown plays in their own hand
		if (state.hands[target].includes(order))
			continue;

		// Giver can't use private info in their hand
		if (state.hands[giver].includes(order) && common.thoughts[order].identity({ infer: true }) === undefined)
			continue;

		const card = game.players[giver].thoughts[order];
		if (card.identity() === undefined)
			continue;

		resolved_hypo_stacks[card.suitIndex] = Math.max(resolved_hypo_stacks[card.suitIndex], card.rank);
	}

	return resolved_hypo_stacks.some((stack, suitIndex) => {
		const identity = { suitIndex, rank };

		const playable_identity = stack + 1 === rank;
		const other_visibles = state.baseCount(identity) +
			visibleFind(state, common, identity).filter(o => o !== order).length;
		const matching_inference = game.players[target].thoughts[order].inferred.has(identity);

		return playable_identity && other_visibles < cardCount(state.variant, identity) && matching_inference;
	});
}

/**
 * @param {Game} game
 * @param {Clue} clue
 * @param {{playerIndex: number, card: Card}[]} playables
 * @param {number} focus
 * 
 * Returns whether a clue is a tempo clue, and if so, whether it's valuable.
 */
export function valuable_tempo_clue(game, clue, playables, focus) {
	const { state, common } = game;
	const { target } = clue;

	const list = state.clueTouched(state.hands[target], clue);

	if (list.some(o => !state.deck[o].clued))
		return { tempo: false, valuable: false };

	// Brown/pink tempo clues are always valuable
	if ([variantRegexes.pinkish, variantRegexes.brownish].some(v => state.includesVariant(v) && list.every(o => knownAs(game, o, v))))
		return { tempo: true, valuable: true };

	const prompt = common.find_prompt(state, target, state.deck[focus]);

	// No prompt exists for this card (i.e. it is a hard burn)
	if (prompt === undefined)
		return { tempo: false, valuable: false };

	const previously_playables = game.players[target].thinksPlayables(game.state, target);

	const previously_playing = playables.every(p =>
		previously_playables.some(o => o === p.card.order) ||
		game.players[target].thoughts[p.card.order].identity({ infer: true })?.matches(state.deck[p.card.order]));

	// Target was already going to play these cards; not a tempo clue
	if (previously_playing)
		return { tempo: false, valuable: false };

	const valuable = playables.length > 1 ||
		(state.deck[focus].rank !== 5 && prompt !== focus) ||
		playables.some(p => ((card = common.thoughts[p.card.order]) => card.chop_moved && card.newly_clued)());

	return { tempo: true, valuable };
}

/**
 * Returns whether the playerIndex is "in between" the giver (exclusive) and target (inclusive), in play order.
 * @param {number} numPlayers
 * @param {number} playerIndex
 * @param {number} giver
 * @param {number} target
 */
export function inBetween(numPlayers, playerIndex, giver, target) {
	return playersBetween(numPlayers, giver, target).includes(playerIndex);
}

/**
 * Returns all player indices between the start (exclusive) and end (inclusive) in play order.
 * @param {number} numPlayers
 * @param {number} start
 * @param {number} end
 */
export function playersBetween(numPlayers, start, end) {
	const gap = (end - start + numPlayers) % numPlayers;

	return gap === 0 ? [] : Utils.range(1, gap).map(inc => ((start + inc) % numPlayers));
}

/**
 * Returns an earlier queued finesse, if it exists.
 * @param {State} state
 * @param {number} playerIndex
 * @param {Player} player
 * @param {number} new_finesse_order
 */
export function older_queued_finesse(state, playerIndex, player, new_finesse_order) {
	return state.hands[playerIndex].find((o, index) => {
		// Can't be layered finesse if every card to the right is clued
		if (state.deck[o].clued || state.hands[playerIndex].every((c1, index1) => index1 <= index || state.deck[c1].clued))
			return false;

		const { finessed, finesse_index } = player.thoughts[o];
		return finessed &&
			finesse_index < player.thoughts[new_finesse_order].finesse_index;		// The finesse must have been older
	});
}

/**
 * @param {Connection[]} connections
 * @param {number} conn_index
 */
export function getRealConnects(connections, conn_index) {
	return connections.filter((conn, index) => index < conn_index && !conn.hidden).length;
}

/**
 * @param {ActualCard} card
 * @param {boolean} [beforeClue]
 */
export function unknown_1(card, beforeClue = false) {
	return (beforeClue || card.clues.length > 0) && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1);
}

/**
 * @param {Game} game
 * @param {Game} hypo_game
 * @param {number} focus
 */
export function clueUncertain(game, hypo_game, focus) {
	const { state } = hypo_game;

	return Array.from(hypo_game.common.hypo_plays).some(o =>
		game.common.thoughts[o].uncertain &&			// The card was uncertain before this clue
		state.deck[o].playedBefore(state.deck[focus]));
}

/**
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {number} prompt
 */
export function rainbowMismatch(game, action, identity, prompt) {
	const { me, state } = game;
	const { clue, list, target } = action;

	if (clue.type !== CLUE.COLOUR || !variantRegexes.rainbowish.test(state.variant.suits[identity.suitIndex]))
		return false;

	// Prompt is known rainbow
	if (knownAs(game, prompt, variantRegexes.rainbowish))
		return false;

	const free_choice_clues = state.allValidClues(target).filter(clue => Utils.objEquals(state.clueTouched(state.hands[target], clue), list));
	const matching_clues = free_choice_clues.filter(cl => state.deck[prompt].clues.some(clu =>
		cl.type === CLUE.COLOUR && clu.type === CLUE.COLOUR && cl.value === clu.value));

	// There was free choice to clue a matching colour, but didn't
	return list.every(o => target === state.ourPlayerIndex ?
		me.thoughts[o].possible.every(c => variantRegexes.rainbowish.test(state.variant.suits[c.suitIndex])) :
		variantRegexes.rainbowish.test(state.variant.suits[state.deck[o].suitIndex])) &&
	matching_clues.length > 0 && !matching_clues.some(cl => cl.value === clue.value);
}
