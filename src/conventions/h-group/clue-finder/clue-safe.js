import { save2 } from '../../../basics/hanabi-util.js';
import { early_game_clue } from '../urgent-actions.js';
import { logCard } from '../../../tools/log.js';
import logger from '../../../tools/logger.js';

import * as Utils from '../../../tools/util.js';


/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * @param {Game} game
 * @param {number} playerIndex
 */
function getFinessedCard(game, playerIndex) {
	const { state, common } = game;
	const player = game.players[playerIndex];

	const finessed_cards = state.hands[playerIndex].filter(c => {
		const card = player.thoughts[c.order];

		if (!card.finessed || !state.isPlayable(c))
			return false;

		// We can only use hidden cards if they're bluffs, otherwise the player will wait until their real connection is playable
		return !card.hidden || player.waiting_connections.some(wc => wc.connections.some(conn => conn.card.order === c.order && conn.bluff));
	});

	return Utils.maxOn(finessed_cards, (c) => -common.thoughts[c.order].finesse_index);
}

/**
 * @param {Game} game
 * @param {number} start
 * @param {number} target
 */
function connectable(game, start, target) {
	if (start === target)
		return game.players[target].thinksPlayables(game.state, target, { assume: false }).length > 0;

	const finessed_card = getFinessedCard(game, start);
	const playables = finessed_card ? [finessed_card] : game.players[start].thinksPlayables(game.state, start, { assume: false });

	for (const { order } of playables) {
		const id = game.players[start].thoughts[order].identity({ infer: true });

		if (id === undefined)
			continue;

		const new_state = game.state.shallowCopy();
		new_state.play_stacks = new_state.play_stacks.slice();
		new_state.play_stacks[id.suitIndex]++;

		const new_game = game.shallowCopy();
		new_game.state = new_state;

		if (connectable(new_game, game.state.nextPlayerIndex(start), target))
			return true;
	}
	return false;
}

/**
 * Returns the next playerIndex that may discard (or us if we get back to ourselves), plus the number of potential cluers in between.
 * @param {Game} game
 * @param {Player} player
 * @param {number} startIndex
 * @param {boolean} zero_clues
 */
function getNextDiscard(game, player, startIndex, zero_clues) {
	const { state } = game;
	let next_discard = state.nextPlayerIndex(startIndex);
	let potential_cluers = 0;

	while (game.common.thinksPlayables(state, next_discard, { assume: false }).length > 0 && next_discard !== state.ourPlayerIndex) {
		const finessed_card = getFinessedCard(game, next_discard);

		if (finessed_card === undefined && state.clue_tokens > potential_cluers)
			potential_cluers++;

		logger.debug(`intermediate player ${state.playerNames[next_discard]} has playables [${game.common.thinksPlayables(state, next_discard, { assume: false }).map(logCard)}]${finessed_card !== undefined ? ' (finesse!)' : ''}`);

		next_discard = state.nextPlayerIndex(next_discard);
	}

	if (zero_clues && next_discard !== state.ourPlayerIndex && !chopUnsafe(state, player, next_discard)) {
		const result = getNextDiscard(game, player, next_discard, false);
		next_discard = result.next_discard;
		potential_cluers += result.potential_cluers;
	}

	return { next_discard, potential_cluers };
}

/**
 * Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
 * @param {Game} game
 * @param {Player} player
 * @param {Clue} clue
 */
export function clue_safe(game, player, clue) {
	const { state } = game;
	const { target } = clue;

	const list = state.hands[target].clueTouched(clue, state.variant).map(c => c.order);
	const hypo_game = game.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });
	const { state: hypo_state } = hypo_game;
	const hypo_player = hypo_game.players[player.playerIndex];

	let { next_discard, potential_cluers } = getNextDiscard(hypo_game, hypo_player, state.ourPlayerIndex, hypo_state.clue_tokens === 0);

	if (next_discard === state.ourPlayerIndex)
		return true;

	const safe = !chopUnsafe(hypo_state, hypo_player, next_discard) || early_game_clue(hypo_game, next_discard);

	logger.info(`next discard may come from ${state.playerNames[next_discard]}, chop ${safe ? 'safe' : 'unsafe'}, ${potential_cluers} potential cluers`);

	if (safe || potential_cluers >= 1)
		return true;

	if (connectable(hypo_game, state.nextPlayerIndex(state.ourPlayerIndex), next_discard)) {
		logger.info('can connect to this player! searching again');
		({ next_discard, potential_cluers } = getNextDiscard(hypo_game, hypo_player, next_discard, hypo_state.clue_tokens === 0));
	}
	else {
		return false;
	}

	if (next_discard === state.ourPlayerIndex)
		return true;

	const safe2 = !chopUnsafe(hypo_state, hypo_player, next_discard);

	logger.info(`next discard may come from ${state.playerNames[next_discard]}, chop ${safe2 ? 'safe' : 'unsafe'}, ${potential_cluers} potential cluers`);

	return safe2 || potential_cluers >= 1;
}

/**
 * Checks if a player's chop is safe after a clue, according to a player.
 * @param {State} state
 * @param {Player} player
 * @param {number} playerIndex
 */
export function chopUnsafe(state, player, playerIndex) {
	// Note that chop will be undefined if the entire hand is clued
	const chop = player.chop(state.hands[playerIndex], { afterClue: true });

	// Crit or unique 2 on chop
	if (chop)
		return chop.identity() && (state.isCritical(chop) || save2(state, player, chop));

	// Locked with no clue tokens
	return state.clue_tokens === 0 && !player.thinksLoaded(state, playerIndex, {assume: false});
}
