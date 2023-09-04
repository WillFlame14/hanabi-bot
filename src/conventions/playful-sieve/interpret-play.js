import { recursive_elim, update_hypo_stacks } from '../../basics/helper.js';

import * as Basics from '../../basics.js';
import logger from '../../tools/logger.js';
import { CLUE } from '../../constants.js';
import { logCard } from '../../tools/log.js';
import { playableAway } from '../../basics/hanabi-util.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * Determines the unlocked card, given a play action and the unlocked and locked hands.
 * @param  {State} state
 * @param  {PlayAction} action
 * @param  {Hand} unlocked_hand
 * @param  {Hand} locked_hand
 * @returns {Card | undefined} The unlocked card, or undefined if the unlock is not guaranteed.
 */
export function unlock_promise(state, action, unlocked_hand, locked_hand) {
	const { playerIndex, order, suitIndex, rank } = action;
	const card = state.hands[playerIndex].findOrder(order);

	// Playing an unknown card doesn't unlock
	if (card.identity({ symmetric: true, infer: true }) === undefined) {
		return;
	}

	const playables = unlocked_hand.find_playables();

	// Sorted from oldest to newest
	const playables_sorted = playables.sort((a, b) => a.reasoning.at(-1) - b.reasoning.at(-1));

	// Playing oldest (or only) playable, not guaranteed unlock
	if (unlocked_hand.find_known_trash().length + unlocked_hand.filter(c => c.called_to_discard).length === 0 &&
		card.order === playables_sorted[0].order
	) {
		return;
	}

	// Known connecting card
	const match = locked_hand.find(card => card.matches(suitIndex, rank + 1, { infer: true }));
	if (match) {
		return match;
	}

	let shifts = 0;

	for (let i = locked_hand.length - 1; i >= 0; i--) {
		const card = locked_hand[i];

		// Looks like a direct connection
		if (card.inferred.length > 1 && card.clued && card.clues.some(clue =>
			(clue.type === CLUE.RANK && clue.value === rank + 1) ||
			(clue.type === CLUE.COLOUR && clue.value === suitIndex)
		)) {
			if (shifts < state.locked_shifts) {
				shifts++;
				continue;
			}

			return card;
		}
	}

	// No direct connections found
	return;

	// We have a known card in the same suitIndex, doesn't necessarily unlock
	// const sameSuit = our_hand.find(card =>
	// 	card.clued &&
	// 	card.clues.some(clue => clue.type === CLUE.COLOUR && clue.value === suitIndex) &&
	// 	card.inferred.some(i => i.rank > rank + 1)
	// );
	// if (sameSuit) {
	// 	return;
	// }
}

/**
 * @param  {State} state
 * @param  {PlayAction} action
 */
export function interpret_play(state, action) {
	const { playerIndex, order, suitIndex, rank } = action;

	const our_hand = state.hands[state.ourPlayerIndex];
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex) {
		const card = our_hand.findOrder(order);
		if ((card.inferred.length !== 1 || !card.inferred[0].matches(suitIndex, rank)) && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			if (state.rewind(card.drawn_index, { type: 'identify', order, playerIndex, suitIndex, rank })) {
				return;
			}
		}
	}

	const card = state.hands[playerIndex].findOrder(order);

	const known_connecting = card.inferred.every(inf => our_hand.some(c =>
		c.inferred.every(i => playableAway(state, i.suitIndex, i.rank) === 0 ||
			(i.suitIndex === inf.suitIndex && playableAway(state, i.suitIndex, i.rank) === 1))
	));

	// No safe action, chop is playable
	if (!our_hand.isLoaded() && !our_hand.some(c => c.called_to_discard) && !known_connecting) {
		const playable_possibilities = state.hypo_stacks[partner].map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});
		our_hand[0].finessed = true;
		our_hand[0].intersect('inferred', playable_possibilities);
	}

	if (our_hand.isLocked() && playerIndex === partner &&
		partner_hand.findOrder(order).identity({ symmetric: true, infer: true }) !== undefined
	) {
		const unlocked = unlock_promise(state, action, partner_hand, our_hand);

		if (unlocked) {
			unlocked.intersect('inferred', [{ suitIndex, rank: rank + 1 }]);
			logger.info('unlocking slot', our_hand.findIndex(c => c.order === unlocked.order) + 1, 'as', logCard({ suitIndex, rank: rank + 1}));
		}
		else {
			logger.info('failed to unlock');
		}
	}

	Basics.onPlay(this, action);

	// Apply good touch principle on remaining possibilities
	for (let i = 0; i < state.numPlayers; i++) {
		recursive_elim(state, i, suitIndex, rank);
	}

	// Resolve any links after playing
	state.hands[playerIndex].refresh_links();

	// Update hypo stacks
	update_hypo_stacks(this);
}
