import { ActualCard } from '../../basics/Card.js';
import { ACTION } from '../../constants.js';
import { produce } from '../../StateProxy.js';
import { logCard, logClue, logObjectiveAction } from '../../tools/log.js';
import logger from '../../tools/logger.js';

import * as Utils from '../../tools/util.js';

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

		const best_actions = {};
		const hash_to_actions = {};

		const possible_locs = unknown_own.concat(Utils.range(0, state.cardsLeft).map(i => state.cardOrder + i + 1));
		const arrangements = Utils.allSubsetsOfSize(possible_locs, unseen_identities.length)
			.flatMap(subset => Utils.permutations(subset))
			.filter(orders => orders.every((o, i) => !unknown_own.includes(o) || me.thoughts[o].possible.has(unseen_identities[i])));

		for (const locs of arrangements) {
			logger.debug('trying locs', locs);
			const new_state = common_state.minimalCopy();

			// Arrange deck
			for (let i = 0; i < locs.length; i++) {
				const identity = unseen_identities[i];
				const order = locs[i];

				if (unknown_own.includes(order))
					new_state.deck = new_state.deck.with(order, produce(new_state.deck[order], Utils.assignId(identity)));
				else
					new_state.deck[order] = new ActualCard(identity.suitIndex, identity.rank, order);
			}

			let found_solution = true;
			const solutions = [];

			while (found_solution) {
				found_solution = false;
				logger.collect();

				const new_game = game.minimalCopy();
				new_game.state = new_state.minimalCopy();

				const { actions, winrate } = winnable_simple(new_game, playerTurn, find_clues, find_discards, new Map(), solutions);

				if (winrate === 1) {
					const hash = logObjectiveAction(new_state, actions[0]);
					logger.debug('cyan', 'won with', actions.map(a => logObjectiveAction(new_state, a)).join(', '));

					if (solutions.some(sol => Utils.objEquals(actions[0], sol)))
						continue;

					best_actions[hash] ??= 0;
					best_actions[hash] += 1 / arrangements.length;
					hash_to_actions[hash] = actions[0];

					found_solution = true;
					solutions.push(actions[0]);
				}
				logger.flush(false);
			}
		}

		if (Object.keys(best_actions).length === 0)
			throw new UnsolvedGame(`couldn't find a winning strategy`);

		const sorted_actions = Object.entries(best_actions).sort(([_, p1], [__, p2]) => p2 - p1);

		logger.highlight('purple', `endgame winnable! found action ${sorted_actions[0][0]} with winrate ${sorted_actions[0][1]}`);
		return hash_to_actions[sorted_actions[0][0]];
	}

	const new_game = game.shallowCopy();
	new_game.state = common_state;

	const { actions, winrate } = winnable_simple(new_game, playerTurn, find_clues, find_discards);

	if (winrate === 0)
		throw new UnsolvedGame(`couldn't find a winning strategy`);

	logger.highlight('purple', `endgame solved! found actions [${actions.map(action => logObjectiveAction(common_state, action)).join(', ')}] with winrate ${winrate}`);
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

	return `${hands},${clue_tokens},${endgameTurns}`;
}

/**
 * @param {State} state
 */
