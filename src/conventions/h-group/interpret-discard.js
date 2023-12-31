import { isTrash, playableAway, visibleFind } from '../../basics/hanabi-util.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';
import { team_elim } from '../../basics/helper.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 */

/**
 * Returns the cards in hand that could be targets for a sarcastic discard.
 * @param {Hand} hand
 * @param {Player} player
 * @param {Identity} identity
 */
function find_sarcastic(hand, player, identity) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = hand.filter(c => player.thoughts[c.order].matches(identity, { infer: true }));
	if (known_sarcastic.length > 0) {
		return known_sarcastic;
	}
	// Otherwise, find all cards that could match that identity
	return Array.from(hand.filter(c => {
		const card = player.thoughts[c.order];

		return c.clued && card.possible.some(p => p.matches(identity)) &&
			!(card.inferred.length === 1 && card.inferred[0].rank < identity.rank);		// Do not sarcastic on connecting cards
	}));
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {State} state
 * @param {Identity} identity
 */
function undo_hypo_stacks(state, { suitIndex, rank }) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	for (const hypo_stacks of state.common.hypo_stacks) {
		if (hypo_stacks[suitIndex] >= rank) {
			hypo_stacks[suitIndex] = rank - 1;
		}
	}
}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {State} state
 * @param {ActualCard[]} sarcastic
 * @param {Identity} identity
 */
function apply_unknown_sarcastic(state, sarcastic, identity) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const { order } of sarcastic) {
		state.common.thoughts[order].union('inferred', [identity]);
	}

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(({ order }) => state.common.thoughts[order].inferred.some(c => playableAway(state, c) > 0))) {
		undo_hypo_stacks(state, identity);
	}
}

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {State} state
 * @param {import('../../types.js').DiscardAction} action
 * @param {ActualCard} card
 */
export function interpret_discard(state, action, card) {
	const { common } = state;
	const { order, playerIndex, suitIndex, rank,  failed } = action;
	const identity = { suitIndex, rank };
	const thoughts = common.thoughts[order];

	Basics.onDiscard(state, action);

	const to_remove = [];
	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { connections, conn_index, inference, action_index } = common.waiting_connections[i];

		const dc_conn_index = connections.findIndex((conn, index) => index >= conn_index && conn.card.order === order);
		if (dc_conn_index !== -1) {
			const { card, reacting } = connections[dc_conn_index];
			logger.info(`discarded connecting card ${logCard(card)}, cancelling waiting connection for inference ${logCard(inference)}`);

			to_remove.push(i);

			// No other waiting connections exist for this
			if (!common.waiting_connections.some((wc, index) => action_index === wc.action_index && !to_remove.includes(index))) {
				const real_connects = connections.filter((conn, index) => index < dc_conn_index && !conn.hidden).length;
				state.rewind(action_index, { type: 'ignore', playerIndex: reacting, conn_index: real_connects });
				return;
			}
		}
	}

	if (to_remove.length > 0) {
		common.waiting_connections = common.waiting_connections.filter((_, index) => !to_remove.includes(index));
	}

	// End early game?
	if (state.early_game && !action.failed && !card.clued) {
		logger.warn('ending early game from discard of', logCard(card));
		state.early_game = false;
	}

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && (failed || (!thoughts.matches_inferences() && !isTrash(state, state.me, card, card.order)))) {
		logger.info('all inferences', thoughts.inferred.map(c => logCard(c)));

		const action_index = card.drawn_index;
		state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, thoughts.finessed);
		return;
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (card.clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		const duplicates = visibleFind(state, state.me, identity);

		// Card was bombed
		if (failed) {
			undo_hypo_stacks(state, identity);
		}
		else {
			// Unknown sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], state.me, identity);

				if (sarcastic.length === 1) {
					const action_index = sarcastic[0].drawn_index;
					if (!state.common.thoughts[sarcastic[0].order].rewinded && state.rewind(action_index, { type: 'identify', order: sarcastic[0].order, playerIndex: state.ourPlayerIndex, suitIndex, rank, infer: true })) {
						return;
					}
					else {
						logger.warn('rewind failed, not writing any inferences from discard');
					}
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, identity);
				}
			}
			// Sarcastic discard to other (or known sarcastic discard to us)
			else {
				for (let i = 0; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], state.me, identity);

					if (sarcastic.some(c => state.me.thoughts[c.order].matches(identity, { infer: receiver === state.ourPlayerIndex }) && c.clued)) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							state.common.thoughts[sarcastic[0].order].assign('inferred', [identity]);
							logger.info(`writing ${logCard(identity)} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, identity);
							logger.info('unknown sarcastic');
						}
						return;
					}
				}
				logger.warn(`couldn't find a valid target for sarcastic discard`);
			}
		}
	}

	team_elim(state);
}
