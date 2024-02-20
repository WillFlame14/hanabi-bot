import { CLUE, HAND_SIZE } from '../constants.js';
import { cardCount, cardTouched, isCluable } from '../variants.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Hand.js').Hand} Hand
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./Card.js').ActualCard} ActualCard
 * @typedef {import('../types.js').Identity} Identity
 * 
 * @typedef {{symmetric?: number[], infer?: number[], ignore?: number[]}} FindOptions
 * The 'ignore' option can store an array of player indexes whose hands should be ignored during search.
 * 
 * The 'symmetric' and 'infer' options are for card identification (see Card.identity() for more details).
 * 
 * @typedef {{symmetric?: boolean, infer?: boolean, assume?: boolean}} MatchOptions
 */

/**
 * Returns an array of cards in everyone's hands that match the given suitIndex and rank.
 * @param {State} state
 * @param {Player} player     The inferring player.
 * @param {Identity} identity
 * @param {MatchOptions & {ignore?: number[]}} [options]
 */
export function visibleFind(state, player, identity, options = {}) {
	const hands = state.hands.filter((_, index) => !(options.ignore ?? []).includes(index));
	return hands.flat().filter(c => player.thoughts[c.order].matches(identity, options));
}

/**
 * Returns the number of cards matching an identity on either the play stacks or the discard stacks.
 * @param {State} state
 * @param {Identity} identity
 */
export function baseCount(state, { suitIndex, rank }) {
	return (state.play_stacks[suitIndex] >= rank ? 1 : 0) + state.discard_stacks[suitIndex][rank - 1];
}

/**
 * Returns the number of cards still unknown that could be this identity according to a player.
 * @param {State} state
 * @param {Player} player
 * @param {Identity} identity
 */
export function unknownIdentities(state, player, identity) {
	const visibleCount = state.hands.flat().filter(c => player.thoughts[c.order].matches(identity)).length;
	return cardCount(state.suits, identity) - baseCount(state, identity) - visibleCount;
}

/**
 * Returns whether the given suitIndex and rank is currently critical.
 * @param {State} state
 * @param {Identity} identity
 */
export function isCritical(state, { suitIndex, rank }) {
	return state.discard_stacks[suitIndex][rank - 1] === (cardCount(state.suits, { suitIndex, rank }) - 1);
}

/**
 * Returns whether the given identity is basic trash (has been played already or can never be played).
 * @param {State} state
 * @param {Identity} identity
 */
export function isBasicTrash(state, { suitIndex, rank }) {
	return rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex];
}

/**
 * Returns whether the given suitIndex and rank has already been 'saved' in someone's hand (i.e. won't be discarded).
 * @param {State} state
 * @param {Player} player     				The inferring player.
 * @param {Identity} identity
 * @param {number} [order] 					A card's order to exclude from search.
 * @param {MatchOptions & {ignoreCM?: boolean}} [options]
 */
export function isSaved(state, player, identity, order = -1, options = {}) {
	return state.hands.flat().some(c => {
		const card = player.thoughts[c.order];

		return card.matches(identity, options) && c.order !== order &&
			(card.touched || (options.ignoreCM ? false : card.chop_moved));
	});
}

/**
 * Returns whether the given suitIndex and rank is trash (either basic trash or already saved),
 * according to the inferring player.
 * @param {State} state
 * @param {Player} player
 * @param {Identity} identity
 * @param {number} [order]                The order of the card to ignore (usually itself)
 * @param {MatchOptions} [options]
 */
export function isTrash(state, player, identity, order = -1, options = {}) {
	return isBasicTrash(state, identity) || isSaved(state, player, identity, order, options);
}

/**
 * Returns how far the given identity are from playable. 0 means it is currently playable.
 * @param {State} state
 * @param {Identity} identity
 */
export function playableAway(state, { suitIndex, rank }) {
	return rank - (state.play_stacks[suitIndex] + 1);
}

/**
 * Returns the current pace (current score + cards left + # of players - max score).
 * @param {State} state
 */
export function getPace(state) {
	const maxScore = state.max_ranks.reduce((acc, curr) => acc + curr);
	return state.score + state.cardsLeft + state.numPlayers - maxScore;
}

/**
 * Returns whether the state is in the endgame.
 * @param {State} state
 */
export function inEndgame(state) {
	return getPace(state) < state.numPlayers;
}

/**
 * @param {State} state
 * @param {ActualCard} card
 */
export function inStartingHand(state, card) {
	return card.order < state.numPlayers * HAND_SIZE[state.numPlayers];
}

/**
 * Returns whether an identity needs to be saved as a unique 2 on the board, according to a player.
 * @param  {State} state
 * @param  {Player} player
 * @param  {Identity} identity
 */
export function save2(state, player, identity) {
	const { suitIndex, rank } = identity;

	return rank === 2 &&
        state.play_stacks[suitIndex] < 2 &&						// play stack not yet at 2
        visibleFind(state, player, identity, { infer: true }).length === 1;		// other copy isn't visible
}

/**
 * Returns the relative "value" of an identity. 0 is worthless, 5 is critical.
 * TODO: Improve general algorithm. (e.g. having clued cards of a suit makes it better, a dead suit is worse)
 * @param  {State} state
 * @param  {Player} player
 * @param  {Identity} identity
 * @param  {number} [order] 		The order of the card (if checking the value of a card).
 * @returns {number}
 */
export function cardValue(state, player, identity, order = -1) {
	const { suitIndex, rank } = identity;

	// Unknown card in our hand, return average of possibilities
	if (suitIndex === -1 && rank === -1 && order !== -1) {
		const card = player.thoughts[order];
		return card.possible.reduce((sum, curr) => sum += cardValue(state, player, curr), 0) / card.possible.length;
	}

	// Basic trash, saved already, duplicate visible
	if (isTrash(state, player, identity, order) || visibleFind(state, player, identity).length > 1)
		return 0;

	if (isCritical(state, identity))
		return 5;

	if (save2(state, player, identity))
		return 4;

	// Next playable rank is value 4, rank 4 with nothing on the stack is value 1
	return 5 - (rank - player.hypo_stacks[suitIndex]);
}

/**
 * Generates a list of clues that would touch the card.
 * @param {State} state
 * @param {number} target
 * @param {Identity} card
 * @param {{ excludeColour?: boolean, excludeRank?: boolean, save?: boolean }} [options] 	Any additional options.
 */
export function direct_clues(state, target, card, options) {
	const direct_clues = [];

	if (!options?.excludeColour) {
		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			const clue = { type: CLUE.COLOUR, value: suitIndex, target };

			if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue))
				direct_clues.push(clue);
		}
	}

	if (!options?.excludeRank) {
		for (let rank = 1; rank <= 5; rank++) {
			const clue = { type: CLUE.RANK, value: rank, target };

			if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue))
				direct_clues.push(clue);
		}
	}

	return direct_clues;
}

/**
 * Finds the index to the right referred to by the given index.
 * @param  {Hand} hand
 * @param  {number} index
 */
export function refer_right(hand, index) {
	let target_index = (index + 1) % hand.length;

	while (hand[target_index].clued && !hand[target_index].newly_clued)
		target_index = (target_index + 1) % hand.length;

	return target_index;
}
