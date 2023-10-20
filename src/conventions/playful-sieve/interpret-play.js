import { CLUE } from '../../constants.js';
import { Card } from '../../basics/Card.js';
import { Hand } from '../../basics/Hand.js';
import { recursive_elim, update_hypo_stacks } from '../../basics/helper.js';
import { playableAway } from '../../basics/hanabi-util.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * Determines the unlocked card, given a play action and the unlocked and locked hands.
 * @param  {State} state
 * @param  {PlayAction} action
 * @param  {number} unlocked_player
 * @param  {number} locked_player
 * @param  {number} locked_shifts
 * @returns {Card | undefined} The unlocked card, or undefined if the unlock is not guaranteed.
 */
export function unlock_promise(state, action, unlocked_player, locked_player, locked_shifts) {
	const { playerIndex, order, suitIndex, rank } = action;
	const card = state.hands[playerIndex].findOrder(order);

	// Playing an unknown card doesn't unlock
	if (card.identity({ symmetric: true, infer: true }) === undefined) {
		logger.highlight('cyan', 'playing unknown card, not unlocking');
		return;
	}

	const playables = Hand.find_playables(state, unlocked_player);

	// Sorted from oldest to newest
	const playables_sorted = playables.sort((a, b) => a.reasoning.at(-1) - b.reasoning.at(-1));

	// Playing oldest (or only) playable, not guaranteed unlock
	if (Hand.find_known_trash(state, unlocked_player).length + state.hands[unlocked_player].filter(c => c.called_to_discard).length === 0 &&
		card.order === playables_sorted[0].order
	) {
		logger.highlight('cyan', 'playing oldest/only safe playable, not unlocking');

		// All other known playables get shifted
		for (const card of playables_sorted.slice(1).filter(card => card.identity({ symmetric: true, infer: true }) !== undefined)) {
			state.locked_shifts[card.order] = (state.locked_shifts[card.order] ?? 0) + 1;
		}
		return;
	}

	const locked_hand = state.hands[locked_player];

	// Known connecting card
	const match = locked_hand.find(card => card.matches({ suitIndex, rank: rank + 1 }, { infer: true, symmetric: true }));
	if (match) {
		return match;
	}

	const possible_matches = locked_hand.filter(card => card.clued && card.clues.some(clue =>
		(clue.type === CLUE.RANK && clue.value === rank + 1) ||
		(clue.type === CLUE.COLOUR && clue.value === suitIndex))
	).map(c => c.order);

	let shifts = 0;

	for (let i = locked_hand.length - 1; i >= 0; i--) {
		const card = locked_hand[i];

		// Looks like a connection
		if (card.inferred.some(inf => inf.matches({ suitIndex, rank: rank + 1 })) &&
			(possible_matches.length === 0 || possible_matches.some(order => card.order === order) || shifts >= possible_matches.length)
		) {
			if (shifts < locked_shifts) {
				shifts++;
				continue;
			}
			return card;
		}
	}

	// No connections found
	return;
}

/**
 * @param  {State} state
 * @param  {PlayAction} action
 */
export function interpret_play(state, action) {
	const { playerIndex, order, suitIndex, rank } = action;
	const identity = { suitIndex, rank };

	const hand = state.hands[playerIndex];
	const other = (playerIndex + 1) % state.numPlayers;
	const other_hand = state.hands[other];

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex) {
		const card = hand.findOrder(order);
		if ((card.inferred.length !== 1 || !card.inferred[0].matches(identity)) && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			if (state.rewind(card.drawn_index, { type: 'identify', order, playerIndex, suitIndex, rank })) {
				return;
			}
		}
	}

	const card = state.hands[playerIndex].findOrder(order);

	const locked_shifts = state.locked_shifts[card.order];
	if (locked_shifts !== undefined) {
		delete state.locked_shifts[card.order];
	}

	const known_connecting = card.inferred.every(inf => other_hand.some(c =>
		c.inferred.every(i => playableAway(state, i) === 0 || (i.suitIndex === inf.suitIndex && playableAway(state, i) === 1))));

	// No safe action, chop is playable
	if (!Hand.isLocked(state, other) && !Hand.isLoaded(state, other) && !other_hand.some(c => c.called_to_discard) && !known_connecting && state.clue_tokens > 0) {
		const playable_possibilities = [{ suitIndex, rank: rank + 1 }].concat(state.play_stacks.map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		}));
		other_hand[0].finessed = true;
		other_hand[0].intersect('inferred', playable_possibilities);
	}

	if (Hand.isLocked(state, other)) {
		const unlocked = unlock_promise(state, action, playerIndex, other, locked_shifts);

		if (unlocked) {
			const connecting = { suitIndex, rank: rank + 1 };
			const slot = other_hand.findIndex(c => c.order === unlocked.order) + 1;

			// Unlocked player might have another card connecting to this
			if (hand.some(card => card.identity({ infer: true, symmetric: true })?.matches(connecting)) &&
				other_hand.some(card => card.inferred.some(c => c.suitIndex === suitIndex && c.rank > rank + 1))) {
				logger.info(`unlocked player may have connecting ${logCard(connecting)}, not unlocking yet`);
			}
			else {
				if (!unlocked.inferred.some(c => c.matches(connecting))) {
					logger.warn('no inferred connecting card!');

					if (unlocked.possible.some(c => c.matches(connecting))) {
						logger.info(`overwriting slot ${slot} as ${logCard(connecting)} from possiilities`);
						unlocked.assign('inferred', [connecting]);
					}
					else {
						logger.warn('ignoring unlock promise');
					}
				}
				else {
					unlocked.intersect('inferred', [connecting]);
					logger.info(`unlocking slot ${slot} as ${logCard(connecting)}`);
					state.locked_shifts = [];
				}
			}
		}
		else {
			logger.info('failed to unlock');

			// Shift all other playable cards
			for (const card of Hand.find_playables(state, playerIndex)) {
				if (card.order === order) {
					continue;
				}
				state.locked_shifts[card.order] = (state.locked_shifts[card.order] ?? 0) + 1;
			}
		}
	}
	else {
		state.locked_shifts = [];
	}

	Basics.onPlay(this, action);

	// Apply good touch principle on remaining possibilities
	for (let i = 0; i < state.numPlayers; i++) {
		recursive_elim(state, i, identity);
	}

	// Resolve any links after playing
	Basics.refresh_links(state, playerIndex);

	// Update hypo stacks
	update_hypo_stacks(this);
}
