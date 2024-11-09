import HGroup from '../h-group.js';
import { ActualCard } from '../../basics/Card.js';
import { ACTION, ENDGAME_SOLVING_FUNCS } from '../../constants.js';
import { produce } from '../../StateProxy.js';
import { logCard, logObjectiveAction } from '../../tools/log.js';
import logger from '../../tools/logger.js';

import * as Utils from '../../tools/util.js';

import { isMainThread, parentPort, workerData } from 'worker_threads';

const conventions = {
	HGroup
};

/**
 * @typedef {import('../../basics/Game.js').Game} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').BasicCard} BasicCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').Action} Action
 * @typedef {import('../../types.js').PerformAction} PerformAction
 * @typedef {Omit<PerformAction, 'tableID'> & {playerIndex: number}} ModPerformAction
 */

export class UnsolvedGame extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

let timeout;
const simple_cache = new Map(), simpler_cache = new Map();

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 */
export function solve_game(game, playerTurn, find_clues = () => [], find_discards = () => []) {
	const { state, me } = game;

	const unseen_identities = find_unseen_identities(game);

	if (unseen_identities.length > 2)
		throw new UnsolvedGame(`couldn't find any ${unseen_identities.map(logCard).join()}!`);

	const common_state = state.minimalCopy();
	const unknown_own = [];

	// Write identities on our own cards
	for (const order of state.ourHand) {
		const id = me.thoughts[order].identity({ infer: true });

		if (id !== undefined)
			common_state.deck = common_state.deck.with(order, produce(common_state.deck[order], Utils.assignId(id)));
		else
			unknown_own.push(order);
	}

	timeout = new Date();
	timeout.setSeconds(timeout.getSeconds() + 10);

	if (unseen_identities.length > 0) {
		logger.debug('unseen identities', unseen_identities.map(logCard));

		const possible_locs = unknown_own.concat(Utils.range(0, state.cardsLeft).map(i => state.cardOrder + i + 1));
		const arrangements = Utils.allSubsetsOfSize(possible_locs, unseen_identities.length)
			.flatMap(subset => Utils.permutations(subset))
			.filter(orders => orders.every((o, i) => !unknown_own.includes(o) || me.thoughts[o].possible.has(unseen_identities[i])));

		const decks = arrangements.map(locs => {
			const deck = state.deck.slice();

			// Arrange deck
			for (let i = 0; i < locs.length; i++) {
				const identity = unseen_identities[i];
				const order = locs[i];

				if (unknown_own.includes(order))
					deck[order] = produce(deck[order], Utils.assignId(identity));
				else
					deck[order] = new ActualCard(identity.suitIndex, identity.rank, order);
			}

			return deck;
		});

		const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
		const original_deck = state.deck;

		let max_deck_wins = 1, best_action;

		for (let d = 0; d < arrangements.length; d++) {
			if (arrangements.length - d <= max_deck_wins)
				break;		// winning all remaining decks is still worse

			const new_state = common_state.minimalCopy();
			new_state.deck = decks[d];

			const new_game = game.minimalCopy();
			new_game.state = new_state;

			const results = winnable(new_game, playerTurn, find_clues, find_discards);
			const winning_actions = results.keys().filter(action => results.get(action));

			for (const action of winning_actions) {
				let deck_wins = 1;

				for (let i = d + 1; i < arrangements.length; i++) {
					game.state.deck = decks[i];

					const new_game = advance_game(game, playerTurn, action);
					const { win: deck_win } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards);

					if (deck_win)
						deck_wins++;
					else if (deck_wins + (arrangements.length - i) <= max_deck_wins)
						break;		// winning all remaining decks is still worse
				}

				// Wins all decks
				if (deck_wins === arrangements.length)
					return action;

				if (deck_wins > max_deck_wins) {
					max_deck_wins = deck_wins;
					best_action = action;
				}
			}
		}

		game.state.deck = original_deck;

		if (best_action === undefined)
			throw new UnsolvedGame(`couldn't find a winning strategy`);

		logger.highlight('purple', `endgame winnable! found action ${logObjectiveAction(common_state, best_action)} with winrate ${max_deck_wins}/${arrangements.length}`);
		return best_action;
	}

	const new_game = game.shallowCopy();
	new_game.state = common_state;

	const { actions, win } = winnable_simple(new_game, playerTurn, find_clues, find_discards);

	if (!win)
		throw new UnsolvedGame(`couldn't find a winning strategy`);

	logger.highlight('purple', `endgame solved! found actions [${actions.map(action => logObjectiveAction(common_state, action)).join(', ')}]`);
	return actions[0];
}

/**
 * @param {Game} game
 * @param {boolean} [infer]
 */
function hash_game(game, infer = true) {
	const { common, state } = game;

	const { clue_tokens, endgameTurns } = state;
	const hands = state.hands.flatMap(hand => hand.map(o =>
		logCard((infer ? common.thoughts[o]: state.deck[o]).identity({ infer: true })))).join();

	return `${state.deck.map(logCard)},${hands},${clue_tokens},${endgameTurns}`;
}

/**
 * @param {State} state
 */