function hash_state(state) {
	const { clue_tokens, endgameTurns } = state;
	const hands = state.hands.flatMap(hand => hand.map(o => logCard(state.deck[o]))).join();

	return `${hands},${clue_tokens},${endgameTurns}`;
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
 * @param {Map<string, boolean>} [cache]
 * @returns {boolean}
 */
export function winnable_simpler(state, playerTurn, cache = new Map()) {
	if (state.score === state.maxScore)
		return true;

	if (Date.now() > timeout || unwinnable_state(state, playerTurn))
		return false;

	const cached_result = cache.get(hash_state(state));
	if (cached_result !== undefined)
		return cached_result;

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);

	for (const order of state.hands[playerTurn]) {
		const card = state.deck[order];

		if (!state.isPlayable(card))
			continue;

		const new_state = state.shallowCopy();
		const newCardOrder = state.cardOrder + 1;

		new_state.play_stacks = state.play_stacks.with(card.suitIndex, card.rank);
		new_state.hands[playerTurn] = state.hands[playerTurn].toSpliced(state.hands[playerTurn].indexOf(order), 1);

		if (state.endgameTurns === -1) {
			new_state.hands[playerTurn].unshift(newCardOrder);

			if (state.deck[newCardOrder] === undefined) {
				new_state.deck = state.deck.slice();
				new_state.deck[newCardOrder] = new ActualCard(-1, -1, newCardOrder, state.actionList.length);
			}

			new_state.cardOrder++;
			new_state.cardsLeft--;

			if (new_state.cardsLeft === 0)
				new_state.endgameTurns = state.numPlayers;
		}
		else {
			new_state.endgameTurns--;
		}

		if (winnable_simpler(new_state, nextPlayerIndex, cache))
			return true;
	}

	if (state.clue_tokens > 0) {
		const new_state = state.shallowCopy();
		new_state.clue_tokens--;
		new_state.endgameTurns = state.endgameTurns === -1 ? -1 : (state.endgameTurns - 1);

		if (winnable_simpler(new_state, nextPlayerIndex, cache))
			return true;
	}

	const discardable = state.hands[playerTurn].find(o => ((c = state.deck[o]) => c.identity() === undefined || state.isBasicTrash(c))());

	if (state.pace >= 0 && discardable !== undefined) {
		const new_state = state.shallowCopy();
		const newCardOrder = state.cardOrder + 1;

		new_state.hands[playerTurn] = state.hands[playerTurn].toSpliced(state.hands[playerTurn].indexOf(discardable), 1);

		if (state.endgameTurns === -1) {
			new_state.hands[playerTurn].unshift(newCardOrder);

			if (state.deck[newCardOrder] === undefined) {
				new_state.deck = state.deck.slice();
				new_state.deck[newCardOrder] = new ActualCard(-1, -1, newCardOrder, state.actionList.length);
			}

			new_state.cardOrder++;
			new_state.cardsLeft--;

			if (new_state.cardsLeft === 0)
				new_state.endgameTurns = state.numPlayers;
		}
		else {
			new_state.endgameTurns--;
		}
		new_state.clue_tokens = Math.min(state.clue_tokens + 1, 8);

		if (winnable_simpler(new_state, nextPlayerIndex, cache))
			return true;
	}

	cache.set(hash_state(state), false);
	return false;
}

/**
 * @typedef {{actions: ModPerformAction[] | undefined, winrate: number}} WinnableResult
 * 
 * @param {Game} game
 * @param {number} playerTurn
 * @param {(game: Game, giver: number) => Clue[]} [find_clues]
 * @param {(game: Game, playerIndex: number) => { misplay: boolean, order: number }[]} [find_discards]
 * @param {Map<string, WinnableResult>} [cache]
 * @param {ModPerformAction[]} [exclude]
 * @returns {WinnableResult}
 */
