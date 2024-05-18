import { visibleFind } from '../../basics/hanabi-util.js';
import { ACTION } from '../../constants.js';
import { logCard, logClue, logObjectiveAction } from '../../tools/log.js';
import logger from '../../tools/logger.js';
import { cardCount } from '../../variants.js';

import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

export class UnsolvedGame extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game) => Clue[]} find_clues
 */
export function solve_game(game, playerTurn, find_clues) {
	const { common, state, me } = game;

	for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
		for (let rank = state.play_stacks[suitIndex] + 1; rank <= state.max_ranks[suitIndex]; rank++) {
			const identity = { suitIndex, rank };

			if ((state.baseCount(identity) + visibleFind(state, me, identity, { infer: true, symmetric: false }).length) < cardCount(state.variant, identity))
				throw new UnsolvedGame(`couldn't find all ${logCard(identity)}! only found ${state.baseCount(identity)} + ${visibleFind(state, me, identity, { infer: true }).map(c => c.order)}`);
		}
	}

	const common_state = state.minimalCopy();

	for (const { order } of state.hands[state.ourPlayerIndex]) {
		const id = common.thoughts[order].identity({ infer: true });

		if (id !== undefined) {
			const identity = { suitIndex: id.suitIndex, rank: id.rank };
			Object.assign(common_state.hands[state.ourPlayerIndex].findOrder(order), identity);
			Object.assign(state.deck[order], identity);
		}
	}

	const { actions, winrate } = winnable_simple(game, playerTurn, find_clues);

	if (winrate === 0)
		throw new UnsolvedGame(`couldn't find a winning strategy`);

	logger.highlight('purple', `endgame solved! found actions [${actions.map(action => logObjectiveAction(common_state, action)).join(', ')}] with winrate ${winrate}`);
	return actions[0];
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game) => Clue[]} find_clues
 * @param {number} endgameTurns
 * @returns {{actions: (Omit<PerformAction, 'tableID'> & {playerIndex: number})[] | undefined, winrate: number}}
 */
export function winnable_simple(game, playerTurn, find_clues = () => [], endgameTurns = -1) {
	const { state, common } = game;

	if (state.score === state.maxScore)
		return { actions: [], winrate: 1 };

	if (endgameTurns === 0 || state.pace < 0)
		return { actions: [], winrate: 0 };

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
	const playables = common.thinksPlayables(state, playerTurn);

	let best_actions = [], best_winrate = 0;

	if (playables.length > 0) {
		for (const { order } of playables) {
			const { suitIndex, rank } = state.deck[order];

			const new_game = game.simulate_action({ type: 'play', order, suitIndex, rank, playerIndex: playerTurn });
			new_game.state.cardsLeft--;

			logger.debug(state.playerNames[playerTurn], 'trying to play', logCard({ suitIndex, rank }), endgameTurns);
			const nextEndgameTurns = endgameTurns !== -1 ? endgameTurns - 1 : (new_game.state.cardsLeft === 0 ? state.numPlayers : -1);
			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, nextEndgameTurns);

			if (winrate >= best_winrate) {
				best_actions = actions.toSpliced(0, 0, { type: ACTION.PLAY, target: order, playerIndex: playerTurn });
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	if (best_winrate < 1 && state.clue_tokens > 0) {
		const clues = find_clues(game).filter(c => c.target !== playerTurn);

		if (clues.length === 0) {
			const clue_game = game.shallowCopy();
			clue_game.state = state.minimalCopy();
			clue_game.state.clue_tokens--;

			const { actions, winrate } = winnable_simple(clue_game, nextPlayerIndex, find_clues, endgameTurns === -1 ? -1 : endgameTurns - 1);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, Object.assign({ type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn }));
				best_winrate = winrate;
			}
		}

		for (const clue of clues) {
			logger.debug(state.playerNames[playerTurn], 'trying to clue', logClue(clue), endgameTurns);

			const list = state.hands[clue.target].clueTouched(clue, state.variant).map(c => c.order);
			const new_game = game.simulate_clue({ type: 'clue', clue, list, giver: playerTurn, target: clue.target });

			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, endgameTurns === -1 ? -1 : endgameTurns - 1);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, Object.assign(Utils.clueToAction(clue, -1), { playerIndex: playerTurn }));
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	const not_useful = state.hands[playerTurn].find(c => state.isBasicTrash(c));

	if (best_winrate < 1 && not_useful !== undefined) {
		const { suitIndex, rank } = not_useful;
		const new_game = game.simulate_action({ type: 'discard', order: not_useful.order, playerIndex: playerTurn, suitIndex, rank, failed: false });
		new_game.state.cardsLeft--;

		logger.debug(state.playerNames[playerTurn], 'trying to discard', endgameTurns);
		const nextEndgameTurns = endgameTurns !== -1 ? endgameTurns - 1 : (new_game.state.cardsLeft === 0 ? state.numPlayers : -1);
		const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, nextEndgameTurns);

		if (winrate > best_winrate) {
			best_actions = actions.toSpliced(0, 0, { type: ACTION.DISCARD, target: -1, playerIndex: playerTurn });
			best_winrate = winrate;
		}
	}

	Utils.globalModify({ game });

	return { actions: best_actions, winrate: best_winrate };
}
