import { CLUE } from '../../constants.js';
import { IdentitySet } from '../../basics/IdentitySet.js';
import { team_elim } from '../../basics/helper.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').PlayAction} PlayAction
 */

/**
 * Determines the unlocked card, given a play action and the unlocked and locked hands.
 * @param  {Game} game
 * @param  {PlayAction} action
 * @param  {number} unlocked_player
 * @param  {number} locked_player
 * @param  {number} locked_shifts
 * @returns {number | undefined} The unlocked card order, or undefined if the unlock is not guaranteed.
 */
export function unlock_promise(game, action, unlocked_player, locked_player, locked_shifts = 0) {
	const { common, state } = game;
	const { order, suitIndex, rank } = action;

	// Playing an unknown card doesn't unlock
	if (common.thoughts[order].identity({ infer: true }) === undefined) {
		logger.highlight('cyan', 'playing unknown card, not unlocking');
		return;
	}

	const playables = common.thinksPlayables(state, unlocked_player);

	// Sorted from oldest to newest
	const playables_sorted = playables.sort((a, b) => common.thoughts[a.order].reasoning.at(-1) - common.thoughts[b.order].reasoning.at(-1));

	// Playing oldest (or only) playable, not guaranteed unlock
	if (common.thinksTrash(state, unlocked_player).length + state.hands[unlocked_player].filter(c => common.thoughts[c.order].called_to_discard).length === 0 &&
		order === playables_sorted[0].order
	) {
		logger.highlight('cyan', 'playing oldest/only safe playable, not unlocking');

		// All other known playables get shifted
		for (const card of playables_sorted.slice(1).filter(card => common.thoughts[card.order].identity({ infer: true }) !== undefined))
			game.locked_shifts[card.order] = (game.locked_shifts[card.order] ?? 0) + 1;

		return;
	}

	const locked_hand = state.hands[locked_player];

	// Known connecting card
	const match = locked_hand.find(card => common.thoughts[card.order].matches({ suitIndex, rank: rank + 1 }, { infer: true }));
	if (match)
		return match.order;

	const possible_matches = locked_hand.filter(card => card.clued && card.clues.some(clue =>
		(clue.type === CLUE.RANK && clue.value === rank + 1) ||
		(clue.type === CLUE.COLOUR && clue.value === suitIndex))
	).map(c => c.order);

	let shifts = 0;

	for (let i = locked_hand.length - 1; i >= 0; i--) {
		const card = common.thoughts[locked_hand[i].order];

		// Looks like a connection
		if (card.inferred.has({ suitIndex, rank: rank + 1 }) &&
			(possible_matches.length === 0 || possible_matches.some(order => card.order === order) || shifts >= possible_matches.length)
		) {
			if (shifts < locked_shifts) {
				shifts++;
				continue;
			}
			return card.order;
		}
	}

	// No connections found
	return;
}

/**
 * @param  {Game} game
 * @param  {PlayAction} action
 */
export function interpret_play(game, action) {
	const { common, state } = game;
	const { playerIndex, order, suitIndex, rank } = action;
	const identity = { suitIndex, rank };

	const hand = state.hands[playerIndex];
	const other = (playerIndex + 1) % state.numPlayers;
	const other_hand = state.hands[other];

	const card = common.thoughts[order];

	// Now that we know about this card, rewind from when the card was drawn
	if (playerIndex === state.ourPlayerIndex) {
		if ((card.inferred.length !== 1 || !card.inferred.array[0].matches(identity)) && !card.rewinded) {
			// If the rewind succeeds, it will redo this action, so no need to complete the rest of the function
			const new_game = game.rewind(card.drawn_index, [{ type: 'identify', order, playerIndex, identities: [identity] }]);
			if (new_game) {
				Object.assign(game, new_game);
				return;
			}
		}
	}

	const locked_shifts = game.locked_shifts[card.order];
	if (locked_shifts !== undefined)
		delete game.locked_shifts[card.order];

	const known_connecting = card.inferred.every(inf => other_hand.some(c =>
		common.thoughts[c.order].inferred.every(i => state.isPlayable(i) || (i.suitIndex === inf.suitIndex && state.playableAway(i) === 1))));

	// No safe action, chop is playable
	if (!common.thinksLocked(state, other) &&
		!common.thinksLoaded(state, other) &&
		!other_hand.some(c => common.thoughts[c.order].called_to_discard) &&
		!known_connecting && state.clue_tokens > 0
	) {
		const playable_possibilities = state.play_stacks.map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});

		if (common.thoughts[card.order].inferred.length === 1)
			playable_possibilities[suitIndex] = { suitIndex, rank: rank + 1 };

		const chop = common.thoughts[other_hand[0].order];
		chop.old_inferred = chop.inferred;
		chop.finessed = true;
		chop.inferred = chop.inferred.intersect(playable_possibilities);
	}
	else if (common.thinksLocked(state, other)) {
		const unlocked_order = unlock_promise(game, action, playerIndex, other, locked_shifts);

		if (unlocked_order !== undefined) {
			const connecting = { suitIndex, rank: rank + 1 };
			const slot = other_hand.findIndex(c => c.order === unlocked_order) + 1;

			// Unlocked player might have another card connecting to this
			if (hand.some(card => common.thoughts[card.order].identity({ infer: true })?.matches(connecting)) &&
				other_hand.some(card => common.thoughts[card.order].inferred.some(c => c.suitIndex === suitIndex && c.rank > rank + 1))
			) {
				logger.info(`unlocked player may have connecting ${logCard(connecting)}, not unlocking yet`);
			}
			else {
				const unlocked = common.thoughts[unlocked_order];
				if (!unlocked.inferred.has(connecting)) {
					logger.warn('no inferred connecting card!');

					if (unlocked.possible.has(connecting)) {
						logger.info(`overwriting slot ${slot} as ${logCard(connecting)} from possiilities`);
						unlocked.inferred = IdentitySet.create(state.variant.suits.length, connecting);
					}
					else {
						logger.warn('ignoring unlock promise');
					}
				}
				else {
					unlocked.inferred = unlocked.inferred.intersect(connecting);
					logger.info(`unlocking slot ${slot} as ${logCard(connecting)}`);
					game.locked_shifts = [];
				}
			}
		}
		else {
			logger.info('failed to unlock');

			// Shift all other playable cards
			for (const card of common.thinksPlayables(state, playerIndex)) {
				if (card.order === order)
					continue;

				game.locked_shifts[card.order] = (game.locked_shifts[card.order] ?? 0) + 1;
			}
		}
	}
	else {
		game.locked_shifts = [];
	}

	Basics.onPlay(this, action);

	common.good_touch_elim(state);

	// Resolve any links after playing
	common.refresh_links(state);

	// Update hypo stacks
	team_elim(game);
}