export function winnable_simple(game, playerTurn, find_clues = () => [], find_discards = () => [], cache = new Map(), exclude = []) {
	const { state } = game;

	if (state.score === state.maxScore)
		return { actions: [], winrate: 1 };

	if (Date.now() > timeout || unwinnable_state(state, playerTurn))
		return { actions: [], winrate: 0 };

	const cached_result = cache.get(hash_game(game));
	if (cached_result !== undefined)
		return cached_result;

	if (!winnable_simpler(state, playerTurn)) {
		cache.set(hash_game(game), { actions: [], winrate: 0 });
		return { actions: [], winrate: 0 };
	}

	const nextPlayerIndex = state.nextPlayerIndex(playerTurn);
	const playables = game.players[playerTurn].thinksPlayables(state, playerTurn);

	let best_actions = [], best_winrate = 0;
	const not_useful = state.hands[playerTurn].find(o => state.isBasicTrash(state.deck[o]));

	const attempt_discard = () => {
		const new_state = state.shallowCopy();
		new_state.clue_tokens++;

		if (!winnable_simpler(new_state, nextPlayerIndex))
			return { actions: [], winrate: 0 };

		const discards = find_discards(game, playerTurn);

		if (discards.length === 0 && not_useful !== undefined)
			discards.push({ misplay: false, order: not_useful });

		for (const { misplay, order } of discards) {
			const perform_action = { type: ACTION.DISCARD, target: order, playerIndex: playerTurn };

			if (exclude.some(action => Utils.objEquals(action, perform_action)))
				continue;

			const { suitIndex, rank } = state.deck[order];
			logger.info(state.turn_count, state.playerNames[playerTurn], 'trying to discard slot', state.hands[playerTurn].findIndex(o => o === order) + 1);

			const new_game = game.simulate_action({ type: 'discard', order, playerIndex: playerTurn, suitIndex, rank, failed: misplay });
			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, perform_action);
				best_winrate = winrate;
			}
		}
	};

	const attempt_stall = () => {
		const new_state = state.shallowCopy();
		new_state.clue_tokens--;

		if (!winnable_simpler(new_state, state.nextPlayerIndex(playerTurn)))
			return { actions: [], winrate: 0 };

		const perform_action = { type: ACTION.RANK, target: -1, value: -1, playerIndex: playerTurn };

		if (exclude.some(action => Utils.objEquals(action, perform_action)))
			return;

		const clue_game = game.shallowCopy();
		clue_game.state.clue_tokens--;
		clue_game.state.turn_count++;
		clue_game.state.endgameTurns = clue_game.state.endgameTurns === -1 ? -1 : (clue_game.state.endgameTurns - 1);

		logger.info(state.turn_count, state.playerNames[playerTurn], 'trying to stall');
		const { actions, winrate } = winnable_simple(clue_game, nextPlayerIndex, find_clues, find_discards, cache);

		if (winrate > best_winrate) {
			best_actions = actions.toSpliced(0, 0, perform_action);
			best_winrate = winrate;
		}
	};

	for (const order of playables) {
		if (state.deck[order].identity() === undefined)
			continue;

		const perform_action = { type: ACTION.PLAY, target: order, playerIndex: playerTurn };

		if (exclude.some(action => Utils.objEquals(action, perform_action)))
			continue;

		const { suitIndex, rank } = state.deck[order];
		logger.info(state.turn_count, state.playerNames[playerTurn], 'trying to play', logCard({ suitIndex, rank }));

		const new_game = game.simulate_action({ type: 'play', order, suitIndex, rank, playerIndex: playerTurn });
		const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

		if (winrate >= best_winrate) {
			best_actions = actions.toSpliced(0, 0, perform_action);
			best_winrate = winrate;
		}

		if (best_winrate === 1)
			break;
	}

	let attempted_clue = false;

	if (best_winrate < 1 && state.clue_tokens > 0) {
		const new_state = state.shallowCopy();
		new_state.clue_tokens--;

		if (!winnable_simpler(new_state, state.nextPlayerIndex(playerTurn)))
			return { actions: [], winrate: 0 };


		const clues = find_clues(game, playerTurn);

		for (const clue of clues) {
			const perform_action = Object.assign(Utils.clueToAction(clue, -1), { playerIndex: playerTurn });

			if (exclude.some(action => Utils.objEquals(action, perform_action)))
				continue;

			logger.info(state.turn_count, state.playerNames[playerTurn], 'trying to clue', logClue(clue));
			attempted_clue = true;

			const list = state.clueTouched(state.hands[clue.target], clue);
			const new_game = game.simulate_clue({ type: 'clue', clue, list, giver: playerTurn, target: clue.target });

			const { actions, winrate } = winnable_simple(new_game, nextPlayerIndex, find_clues, find_discards, cache);

			if (winrate > best_winrate) {
				best_actions = actions.toSpliced(0, 0, perform_action);
				best_winrate = winrate;
			}

			if (best_winrate === 1)
				break;
		}
	}

	if (state.inEndgame()) {
		if (best_winrate < 1 && state.clue_tokens > 0 && !attempted_clue)
			attempt_stall();

		if (best_winrate < 1 && state.pace >= 0)
			attempt_discard();
	}
	else {
		if (best_winrate < 1 && state.pace >= 0)
			attempt_discard();

		if (best_winrate < 1 && state.clue_tokens > 0 && !attempted_clue)
			attempt_stall();
	}

	Utils.globalModify({ game });

	const result = { actions: best_actions, winrate: best_winrate };
	cache.set(hash_game(game), result);

	return result;
}
