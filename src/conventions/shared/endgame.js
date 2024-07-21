import { ACTION } from '../../constants.js';
import { logCard, logClue, logObjectiveAction } from '../../tools/log.js';
import logger from '../../tools/logger.js';

import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').BasicCard} BasicCard
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

export class UnsolvedGame extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

let timeout;

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 */
export function solve_game(game, playerTurn, find_clues = () => [], find_discards = () => []) {
	const { state, me } = game;

	const unseen_identities = find_unseen_identities(game);

	if (unseen_identities.length > 0)
		throw new UnsolvedGame(`couldn't find any ${unseen_identities.map(logCard).join()}!`);

	const common_state = state.minimalCopy();

	// Write identities on our own cards
	for (const { order } of state.hands[state.ourPlayerIndex]) {
		const id = me.thoughts[order].identity({ infer: true });

		if (id !== undefined) {
			const identity = { suitIndex: id.suitIndex, rank: id.rank };
			Object.assign(common_state.hands[state.ourPlayerIndex].findOrder(order), identity);
			Object.assign(common_state.deck[order], identity);
		}
	}

	const new_game = game.shallowCopy();
	new_game.state = common_state;

	timeout = new Date();
	timeout.setSeconds(timeout.getSeconds() + 2);

	logger.collect();
	const { actions, winrate } = winnable_simple(new_game, playerTurn, find_clues, find_discards);
	logger.flush(false);

	if (winrate === 0)
		throw new UnsolvedGame(`couldn't find a winning strategy`);

	logger.highlight('purple', `endgame solved! found actions [${actions.map(action => logObjectiveAction(common_state, action)).join(', ')}] with winrate ${winrate}`);
	return actions[0];
}

/** @param {Game} game */
function hash_state(game) {
	const { common, state } = game;

	const { clue_tokens, endgameTurns } = state;
	const hands = state.hands.flatMap(hand => hand.map(c => {
		const id = common.thoughts[c.order].identity({ infer: true });
		return id ? logCard(id) : 'xx';
	})).join();

	return `${hands},${clue_tokens},${endgameTurns}`;
}

/** @param {Game} game */
function find_unseen_identities(game) {
	const { state, me } = game;

	/** @type {Record<string, number>} */
	const seen_identities = state.hands.reduce((id_map, hand) => {
		for (const c of hand) {
			const id = me.thoughts[c.order].identity({ infer: true, symmetric: false });
			if (id !== undefined) {
				id_map[logCard(id)] ??= 0;
				id_map[logCard(id)]++;
			}
		}
		return id_map;
	}, {});

	return state.play_stacks.flatMap((stack, suitIndex) => stack >= state.max_ranks[suitIndex] ? [] :
		Utils.range(stack + 1, state.max_ranks[suitIndex] + 1).reduce((acc, rank) => {
			const id = { suitIndex, rank };

			if (seen_identities[logCard(id)] === undefined)
				acc.push(id);

			return acc;
		}, []));
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 */
function unwinnable_state(game, playerTurn) {
	const { state, me } = game;

	if (state.ended || state.pace < 0)
		return true;

	const void_players = Utils.range(0, state.numPlayers).filter(i => me.thinksTrash(state, i).length === state.hands[i].length);

	if (void_players.length > state.pace)
		return true;

	if (state.endgameTurns !== -1) {
		const possible_players = Utils.range(0, state.endgameTurns).filter(i => !void_players.includes((playerTurn + i) % state.numPlayers));

		if (possible_players.length + state.score < state.maxScore)
			return true;
	}
}

/**
 * @typedef {{actions: (Omit<PerformAction, 'tableID'> & {playerIndex: number})[] | undefined, winrate: number}} WinnableResult
 * 
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 * @param {Map<string, WinnableResult>} cache
 * @returns {WinnableResult}
 */
export function winnable_simple(game, playerTurn, find_clues = () => [], find_discards = () => [], cache = new Map()) {
	const { state } = game;

	if (state.score === state.maxScore)
		return { actions: [], winrate: 1 };

	if (Date.now() > timeout || unwinnable_state(game, playerTurn))
		return { actions: [], winrate: 0 };

	const cached_result = cache.get(hash_state(game));
	if (cached_result !== undefined)
		return cached_result;

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
	const playables = game.players[playerTurn].thinksPlayables(state, playerTurn);

	let best_actions = [], best_winrate = 0;

	if (playables.length > 0) {
		for (const { order } of playables) {
			if (state.deck[order].identity() === undefined)
				continue;

			const { suitIndex, rank } = state.deck[order];
			logger.debug(state.playerNames[playerTurn], 'trying to play', logCard({ suitIndex, rank }));

			const new_game = game.simulate_action({ type: 'play', order, suitIndex, rank, playerIndex: playerTurn });
			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate >= best_winrate) {
				best_actions = actions.toSpliced(0, 0, { type: ACTION.PLAY, target: order, playerIndex: playerTurn });
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	if (best_winrate < 1 && state.clue_tokens > 0) {
		const clues = find_clues(game, playerTurn).filter(c => c.target !== playerTurn);

		if (clues.length === 0) {
			const clue_game = game.shallowCopy();
			clue_game.state = state.minimalCopy();
			clue_game.state.clue_tokens--;
			clue_game.state.endgameTurns = clue_game.state.endgameTurns === -1 ? -1 : (clue_game.state.endgameTurns - 1);

			logger.debug(state.playerNames[playerTurn], 'trying to stall');
			const { actions, winrate } = winnable_simple(clue_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, Object.assign({ type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn }));
				best_winrate = winrate;
			}
		}

		for (const clue of clues) {
			logger.debug(state.playerNames[playerTurn], 'trying to clue', logClue(clue));

			const list = state.hands[clue.target].clueTouched(clue, state.variant).map(c => c.order);
			const new_game = game.simulate_clue({ type: 'clue', clue, list, giver: playerTurn, target: clue.target });

			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, Object.assign(Utils.clueToAction(clue, -1), { playerIndex: playerTurn }));
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	const not_useful = state.hands[playerTurn].find(c => state.isBasicTrash(c));

	if (best_winrate < 1 && state.pace >= 0) {
		const discards = find_discards(game, playerTurn);

		if (discards.length === 0 && not_useful !== undefined)
			discards.push({ misplay: false, order: not_useful.order });

		for (const { misplay, order } of discards) {
			const { suitIndex, rank } = state.hands[playerTurn].find(c => c.order === order);
			logger.debug(state.playerNames[playerTurn], 'trying to discard slot', state.hands[playerTurn].findIndex(c => c.order === order) + 1);

			const new_game = game.simulate_action({ type: 'discard', order, playerIndex: playerTurn, suitIndex, rank, failed: misplay }, { enableLogs: playerTurn === 1 && state.hands[playerTurn].findIndex(c => c.order === order) === 0});
			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, { type: ACTION.DISCARD, target: order, playerIndex: playerTurn });
				best_winrate = winrate;
			}
		}
	}

	Utils.globalModify({ game });

	const result = { actions: best_actions, winrate: best_winrate };
	cache.set(hash_state(game), result);

	return result;
}