function hash_state(state) {
	const { clue_tokens, endgameTurns } = state;
	const hands = state.hands.flatMap(hand => hand.map(o => logCard(state.deck[o]))).join();

	return `${state.deck.map(logCard)},${hands},${clue_tokens},${endgameTurns}`;
}

/**
 * @param {Game} game
 * @returns {Identity[]}
 */
function find_unseen_identities(game) {
	const { state, me } = game;

	/** @type {Record<string, number>} */
	const seen_identities = state.hands.reduce((id_map, hand) => {
		for (const o of hand) {
			const id = me.thoughts[o].identity({ infer: true, symmetric: false });
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
 * @param {State} state
 * @param {number} playerTurn
 */
function unwinnable_state(state, playerTurn) {
	if (state.ended || state.pace < 0)
		return true;

	const void_players = Utils.range(0, state.numPlayers).filter(i =>
		state.hands[i].every(o => ((c = state.deck[o]) => c.identity() === undefined || state.isBasicTrash(c))()));

	if (void_players.length > state.pace)
		return true;

	if (state.endgameTurns !== -1) {
		const possible_players = Utils.range(0, state.endgameTurns).filter(i => !void_players.includes((playerTurn + i) % state.numPlayers));

		if (possible_players.length + state.score < state.maxScore)
			return true;
	}
}


/**
 * Returns whether the game is winnable if everyone can look at their own cards.
 * 
 * @param {State} state
 * @param {number} playerTurn
 * @returns {boolean}
 */
function winnable_simpler(state, playerTurn) {
	if (state.score === state.maxScore)
		return true;

	if (Date.now() > timeout || unwinnable_state(state, playerTurn))
		return false;

	const cached_result = simpler_cache.get(hash_state(state));
	if (cached_result !== undefined)
		return cached_result;

	for (const order of state.hands[playerTurn]) {
		const card = state.deck[order];

		if (!state.isPlayable(card))
			continue;

		const action = { type: ACTION.PLAY, target: order, playerIndex: playerTurn };

		if (predict_winnable(state, playerTurn, action))
			return true;
	}

	if (state.clue_tokens > 0) {
		const action = { type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn };

		if (predict_winnable(state, playerTurn, action))
			return true;
	}

	const discardable = state.hands[playerTurn].find(o => ((c = state.deck[o]) => c.identity() === undefined || state.isBasicTrash(c))());

	if (state.pace >= 0 && discardable !== undefined) {
		const action = { type: ACTION.DISCARD, target: discardable, playerIndex: playerTurn };

		if (predict_winnable(state, playerTurn, action))
			return true;
	}

	simpler_cache.set(hash_state(state), false);
	return false;
}

/**
 * @param {State} state
 * @param {number} playerTurn
 * @param {ModPerformAction} action
 */
function predict_winnable(state, playerTurn, action) {
	return winnable_simpler(advance_state(state, playerTurn, action), state.nextPlayerIndex(playerTurn));
}

/**
 * @param {State} state
 * @param {number} playerTurn
 * @param {ModPerformAction} action
 */
function advance_state(state, playerTurn, action) {
	const new_state = state.shallowCopy();

	/**
	 * @param {number} playerIndex
	 * @param {number} order
	 */
	const remove_and_draw_new = (playerIndex, order) => {
		const newCardOrder = state.cardOrder + 1;
		const index = state.hands[playerIndex].indexOf(order);
		new_state.hands[playerIndex] = new_state.hands[playerIndex].toSpliced(index, 1);

		if (state.endgameTurns === -1) {
			const new_hands = new_state.hands.slice();
			new_hands[playerTurn] = new_hands[playerTurn].toSpliced(0, 0, newCardOrder);
			new_state.hands = new_hands;

			new_state.cardOrder++;
			new_state.cardsLeft--;

			if (new_state.cardsLeft === 0)
				new_state.endgameTurns = state.numPlayers;
		}
		else {
			new_state.endgameTurns--;
		}

		if (state.deck[newCardOrder] === undefined) {
			new_state.deck = new_state.deck.slice();
			new_state.deck[newCardOrder] = new ActualCard(-1, -1, newCardOrder, state.actionList.length);
		}
	};

	/** @param {Identity} identity */
	const update_discards = ({ suitIndex, rank }) => {
		const { discard_stacks } = state;
		const new_discard_stack = discard_stacks[suitIndex].with(rank - 1, discard_stacks[suitIndex][rank - 1] + 1);
		new_state.discard_stacks = discard_stacks.with(suitIndex, new_discard_stack);
	};

	switch (action.type) {
		case ACTION.PLAY: {
			const { playerIndex, target } = action;
			const identity = state.deck[target].identity();

			if (identity !== undefined) {
				const { suitIndex, rank } = identity;
				if (state.isPlayable(identity)) {
					new_state.play_stacks = state.play_stacks.with(suitIndex, rank);

					if (rank === 5)
						new_state.clue_tokens = Math.min(state.clue_tokens + 1, 8);
				}
				else {
					update_discards(identity);
					new_state.strikes++;
				}
			}
			else {
				new_state.strikes++;
			}

			remove_and_draw_new(playerIndex, target);
			break;
		}
		case ACTION.DISCARD: {
			const { playerIndex, target } = action;
			const identity = state.deck[target].identity();

			if (identity !== undefined)
				update_discards(identity);

			new_state.clue_tokens = Math.min(state.clue_tokens + 1, 8);
			remove_and_draw_new(playerIndex, target);
			break;
		}
		case ACTION.COLOUR:
		case ACTION.RANK:
			new_state.clue_tokens--;
			new_state.endgameTurns = state.endgameTurns === -1 ? -1 : (state.endgameTurns - 1);
			break;
	}

	return new_state;
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {ModPerformAction} action
 */
function advance_game(game, playerTurn, action) {
	const { state } = game;

	if (action.target !== -1)
		return game.simulate_action(Utils.performToAction(state, action, playerTurn, state.deck));

	const new_game = game.shallowCopy();
	new_game.state.clue_tokens--;
	new_game.state.turn_count++;
	new_game.state.endgameTurns = new_game.state.endgameTurns === -1 ? -1 : (new_game.state.endgameTurns - 1);
	return new_game;
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 */
function possible_actions(game, playerTurn, find_clues, find_discards) {
	const { state } = game;
	const actions = /** @type {ModPerformAction[]} */ ([]);

	const playables = game.players[playerTurn].thinksPlayables(state, playerTurn);
	for (const order of playables) {
		if (state.deck[order].identity() === undefined)
			continue;

		const action = { type: ACTION.PLAY, target: order, playerIndex: playerTurn };

		if (predict_winnable(state, playerTurn, action))
			actions.push(action);
	}

	const clue_winnable = predict_winnable(state, playerTurn, { type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn });
	let attempted_clue = false;

	if (state.clue_tokens > 0 && clue_winnable) {
		const clues = find_clues(game, playerTurn);

		for (const clue of clues) {
			const perform_action = Object.assign(Utils.clueToAction(clue, -1), { playerIndex: playerTurn });
			attempted_clue = true;

			actions.push(perform_action);
		}
	}

	if (state.pace >= 0) {
		const not_useful = state.hands[playerTurn].find(o => state.isBasicTrash(state.deck[o]));
		const discards = find_discards(game, playerTurn);

		if (discards.length === 0 && not_useful !== undefined)
			discards.push({ misplay: false, order: not_useful });

		for (const { misplay, order } of discards) {
			const action = { type: misplay ? ACTION.PLAY : ACTION.DISCARD, target: order, playerIndex: playerTurn };

			if (predict_winnable(state, playerTurn, action))
				actions.push(action);
		}
	}

	if (state.clue_tokens > 0 && clue_winnable && !attempted_clue)
		actions.push({ type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn });

	return actions;
}

/**
 * @typedef {{actions: ModPerformAction[] | undefined, win: boolean}} WinnableResult
 * 
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 * @returns {WinnableResult}
 */
function winnable_simple(game, playerTurn, find_clues, find_discards) {
	const { state } = game;

	if (state.score === state.maxScore)
		return { actions: [], win: true };

	if (Date.now() > timeout || unwinnable_state(state, playerTurn))
		return { actions: [], win: false };

	const hash = hash_game(game);

	const cached_result = simple_cache.get(hash);
	if (cached_result !== undefined)
		return cached_result;

	if (!winnable_simpler(state, playerTurn)) {
		simple_cache.set(hash, { actions: [], winrate: 0 });
		return { actions: [], win: false };
	}

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
	const actions = possible_actions(game, playerTurn, find_clues, find_discards);

	for (const action of actions) {
		const new_game = advance_game(game, playerTurn, action);
		const { actions, win } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards);

		const result = { actions: actions.toSpliced(0, 0, action), win };

		if (win) {
			simple_cache.set(hash, result);
			return result;
		}
	}

	simple_cache.set(hash, { actions: [], win: false });
	return { actions: [], win: false };
}

/**
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} find_clues
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} find_discards
 * @param {ModPerformAction[]} [exclude]
 */
function winnable(game, playerTurn, find_clues, find_discards, exclude = []) {
	const { state } = game;

	/** @type {Map<ModPerformAction, boolean>} */
	const results = new Map();

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
	const actions = possible_actions(game, playerTurn, find_clues, find_discards).filter(action => !exclude.some(e => Utils.objEquals(e, action)));

	for (const action of actions) {
		const new_game = advance_game(game, playerTurn, action);
		const { win } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards);

		results.set(action, win);
	}

	return results;
}

if (!isMainThread) {
	const game = conventions[workerData.conv].fromJSON(workerData.game);
	Utils.globalModify({ game });

	simple_cache.clear();
	simpler_cache.clear();

	logger.off();

	const { find_clues, find_discards } = ENDGAME_SOLVING_FUNCS[workerData.conv];

	try {
		const action = solve_game(game, workerData.playerTurn, find_clues, find_discards);
		parentPort.postMessage({ success: true, action });
	}
	catch (err) {
		if (err instanceof UnsolvedGame)
			parentPort.postMessage({ success: false, err });
		else
			throw err;
	}
}
