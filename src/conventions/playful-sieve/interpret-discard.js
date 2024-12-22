import { isTrash } from '../../basics/hanabi-util.js';
import { undo_hypo_stacks } from '../../basics/helper.js';
import { interpret_sarcastic } from '../shared/sarcastic.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} Game
 * @typedef {import('../../basics/Player.js').Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 */

/**
 * Interprets (writes notes) for a discard of the given card.
 * 
 * Impure!
 * @param {Game} game
 * @param {DiscardAction} action
 */
export function interpret_discard(game, action) {
	const { common, me, state } = game;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };

	const other = state.nextPlayerIndex(playerIndex);
	const other_had_trash = common.thinksTrash(state, other).length > 0;

	Basics.onDiscard(this, action);

	const thoughts = common.thoughts[order];

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && (failed || (!state.hasConsistentInferences(thoughts) && !isTrash(state, me, state.deck[order], order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = thoughts.drawn_index;
		const new_game = game.rewind(action_index, [{ type: 'identify', order, playerIndex, identities: [identity] }], thoughts.finessed);
		if (new_game) {
			new_game.updateNotes();
			Object.assign(game, new_game);
			return;
		}
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (state.deck[order].clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		common.restore_elim(state.deck[order]);

		// Card was bombed
		if (failed)
			undo_hypo_stacks(game, identity);
		else
			interpret_sarcastic(game, action);
	}

	// Discarding while partner is locked and having a playable card
	if (common.thinksLocked(state, other)) {
		const playables = common.thinksPlayables(state, playerIndex);

		for (const order of playables)
			game.locked_shifts[order] = (game.locked_shifts[order] ?? 0) + 1;
	}

	// No safe action, chop is playable
	if (!common.thinksLocked(state, other) &&
		common.thinksPlayables(state, other).length == 0 &&
		!other_had_trash &&
		!state.hands[other].some(o => common.thoughts[o].called_to_discard)
	) {
		const playable_possibilities = state.play_stacks.map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});

		// Unsure why here?
		// if (common.thoughts[card.order].inferred.length === 1)
		// 	playable_possibilities[suitIndex] = { suitIndex, rank: rank + 1 };

		common.updateThoughts(state.hands[other][0], (chop) => {
			chop.old_inferred = chop.inferred;
			chop.finessed = true;
			chop.inferred = chop.inferred.intersect(playable_possibilities);
		});
	}
}
