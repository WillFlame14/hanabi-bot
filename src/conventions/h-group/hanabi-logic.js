import { cardCount } from '../../variants.js';
import { Hand } from '../../basics/Hand.js';
import { visibleFind } from '../../basics/hanabi-util.js';
import * as Utils from '../../tools/util.js';

import { logHand } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').Identity} Identity
 */

/**
 * Finds the focused card and whether it was on chop before the clue.
 * 
 * The 'beforeClue' option is needed if this is called before the clue has been interpreted
 * to prevent focusing a previously clued card.
 * @param {Hand} hand
 * @param {Player} player
 * @param {number[]} list 	The orders of all cards that were just clued.
 * @param {{beforeClue?: boolean}} options
 */
export function determine_focus(hand, player, list, options = {}) {
	const chop = player.chop(hand);

	// Chop card exists, check for chop focus
	if (chop && list.includes(chop.order))
		return { focused_card: chop, chop: true };

	const touch = hand.filter(c => list.includes(c.order));

	const focused_card =
		touch.find(c => (options.beforeClue ? !c.clued : c.newly_clued)) ??		// leftmost newly clued
		touch.find(c => player.thoughts[c.order].chop_moved) ??					// leftmost chop moved
		touch[0];																// leftmost reclued

	if (focused_card === undefined) {
		console.log('list', list, 'hand', logHand(hand));
		throw new Error('No focus found!');
	}

	return { focused_card, chop: false };
}

/**
 * Returns the current stall severity for the giver. [None, Early game, DDA/SDCM, Locked hand, 8 clues]
 * @param {State} state
 * @param {Player} player
 * @param {number} giver
 */
export function stall_severity(state, player, giver) {
	if (state.clue_tokens === 8 && state.turn_count !== 1)
		return 4;

	if (player.thinksLocked(state, giver))
		return 3;

	const chop = player.chop(state.hands[giver]);
	if (state.screamed_at || (state.dda !== undefined && !player.thinksLoaded(state, giver, { assume: false }) && chop !== undefined && player.thoughts[chop.order].possible.has(state.dda)))
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
		if (state.hands[target].findOrder(order))
			continue;

		// Giver can't use private info in their hand
		if (state.hands[giver].findOrder(order) && common.thoughts[order].identity({ infer: true }) === undefined)
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
			visibleFind(state, common, identity).filter(c => c.order !== order).length;
		const matching_inference = common.thoughts[order].inferred.has(identity);

		return playable_identity && other_visibles < cardCount(state.variant, identity) && matching_inference;
	});
}

/**
 * @param {Game} game
 * @param {Clue} clue
 * @param {{playerIndex: number, card: Card}[]} playables
 * @param {ActualCard} focused_card
 * 
 * Returns whether a clue is a tempo clue, and if so, whether it's valuable.
 */
export function valuable_tempo_clue(game, clue, playables, focused_card) {
	const { state, common } = game;
	const { target } = clue;

	const touch = state.hands[target].clueTouched(clue, state.variant);

	if (touch.some(card => !card.clued))
		return { tempo: false, valuable: false };

	const prompt = common.find_prompt(state.hands[target], focused_card, state.variant);

	// No prompt exists for this card (i.e. it is a hard burn)
	if (prompt === undefined)
		return { tempo: false, valuable: false };

	const previously_playables = game.players[target].thinksPlayables(game.state, target);

	const previously_playing = playables.every(p =>
		previously_playables.some(c => c.order === p.card.order) ||
		game.players[target].thoughts[p.card.order].identity({ infer: true })?.matches(state.deck[p.card.order]));

	// Target was already going to play these cards; not a tempo clue
	if (previously_playing)
		return { tempo: false, valuable: false };

	const valuable = playables.length > 1 ||
		prompt.order !== focused_card.order ||
		playables.some(({ card }) => card.chop_moved && card.newly_clued);

	return { tempo: true, valuable };
}

/**
 * Returns whether the playerIndex is "in between" the giver and target (in play order).
 * @param {number} numPlayers
 * @param {number} playerIndex
 * @param {number} giver
 * @param {number} target
 */
export function inBetween(numPlayers, playerIndex, giver, target) {
	const gap = (target - giver + numPlayers) % numPlayers;

	return Utils.range(1, Math.max(gap, 1)).some(inc => ((giver + inc) % numPlayers) === playerIndex);
}

/**
 * Returns an earlier queued finesse, if it exists.
 * @param {Hand} hand
 * @param {Player} player
 * @param {number} new_finesse_order
 */
export function older_queued_finesse(hand, player, new_finesse_order) {
	return hand.find((c, index) => {
		// Can't be layered finesse if every card to the right is clued
		if (c.clued || hand.every((c1, index1) => index1 <= index || c1.clued))
			return false;

		const { finessed, finesse_index } = player.thoughts[c.order];
		return finessed &&
			finesse_index < player.thoughts[new_finesse_order].finesse_index;		// The finesse must have been older
	});
}

/**
 * @param {Game} game
 * @param {number} index
 * @param {number} suitIndex
 */
export function getIgnoreOrders(game, index, suitIndex) {
	return (game.next_ignore[index] ?? [])
		.filter(i => i.inference === undefined || i.inference.suitIndex === suitIndex)
		.map(i => i.order);
}
