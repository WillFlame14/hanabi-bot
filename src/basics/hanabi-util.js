import { cardCount } from '../variants.js';

/**
 * @typedef {import('./Game.js').Game} Game
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
 * @returns {ActualCard[]}
 */
export function visibleFind(state, player, identity, options = {}) {
	if (player.playerIndex === state.ourPlayerIndex)
		options.infer = options.infer ?? true;

	return Array.from(state.hands.reduce((cards, hand, index) => {
		if (options.ignore?.includes(index))
			return cards;

		const symmetric = options.symmetric ?? index === player.playerIndex;

		return cards.concat(hand.filter(c =>
			player.thoughts[c.order].matches(identity, Object.assign({}, options, { symmetric } ))));
	}, []));
}

/**
 * Returns the number of cards still unknown that could be this identity according to a player.
 * @param {State} state
 * @param {Player} player
 * @param {Identity} identity
 */
export function unknownIdentities(state, player, identity) {
	const visibleCount = state.hands.flat().filter(c => player.thoughts[c.order].matches(identity)).length;
	return cardCount(state.variant, identity) - state.baseCount(identity) - visibleCount;
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
 * @param {MatchOptions & {ignoreCM?: boolean}} [options]
 */
export function isTrash(state, player, identity, order = -1, options = {}) {
	return state.isBasicTrash(identity) || isSaved(state, player, identity, order, options);
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

	if (state.isCritical(identity))
		return 5;

	if (save2(state, player, identity))
		return 4;

	// Next playable rank is value 4, rank 4 with nothing on the stack is value 1
	return 5 - (rank - player.hypo_stacks[suitIndex]);
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
