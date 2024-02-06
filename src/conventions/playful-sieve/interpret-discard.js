import { isTrash } from '../../basics/hanabi-util.js';
import { undo_hypo_stacks } from '../../basics/helper.js';
import { interpret_sarcastic } from '../shared/sarcastic.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 */

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {State} state
 * @param {import('../../types.js').DiscardAction} action
 * @param {ActualCard} card
 */
export function interpret_discard(state, action, card) {
	const { common } = state;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };
	const thoughts = common.thoughts[order];
	const other = (playerIndex + 1) % state.numPlayers;

	Basics.onDiscard(this, action);

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && (failed || (!thoughts.matches_inferences() && !isTrash(state, state.me, card, card.order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = card.drawn_index;
		state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, thoughts.finessed);
		return;
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (card.clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		common.restore_elim(card);

		// Card was bombed
		if (failed)
			undo_hypo_stacks(state, identity);
		else
			interpret_sarcastic(state, action);
	}

	// Discarding while partner is locked and having a playable card
	if (common.thinksLocked(state, other)) {
		const playables = common.thinksPlayables(state, playerIndex);

		for (const card of playables)
			state.locked_shifts[card.order] = (state.locked_shifts[card.order] ?? 0) + 1;
	}

	// No safe action, chop is playable
	if (!common.thinksLocked(state, other) && !common.thinksLoaded(state, other) && !state.hands[other].some(c => common.thoughts[c.order].called_to_discard)) {
		const playable_possibilities = state.play_stacks.map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});

		// Unsure why here?
		// if (common.thoughts[card.order].inferred.length === 1)
		// 	playable_possibilities[suitIndex] = { suitIndex, rank: rank + 1 };

		const chop = common.thoughts[state.hands[other][0].order];
		chop.old_inferred = chop.inferred.slice();
		chop.finessed = true;
		chop.intersect('inferred', playable_possibilities);
	}
}
