import { isTrash } from '../../basics/hanabi-util.js';
import { team_elim, undo_hypo_stacks } from '../../basics/helper.js';
import { find_sarcastics, interpret_sarcastic } from '../shared/sarcastic.js';
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
 * Interprets a sarcastic discard.
 * 
 * Impure! (modifies common)
 * @param {Game} game
 * @param {DiscardAction} discardAction
 * @returns {number[]} 					The targets for the sarcastic discard
 */
export function interpret_rs_sarcastic(game, discardAction) {
	const { common, me, state } = game;
	const { playerIndex, suitIndex, rank } = discardAction;
	const identity = { suitIndex, rank };

	if (!state.isPlayable(identity))
		return interpret_sarcastic(game, discardAction);

	// Sarcastic discard to other (or known sarcastic discard to us)
	for (let i = 0; i < state.numPlayers; i++) {
		const receiver = (state.ourPlayerIndex + i) % state.numPlayers;

		// Can't sarcastic to self
		if (receiver === playerIndex)
			continue;

		const sarcastics = find_sarcastics(state, receiver, common, identity);
		const sarcastic_target = Math.min(...sarcastics);

		if (sarcastics.length > 0 && me.thoughts[sarcastic_target].matches(identity, { infer: receiver === state.ourPlayerIndex })) {
			common.updateThoughts(sarcastics[0], (draft) => { draft.inferred = state.base_ids.union(identity); });
			logger.info(`writing ${logCard(identity)} from sarcastic discard`);
			return [sarcastic_target];
		}
	}

	const sarcastics = find_sarcastics(state, state.ourPlayerIndex, me, identity);
	const sarcastic_target = Math.min(...sarcastics);
	if (sarcastics.length > 0) {
		common.updateThoughts(sarcastic_target, (common_sarcastic) => {
			common_sarcastic.inferred = state.base_ids.union(identity);
			common_sarcastic.trash = false;
		});
		logger.info(`writing sarcastic ${logCard(identity)} on slot ${state.ourHand.findIndex(o => o === sarcastic_target) + 1}`);
		return [sarcastic_target];
	}

	logger.warn(`couldn't find a valid target for sarcastic discard`);
	return [];
}

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
	if (state.deck[order].clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		common.restore_elim(state.deck[order]);

		// Card was bombed
		if (failed)
			undo_hypo_stacks(game, identity);
		else
			interpret_rs_sarcastic(game, action);
	}

	if (state.numPlayers === 2) {
		const partner = state.nextPlayerIndex(playerIndex);

		// Discarding while partner is locked and having a playable card
		if (common.thinksLocked(state, partner)) {
			const playables = common.thinksPlayables(state, playerIndex);

			for (const order of playables)
				game.locked_shifts[order] = (game.locked_shifts[order] ?? 0) + 1;
		}

		// No safe action, chop has permission to discard
		if (!common.thinksLoaded(state, partner) && !state.hands[partner].some(o => common.thoughts[o].called_to_discard)) {
			common.updateThoughts(state.hands[partner][0], (chop) => {
				chop.permission_to_discard = true;
			});
		}
	}
	else {
		for (const o of state.hands[playerIndex]) {
			if (common.thoughts[o].called_to_discard) {
				common.updateThoughts(o, (draft) => {
					draft.called_to_discard = false;
				});
			}
		}
	}

	common.good_touch_elim(state);
	common.refresh_links(state);
	team_elim(game);
}
