import { save2 } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').Identity} Identity
 */

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

	/** @param {number} startIndex */
	const getNextUnoccupied = (startIndex) => {
		/** @param {number} index */
		const get_finessed_card = (index) => hypo_state.hands[index].find(c => {
			const card = hypo_player.thoughts[c.order];

			if (!card.finessed || !hypo_state.isPlayable(c))
				return false;

			// We can only use hidden cards if they're bluffs, otherwise the player will wait until their real connection is playable
			return !card.hidden || hypo_player.waiting_connections.some(wc => wc.connections.some(conn => conn.card.order === c.order && conn.bluff));
		});

		let nextIndex = (startIndex + 1) % state.numPlayers;
		let finessed_card = get_finessed_card(nextIndex);

		// Find the next player without a playable finessed card
		while (finessed_card && nextIndex !== state.ourPlayerIndex) {
			nextIndex = (nextIndex + 1) % state.numPlayers;
			hypo_state.play_stacks[finessed_card.suitIndex]++;
			finessed_card = get_finessed_card(nextIndex);
		}
		return nextIndex;
	};

	const next_unoccupied = getNextUnoccupied(state.ourPlayerIndex);

	// If everyone has a finessed card and it loops back to us, we assume we are fine. (TODO: Possibly allow someone to scream?)
	if (next_unoccupied === state.ourPlayerIndex)
		return true;

	logger.info('next unoccupied', state.playerNames[next_unoccupied], 'unsafe?', chopUnsafe(hypo_state, hypo_player, next_unoccupied));

	// Not dangerous, clue is fine to give
	if (!chopUnsafe(hypo_state, hypo_player, next_unoccupied))
		return true;

	const safely_loaded = hypo_game.common.thinksTrash(hypo_state, next_unoccupied).length > 0 ||
		hypo_game.common.thinksPlayables(hypo_state, next_unoccupied, {assume: false}).some(p => {
			const card = hypo_game.common.thoughts[p.order];
			return (!card.finessed || !card.hidden) && state.isPlayable(state.deck[p.order]);
		});

	// Dangerous and not loaded, clue is not fine
	if (!safely_loaded) {
		logger.warn(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop and not loaded`);
		return false;
	}

	// Dangerous and loaded
	const next_unoccupied2 = getNextUnoccupied(next_unoccupied);

	if (next_unoccupied2 === state.ourPlayerIndex)
		return true;

	logger.info(`next unoccupied ${state.playerNames[next_unoccupied]} has unsafe chop but loaded, next next ${state.playerNames[next_unoccupied2]} has ${chopUnsafe(hypo_state, player, next_unoccupied2) ? 'unsafe' : 'safe'} chop with ${hypo_state.clue_tokens} clues`);

	// Safe chop or can be saved
	return !chopUnsafe(hypo_state, hypo_player, next_unoccupied2) || hypo_state.clue_tokens > 0;
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
