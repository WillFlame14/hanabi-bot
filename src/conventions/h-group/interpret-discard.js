import { LEVEL } from './h-constants.js';
import { cardValue, isTrash } from '../../basics/hanabi-util.js';
import { team_elim, undo_hypo_stacks } from '../../basics/helper.js';
import { interpret_sarcastic } from '../shared/sarcastic.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';
import { getRealConnects } from './hanabi-logic.js';
import { check_ocm } from './interpret-play.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Connection} Connection
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

	const before_trash = common.thinksTrash(state, playerIndex).filter(c => common.thoughts[c.order].saved);
	const old_chop = common.chop(state.hands[playerIndex]);
	const slot = state.hands[playerIndex].findIndex(c => c.order === order) + 1;

	if (game.level >= LEVEL.BASIC_CM && rank === 1 && failed)
		check_ocm(game, action);

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

		const real_connects = getRealConnects(connections, dc_conn_index);
		const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: real_connects, order, inference }]);
		if (new_game) {
			Object.assign(game, new_game);
			return;
		}
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
		const new_game = game.rewind(action_index, [{ type: 'identify', order, playerIndex, identities: [{ suitIndex, rank }] }], thoughts.finessed);
		if (new_game) {
			Object.assign(game, new_game);
			return;
		}
	}

	let sarcastic_targets;

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		if (card.clued) {
			logger.warn('discarded useful clued card!');
			common.restore_elim(card);

			// Card was bombed
			if (failed)
				undo_hypo_stacks(game, identity);
			else
				sarcastic_targets = interpret_sarcastic(game, action);
		}

		if (!(sarcastic_targets?.length > 0) && game.level >= LEVEL.STALLING) {
			// If there is only one of this card left and it could be in the next player's chop,
			// they are to be treated as in double discard avoidance.
			const nextPlayerIndex = (playerIndex + 1) % state.numPlayers;
			const chop = common.chop(state.hands[nextPlayerIndex]);

			if (state.isCritical({ suitIndex, rank }) && common.thoughts[chop?.order]?.possible.has(card.identity()))
				state.dda = card.identity();
		}
	}

	if (game.level >= LEVEL.LAST_RESORTS && !action.failed && !state.inEndgame()) {
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
			else if (result === 'generation') {
				state.generated = true;
			}
		}
	}

	if (!(sarcastic_targets?.length > 0) && !state.screamed_at && !state.generated && game.level >= LEVEL.ENDGAME && state.inEndgame())
		check_positional_discard(game, action, before_trash, old_chop, slot);

	team_elim(game);

	if (playerIndex === state.ourPlayerIndex) {
		for (const { order } of state.ourHand)
			common.thoughts[order].uncertain = false;
	}
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {ActualCard[]} before_trash
 * @param {ActualCard} old_chop
 * @param {number} slot
 */
function check_positional_discard(game, action, before_trash, old_chop, slot) {
	const { common, state, me } = game;
	const { order, playerIndex } = action;
	const card = common.thoughts[order];
	const expected_discard = before_trash[0] ?? old_chop;

	// Locked hand, blind played a chop moved card that could be good, discarded expected card
	const not_intended = expected_discard === undefined || (action.failed ?
		(card.chop_moved && card.possible.some(i => !isTrash(state, common, i, order, { infer: true }))) :
		order === expected_discard.order);

	if (not_intended)
		return;

	const num_plays = (action.failed && order !== expected_discard.order) ? 2 : 1;

	const playable_possibilities = game.players[playerIndex].hypo_stacks
		.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }))
		.filter(id => !isTrash(state, common, id, -1, { infer: true }));

	let reacting = [];

	for (let i = 1; i < state.numPlayers; i++) {
		const index = (playerIndex + i) % state.numPlayers;
		const target_card = state.hands[index][slot - 1];

		if (target_card === undefined || index === state.ourPlayerIndex || game.next_ignore[0]?.some(({ order }) => order === target_card.order))
			continue;

		// Find the latest player with an unknown playable
		if (playable_possibilities.some(i => target_card.matches(i)) && !common.thinksPlayables(state, index).some(c => c.order === target_card.order))
			reacting.push(index);
	}

	// If we haven't found a target, check if we can be the target.
	if (reacting.length < num_plays) {
		if (state.ourHand.length >= slot &&
			me.thoughts[state.ourHand[slot - 1].order].inferred.some(i => playable_possibilities.some(p => i.matches(p)))
		)
			reacting.push(state.ourPlayerIndex);

		if (reacting.length !== num_plays) {
			logger.warn(`weird discard detected, but not enough positional discard targets! (found [${reacting}], need ${num_plays})`);
			return;
		}
	}

	// Only take the last N reacting players.
	reacting = reacting.slice(-num_plays);

	/** @type {Connection[]} */
	const connections = [];

	for (const r of reacting) {
		const target_card = common.thoughts[state.hands[r][slot - 1].order];
		target_card.finessed = true;
		target_card.focused = true;
		target_card.inferred = target_card.inferred.intersect(playable_possibilities);

		logger.info('interpreting pos on', state.playerNames[r], 'slot', slot);
		connections.push({ type: 'positional', reacting: r, card: target_card, identities: target_card.inferred.array });
	}

	common.waiting_connections.push({
		connections,
		giver: playerIndex,
		target: reacting.at(-1),
		conn_index: 0,
		turn: state.turn_count,
		focused_card: connections.at(-1).card,
		inference: connections.at(-1).card.raw(),
		action_index: state.actionList.length - 1
	});
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

	const shout = common.thinksPlayables(state, playerIndex, {assume: true}).length > 0 &&
		before_trash.some(c => c.order === order) &&
		isTrash(state, common, { suitIndex, rank }, order, { infer: true });

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
