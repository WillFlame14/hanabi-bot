import { cardCount } from '../../variants.js';
import { Hand } from '../../basics/Hand.js';
import { baseCount, inEndgame, visibleFind } from '../../basics/hanabi-util.js';
import * as Utils from '../../tools/util.js';

import { logHand } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Clue} Clue
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

	if (inEndgame(state))
		return 1.5;

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
	return 1 - (state.numPlayers === 2 ? 0.5 : 0) - (inEndgame(state) ? 10 : 0);
}

/**
 * @param {State} state
 * @param {number} rank
 * @param {number} giver
 * @param {number} target
 * @param {number} order 	The order to exclude when searching for duplicates.
 */
export function rankLooksPlayable(state, rank, giver, target, order) {
	/**
	 * @param {number} stack
	 * @param {number} suitIndex
	 */
	const looksPlayableRank = (stack, suitIndex) => {
		const identity = { suitIndex, rank };

		const playable_identity = stack + 1 === rank;
		const other_visibles = baseCount(state, identity) +
			visibleFind(state, state.common, identity).filter(c => c.order !== order).length;
		const matching_inference = state.common.thoughts[order].inferred.some(inf => inf.matches(identity));

		return playable_identity && other_visibles < cardCount(state.variant, identity) && matching_inference;
	};

	return state.common.hypo_stacks.some(looksPlayableRank) || state.players[target].hypo_stacks.some((stack, suitIndex) => {
		// Don't allow target to connect through unknown plays in giver's hand
		if (stack > state.common.hypo_stacks[suitIndex] &&
			state.hands[giver].some(c =>
				c.suitIndex === suitIndex && c.rank > state.common.hypo_stacks[suitIndex] && state.common.unknown_plays.has(c.order)))
			return false;

		return looksPlayableRank(stack, suitIndex);
	});
}

/**
 * @param {State} state
 * @param {Player} player
 * @param {Clue} clue
 * @param {{playerIndex: number, card: Card}[]} playables
 * @param {ActualCard} focused_card
 * 
 * Returns whether a clue is a tempo clue, and if so, whether it's valuable.
 */
export function valuable_tempo_clue(state, player, clue, playables, focused_card) {
	const { target } = clue;
	const touch = state.hands[target].clueTouched(clue, state.variant);

	if (touch.some(card => !card.clued))
		return { tempo: false, valuable: false };

	const prompt = player.find_prompt(state.hands[target], focused_card, state.variant.suits);

	// No prompt exists for this card (i.e. it is a hard burn)
	if (prompt === undefined)
		return { tempo: false, valuable: false };

	const valuable = playables.length > 1 ||
		prompt.order !== focused_card.order ||
		playables.some(({card}) => card.chop_moved && card.newly_clued);

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

	return Utils.range(1, gap).some(inc => ((giver + inc) % numPlayers) === playerIndex);
}
