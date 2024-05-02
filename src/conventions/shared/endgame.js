import { visibleFind } from '../../basics/hanabi-util.js';
import { ACTION } from '../../constants.js';
import { logCard } from '../../tools/log.js';
import logger from '../../tools/logger.js';
import { cardCount } from '../../variants.js';

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

class UnsolvedGame extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

/**
 * @param {State} state
 * @param {PerformAction & {playerIndex: number}} action
 */
function logPerformActionLimited(state, action) {
	/** @type {string} */
	let actionType;

	switch (action.type) {
		case ACTION.PLAY:
			actionType = `play ${logCard(state.deck[action.target])}`;
			break;
		case ACTION.COLOUR:
		case ACTION.RANK:
			actionType = 'clue';
			break;
		case ACTION.DISCARD:
			actionType = 'discard';
	}

	return `${actionType} (${state.playerNames[action.playerIndex]})`;
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 */
export function solve_game(game, playerTurn) {
	const { state, me } = game;

	for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
		for (let rank = state.play_stacks[suitIndex] + 1; rank <= state.max_ranks[suitIndex]; rank++) {
			const identity = { suitIndex, rank };

			if ((state.baseCount(identity) + visibleFind(state, me, identity, { infer: true, symmetric: false }).length) < cardCount(state.variant, identity))
				throw new UnsolvedGame(`couldn't find all ${logCard(identity)}! only found ${state.baseCount(identity)} + ${visibleFind(state, me, identity, { infer: true }).map(c => c.order)}`);
		}
	}

	const known_state = state.minimalCopy();

	for (const { order } of state.hands[state.ourPlayerIndex]) {
		const id = me.thoughts[order].identity({ infer: true });

		if (id !== undefined) {
			const identity = { suitIndex: id.suitIndex, rank: id.rank };
			Object.assign(known_state.hands[state.ourPlayerIndex].findOrder(order), identity);
			Object.assign(state.deck[order], identity);
		}
	}

	const { actions, winrate } = winnable(known_state, playerTurn);

	if (winrate === 0)
		throw new UnsolvedGame(`couldn't find a winning strategy`);

	logger.highlight('purple', `endgame solved! found actions [${actions.map(action => logPerformActionLimited(known_state, action)).join(', ')}] with winrate ${winrate}`);
	return actions[0];
}


/**
 * @param {State} state
 * @param {number} playerTurn
 * @param {number} endgameTurns
 * @returns {{actions: (PerformAction & {playerIndex: number})[] | undefined, winrate: number}}
 */
export function winnable(state, playerTurn, endgameTurns = -1) {
	if (state.score === state.maxScore)
		return { actions: [], winrate: 1 };

	if (endgameTurns === 0 || state.pace < 0)
		return { actions: [], winrate: 0 };

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);

	const usefulHands = state.hands.map(hand =>
		Array.from(hand.filter(c => state.play_stacks[c.suitIndex] < c.rank && c.rank <= state.max_ranks[c.suitIndex])));

	const playables = usefulHands[playerTurn].filter(c => state.isPlayable(c));

	let best_actions = [], best_winrate = 0;

	if (playables.length > 0) {
		for (const { suitIndex, rank, order } of playables) {
			const play_state = state.minimalCopy();
			play_state.play_stacks[suitIndex] = rank;
			play_state.cardsLeft--;

			const nextEndgameTurns = endgameTurns !== -1 ? endgameTurns - 1 : (play_state.cardsLeft === 0 ? state.numPlayers : -1);
			logger.debug(state.playerNames[playerTurn], 'trying to play', logCard({ suitIndex, rank }), endgameTurns);
			const { actions, winrate } = winnable(play_state, nextPlayerIndex, nextEndgameTurns);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, { tableID: -1, type: ACTION.PLAY, target: order, playerIndex: playerTurn });
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	if (best_winrate < 1 && state.clue_tokens > 0) {
		const clue_state = state.minimalCopy();
		clue_state.clue_tokens--;

		logger.debug(state.playerNames[playerTurn], 'trying to clue', endgameTurns);
		const { actions, winrate } = winnable(clue_state, nextPlayerIndex, endgameTurns === -1 ? -1 : endgameTurns - 1);

		if (winrate > best_winrate) {
			best_actions = actions.toSpliced(0, 0, { tableID: -1, type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn });
			best_winrate = winrate;
		}
	}

	if (best_winrate < 1) {
		const discard_state = state.minimalCopy();
		discard_state.clue_tokens++;
		discard_state.cardsLeft--;

		logger.debug(state.playerNames[playerTurn], 'trying to discard', endgameTurns);
		const nextEndgameTurns = endgameTurns !== -1 ? endgameTurns - 1 : (discard_state.cardsLeft === 0 ? state.numPlayers : -1);
		const { actions, winrate } = winnable(discard_state, nextPlayerIndex, nextEndgameTurns);

		if (winrate > best_winrate) {
			best_actions = actions.toSpliced(0, 0, { tableID: -1, type: ACTION.DISCARD, target: -1, playerIndex: playerTurn });
			best_winrate = winrate;
		}
	}

	return { actions: best_actions, winrate: best_winrate };
}
