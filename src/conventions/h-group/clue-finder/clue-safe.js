import { save2 } from '../../../basics/hanabi-util.js';
import { early_game_clue } from '../urgent-actions.js';
import { logCard } from '../../../tools/log.js';
import logger from '../../../tools/logger.js';

import * as Utils from '../../../tools/util.js';
import { team_elim } from '../../../basics/helper.js';


/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * @param {Game} game
 * @param {number} playerIndex
 */
function getFinessedOrder(game, playerIndex) {
	const { state, common } = game;
	const player = game.players[playerIndex];

	const finessed_orders = state.hands[playerIndex].filter(o => {
		const card = player.thoughts[o];

		if (!card.finessed || !state.isPlayable(state.deck[o]))
			return false;

		// We can only use hidden cards if they're bluffs, otherwise the player will wait until their real connection is playable
		return !card.hidden || player.waiting_connections.some(wc => wc.connections.some(conn => conn.order === o && conn.bluff));
	});

	return Utils.maxOn(finessed_orders, o => -common.thoughts[o].finesse_index);
}

/**
 * @param {Game} game
 * @param {number} start
 * @param {number} target
 */
function connectable(game, start, target) {
	const { state } = game;

	if (start === target)
		return game.players[target].thinksPlayables(state, target, { assume: false }).length > 0;

	const finessed_card = getFinessedOrder(game, start);
	const playables = finessed_card ? [finessed_card] : game.players[start].thinksPlayables(state, start, { assume: false });

	for (const order of playables) {
		const id = game.players[start].thoughts[order].identity({ infer: true });

		if (id === undefined)
			continue;

		const new_state = state.shallowCopy();
		new_state.play_stacks = new_state.play_stacks.with(id.suitIndex, state.play_stacks[id.suitIndex] + 1);

		const new_game = game.shallowCopy();
		new_game.state = new_state;

		return connectable(new_game, state.nextPlayerIndex(start), target);
	}
	return false;
}

/**
 * Returns the next playerIndex that may discard (or us if we get back to ourselves), plus the number of potential cluers in between.
 * 
 * Impure! (modifies game)
 * @param {Game} game
 * @param {Player} player
 * @param {number} startIndex
 * @param {number} clue_tokens
 */
function getNextDiscard(game, player, startIndex, clue_tokens) {
	const { common, state } = game;
	let next_discard = state.nextPlayerIndex(startIndex);
	let potential_cluers = 0;

	const old_play_stacks = state.play_stacks.slice();

	while (game.players[next_discard].thinksLoaded(state, next_discard, { assume: false })) {
		const finessed_order = getFinessedOrder(game, next_discard);

		if (finessed_order === undefined) {
			if (clue_tokens > potential_cluers)
				potential_cluers++;
		}
		else {
			const finessed_card = state.deck[finessed_order];
			state.play_stacks[finessed_card.suitIndex] = finessed_card.rank;
			game.common.good_touch_elim(state);
			team_elim(game);
		}

		if (common.thinksTrash(state, next_discard) && common.thinksPlayables(state, next_discard, { assume: false }))
			clue_tokens++;

		logger.debug(`intermediate player ${state.playerNames[next_discard]} is loaded ${finessed_order !== undefined ? ' (finesse!)' : ''}`);

		next_discard = state.nextPlayerIndex(next_discard);

		if (next_discard === state.ourPlayerIndex) {
			state.play_stacks = old_play_stacks;
			return { next_discard, potential_cluers };
		}
	}

	// Check if they need to generate a clue for next player (a bit too cautious, maybe a clue could reveal a playable)
	const nextPlayerIndex = state.nextPlayerIndex(next_discard);
	const forced_discard = clue_tokens === 1 &&
		nextPlayerIndex !== state.ourPlayerIndex &&
		state.hands[nextPlayerIndex].every(o => ((c = state.deck[o]) => state.isCritical(c) || c.clued)()) &&
		!common.thinksLoaded(state, nextPlayerIndex);

	if ((clue_tokens === 0 || forced_discard) && !chopUnsafe(game, player, next_discard)) {
		logger.highlight('cyan', 'low clues, first discard', state.playerNames[next_discard], 'is safe');

		const result = getNextDiscard(game, player, next_discard, 1);
		next_discard = result.next_discard;
		potential_cluers += result.potential_cluers;
	}

	state.play_stacks = old_play_stacks;
	return { next_discard, potential_cluers };
}

