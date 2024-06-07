import { cardValue, isTrash } from '../../basics/hanabi-util.js';
import { team_elim, undo_hypo_stacks } from '../../basics/helper.js';
import { interpret_sarcastic } from '../shared/sarcastic.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';
import { LEVEL } from './h-constants.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 */

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {ActualCard} card
 */
export function interpret_discard(game, action, card) {
	const { common, state, me } = game;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };
	const thoughts = common.thoughts[order];
	const before_trash = common.thinksTrash(state, playerIndex);
	const old_chop = common.chop(state.hands[playerIndex]);

	Basics.onDiscard(game, action);

	const to_remove = [];
	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { connections, conn_index, inference, action_index } = common.waiting_connections[i];

		const dc_conn_index = connections.findIndex((conn, index) => index >= conn_index && conn.card.order === order);
		if (dc_conn_index === -1)
			continue;

		if (failed && game.finesses_while_finessed[playerIndex].some(c => c.matches({ suitIndex, rank }))) {
			logger.info('bombed duplicated card from finessing while finessed');
			action.intentional = true;
			continue;
		}

		const { card } = connections[dc_conn_index];
		logger.info(`discarded connecting card ${logCard(card)}, cancelling waiting connection for inference ${logCard(inference)}`);

		to_remove.push(i);

		// Another waiting connection exists for this, can ignore
		if (common.waiting_connections.some((wc, index) => action_index === wc.action_index && !to_remove.includes(index)))
			continue;

		// Check if sarcastic
		if (card.clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex] && !failed) {
			const sarcastics = interpret_sarcastic(game, action);

			// Sarcastic, rewrite connection onto this person
			if (sarcastics.length === 1) {
				logger.info('rewriting connection to use sarcastic on order', sarcastics[0].order);
				Object.assign(connections[dc_conn_index], {
					reacting: state.hands.findIndex(hand => hand.findOrder(sarcastics[0].order)),
					card: sarcastics[0]
				});
				to_remove.pop();
				continue;
			}
		}

		const real_connects = connections.filter((conn, index) => index < dc_conn_index && !conn.hidden).length;
		game.rewind(action_index, { type: 'ignore', conn_index: real_connects, order, inference });
		return;
	}

	if (to_remove.length > 0)
		common.waiting_connections = common.waiting_connections.filter((_, index) => !to_remove.includes(index));

	// End early game?
	if (state.early_game && !action.failed && !card.clued) {
		logger.warn('ending early game from discard of', logCard(card));
		state.early_game = false;
	}

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && playerIndex === state.ourPlayerIndex && (failed || (!state.hasConsistentInferences(thoughts) && !isTrash(state, me, card, card.order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = card.drawn_index;
		game.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, thoughts.finessed);
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
			undo_hypo_stacks(game, identity);
		else
			interpret_sarcastic(game, action);
	}

	if (game.level >= LEVEL.LAST_RESORTS && !action.failed) {
		const result = check_sdcm(game, action, before_trash, old_chop);

		if (result !== undefined) {
			const nextPlayerIndex = (playerIndex + 1) % state.numPlayers;
			const chop = common.chop(state.hands[nextPlayerIndex]);

			logger.info(`interpreted ${result}!`);

			if (result === 'scream' || result === 'shout') {
				state.screamed_at = true;

				if (chop === undefined)
					logger.warn(`${state.playerNames[nextPlayerIndex]} has no chop!`);
				else
					common.thoughts[chop.order].chop_moved = true;
			}
		}
	}

	team_elim(game);
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {ActualCard[]} before_trash
 * @param {ActualCard} old_chop
 * @returns {'scream' | 'shout' | 'generation' | undefined}
 */
function check_sdcm(game, action, before_trash, old_chop) {
	const { common, state } = game;
	const { order, playerIndex, suitIndex, rank } = action;
	const nextPlayerIndex = (playerIndex + 1) % state.numPlayers;
	const nextPlayerIndex2 = (nextPlayerIndex + 1) % state.numPlayers;

	// Forced discard for locked hand
	if (common.thinksLocked(state, nextPlayerIndex) && state.clue_tokens === 1)
		return;

	const scream = state.clue_tokens === 1 && old_chop &&
		(common.thinksPlayables(state, playerIndex, {assume: true}).length > 0 || before_trash.length > 0) && order === old_chop.order;

	const shout = common.thinksPlayables(state, playerIndex, {assume: true}).length > 0 && before_trash.some(c => c.order === order) && isTrash(state, common, { suitIndex, rank }, order, { infer: true });

	if (!scream && !shout)
		return;

	if (state.numPlayers === 2)
		return scream ? 'scream' : 'shout';

	if (common.thinksLoaded(state, nextPlayerIndex, {assume: true})) {
		logger.warn(`${state.playerNames[playerIndex]} discarded with a playable/kt at 0 clues but next players was safe! (echo?)`);
		return 'generation';
	}

	const next2Chop = common.chop(state.hands[nextPlayerIndex2]);

	if (next2Chop === undefined)
		return 'scream';

	// We can see that a scream is impossible
	if (nextPlayerIndex2 === state.ourPlayerIndex && common.chopValue(state, nextPlayerIndex) < 4)
		return 'generation';

	const next2ChopValue = cardValue(state, game.players[playerIndex], state.deck[next2Chop.order], next2Chop.order);

	if (next2ChopValue < 4)
		return scream ? 'scream' : 'shout';

	return 'generation';
}
