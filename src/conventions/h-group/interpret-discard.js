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
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 */

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {Game} game
 * @param {DiscardAction} action
 */
export function interpret_discard(game, action) {
	const { common, state, me } = game;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };

	const before_trash = common.thinksTrash(state, playerIndex).filter(o => common.thoughts[o].saved);
	const old_chop = common.chop(state.hands[playerIndex]);
	const slot = state.hands[playerIndex].findIndex(o => o === order) + 1;

	if (game.level >= LEVEL.BASIC_CM && rank === 1 && failed)
		check_ocm(game, action);

	Basics.onDiscard(game, action);

	const to_remove = [];
	for (let i = 0; i < common.waiting_connections.length; i++) {
		const { connections, conn_index, inference, action_index } = common.waiting_connections[i];

		const dc_conn_index = connections.findIndex((conn, index) => index >= conn_index && conn.order === order);
		if (dc_conn_index === -1)
			continue;

		if (failed && game.finesses_while_finessed[playerIndex].some(c => c.matches({ suitIndex, rank }))) {
			logger.info('bombed duplicated card from finessing while finessed');
			action.intentional = true;
			continue;
		}

		logger.info(`discarded connecting card ${logCard({ suitIndex, rank })}, cancelling waiting connection for inference ${logCard(inference)}`);

		to_remove.push(i);

		// Another waiting connection exists for this, can ignore
		if (common.waiting_connections.some((wc, index) => action_index === wc.action_index && !to_remove.includes(index)))
			continue;

		// Check if sarcastic
		if (state.deck[order].clued && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex] && !failed) {
			const sarcastics = interpret_sarcastic(game, action);

			// Sarcastic, rewrite connection onto this person
			if (sarcastics.length === 1) {
				logger.info('rewriting connection to use sarcastic on order', sarcastics[0]);
				Object.assign(connections[dc_conn_index], {
					reacting: state.hands.findIndex(hand => hand.includes(sarcastics[0])),
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
	if (state.early_game && !action.failed && !state.deck[order].clued) {
		logger.warn('ending early game from discard of', logCard(state.deck[order]));
		state.early_game = false;
	}

	const thoughts = common.thoughts[order];

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && playerIndex === state.ourPlayerIndex && (failed || (!state.hasConsistentInferences(thoughts) && !isTrash(state, me, state.deck[order], order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = state.deck[order].drawn_index;
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
		if (state.deck[order].clued) {
			logger.warn('discarded useful clued card!');
			common.restore_elim(state.deck[order]);

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

			if (state.isCritical({ suitIndex, rank }) && common.thoughts[chop]?.possible.has(state.deck[order].identity()))
				state.dda = state.deck[order].identity();
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
					common.updateThoughts(chop, (draft) => { draft.chop_moved = true; });
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
		for (const order of state.ourHand) {
			if (common.thoughts[order].uncertain)
				common.updateThoughts(order, (draft) => { draft.uncertain = false; });
		}
	}
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {number[]} before_trash
 * @param {number} old_chop
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
		order === expected_discard);

	if (not_intended)
		return;

	const num_plays = (action.failed && order !== expected_discard) ? 2 : 1;

	const playable_possibilities = game.players[playerIndex].hypo_stacks
		.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }))
		.filter(id => !isTrash(state, common, id, -1, { infer: true }));

	let reacting = [];

	for (let i = 1; i < state.numPlayers; i++) {
		const index = (playerIndex + i) % state.numPlayers;
		const target_order = state.hands[index][slot - 1];

		if (target_order === undefined || index === state.ourPlayerIndex || game.next_ignore[0]?.some(({ order }) => order === target_order))
			continue;

		// Find the latest player with an unknown playable
		if (playable_possibilities.some(i => state.deck[target_order].matches(i)) && !common.thinksPlayables(state, index).includes(target_order))
			reacting.push(index);
	}

	// If we haven't found a target, check if we can be the target.
	if (reacting.length < num_plays) {
		if (state.ourHand.length >= slot &&
			me.thoughts[state.ourHand[slot - 1]].inferred.some(i => playable_possibilities.some(p => i.matches(p)))
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
		const order = state.hands[r][slot - 1];
		common.updateThoughts(order, (draft) => {
			draft.finessed = true;
			draft.focused = true;
			draft.inferred = common.thoughts[order].inferred.intersect(playable_possibilities);
		});

		logger.info('interpreting pos on', state.playerNames[r], 'slot', slot);
		connections.push({ type: 'positional', reacting: r, order, identities: common.thoughts[order].inferred.array });
	}

	const actual_card = state.deck[connections.at(-1).order];

	common.waiting_connections.push({
		connections,
		giver: playerIndex,
		target: reacting.at(-1),
		conn_index: 0,
		turn: state.turn_count,
		focus: connections.at(-1).order,
		inference: actual_card.raw(),
		action_index: state.actionList.length - 1
	});
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {number[]} before_trash
 * @param {number} old_chop
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
		(common.thinksPlayables(state, playerIndex, {assume: true}).length > 0 || before_trash.length > 0) && order === old_chop;

	const shout = common.thinksPlayables(state, playerIndex, {assume: true}).length > 0 &&
		before_trash.includes(order) &&
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

	const next2ChopValue = cardValue(state, game.players[playerIndex], state.deck[next2Chop], next2Chop);

	if (next2ChopValue < 4)
		return scream ? 'scream' : 'shout';

	return 'generation';
}