/**
 * Returns the possible discard from a hand.
 * @param {Game} game
 * @param {Player} player
 * @param {number[]} hand
 * @param {boolean} potential_cluer
 */
function possible_discard(game, player, hand, potential_cluer) {
	const { state } = game;
	const chop = player.chop(hand, { afterClue: true });

	if (chop === undefined)
		return undefined;

	const chop_card = state.deck[chop];
	const chop_cluable = state.isCritical(chop_card) || save2(state, player, chop_card) || player.hypo_stacks[chop_card.suitIndex] === chop_card.rank - 1;

	return (potential_cluer && chop_cluable) ? undefined : chop;
}

/**
 * Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
 * @param {Game} game
 * @param {Player} player
 * @param {Clue} clue
 * @returns {{ safe: boolean, discard: number | undefined }}
 */
export function clue_safe(game, player, clue) {
	const { state } = game;
	const { target } = clue;

	const list = state.clueTouched(state.hands[target], clue);
	const clue_action = /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });
	const hypo_game = game.simulate_clue(clue_action);
	hypo_game.catchup = true;

	// Update waiting connections
	hypo_game.last_actions[state.ourPlayerIndex] = clue_action;
	hypo_game.handle_action({ type: 'turn', num: state.turn_count, currentPlayerIndex: state.nextPlayerIndex(state.ourPlayerIndex) });
	hypo_game.catchup = false;

	return safe_situation(hypo_game, hypo_game.players[player.playerIndex]);
}

/**
 * Determines whether a situation is safe.
 * 
 * Impure! (modifies game)
 * @param {Game} game
 * @param {Player} player
 * @returns {{ safe: boolean, discard: number | undefined }}
 */
export function safe_situation(game, player) {
	const { state } = game;

	let { next_discard, potential_cluers } = getNextDiscard(game, player, state.ourPlayerIndex, state.clue_tokens);

	if (next_discard === state.ourPlayerIndex)
		return { safe: true, discard: undefined };

	const has_early_clue = state.early_game && early_game_clue(game, next_discard);
	const safe = !chopUnsafe(game, player, next_discard) || has_early_clue;
	const discard = possible_discard(game, player, state.hands[next_discard], potential_cluers >= 1);

	logger.info(`next discard may come from ${state.playerNames[next_discard]}, chop ${safe ? 'safe' : 'unsafe'} ${discard ? logCard(state.deck[discard]) : '(locked)'}, ${potential_cluers} potential cluers`);

	if (safe || potential_cluers >= 1)
		return { safe: true, discard: has_early_clue ? undefined : discard };

	if (connectable(game, state.nextPlayerIndex(state.ourPlayerIndex), next_discard)) {
		logger.info('can connect to this player! searching again');
		({ next_discard, potential_cluers } = getNextDiscard(game, player, next_discard, state.clue_tokens));
	}
	else {
		return { safe: false, discard: possible_discard(game, player, state.hands[next_discard], false) };
	}

	if (next_discard === state.ourPlayerIndex)
		return { safe: true, discard: undefined };

	const has_early_clue2 = state.early_game && early_game_clue(game, next_discard);
	const safe2 = !chopUnsafe(game, player, next_discard) || has_early_clue;
	const discard2 = possible_discard(game, player, state.hands[next_discard], potential_cluers >= 1);

	logger.info(`next next discard may come from ${state.playerNames[next_discard]}, chop ${safe2 ? 'safe' : 'unsafe'} ${discard2 ? logCard(state.deck[discard2]) : '(locked)'}, ${potential_cluers} potential cluers`);

	return { safe: safe2 || potential_cluers >= 1, discard: has_early_clue2 ? undefined : discard2 };
}

/**
 * Checks if a player's chop is safe after a clue, according to a player.
 * @param {Game} game
 * @param {Player} player
 * @param {number} playerIndex
 */
export function chopUnsafe(game, player, playerIndex) {
	const { state } = game;

	// Note that chop will be undefined if the entire hand is clued
	const chop = game.players[playerIndex].chop(state.hands[playerIndex], { afterClue: true });

	// Crit or unique 2 on chop
	if (chop) {
		const chop_card = state.deck[chop];
		return chop_card.identity() && (state.isCritical(chop_card) || save2(state, player, chop_card));
	}

	// Locked with no clue tokens
	return state.clue_tokens === 0 && !game.players[playerIndex].thinksLoaded(state, playerIndex, {assume: false});
}
