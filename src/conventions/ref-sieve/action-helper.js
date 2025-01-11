import { CLUE_INTERP } from './rs-constants.js';
import { bad_touch_result, elim_result, playables_result } from '../../basics/clue-result.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logAction, logCard, logClue } from '../../tools/log.js';
import { cardValue } from '../../basics/hanabi-util.js';


/**
 * @typedef {import('../ref-sieve.js').default} Game
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').Action} Action
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param {Game} game
 * @param {Action} action
 */
function advance_game(game, action) {
	return action.type === 'clue' ? game.simulate_clue(action) : game.simulate_action(action);
}

/**
 * @param {Game} new_game
 * @param {number} i
 * @param {number} value
 * @returns {{new_game: Game, value: number}}
 */
function best_value(new_game, i, value) {
	const { common, me, state } = new_game;
	const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

	if (playerIndex === state.ourPlayerIndex)
		return { new_game, value };

	/** @param {number} x */
	const mult = (x) => x * ((i === 1 || state.clue_tokens === 0) ? (x < 0 ? 1.25 : 0.25) : 0.1);

	const sieving_trash = () => {
		if (state.inEndgame() || state.maxScore - state.score < state.variant.suits.length || me.hypo_score === state.maxScore)
			return false;

		const chop = state.hands[playerIndex][0];
		const id = state.deck[chop].identity();

		return (state.isBasicTrash(id) || state.hands.some((hand, pi) => {
			const loaded = common.thinksLoaded(state, pi);
			return hand.some((o, i) => o !== chop && state.deck[o].matches(id) && !common.thoughts[o].called_to_discard && (i !== 0 || loaded));
		}));
	};

	const playables = common.thinksPlayables(state, playerIndex, { symmetric: true });

	if (playables.length > 0) {
		const play_actions = playables.map(order => {
			const { suitIndex, rank } = state.deck[order];
			return /** @type {const} */ ({ type: 'play', suitIndex, rank, order, playerIndex });
		});

		const next_games = play_actions.map(action => {
			const diff = (state.isPlayable(action) ? (action.rank === 5 ? 1.75 : 1.5) : -10) + (sieving_trash() ? -10 : 0);
			const new_value = value + mult(diff);

			logger.info(state.playerNames[playerIndex], 'playing', logCard(action), mult(diff).toFixed(2));
			return best_value(advance_game(new_game, action), i + 1, new_value);
		});
		return Utils.maxOn(next_games, g => g.value);
	}

	if (common.thinksLocked(state, playerIndex) || (i === 1 && state.clue_tokens === 8)) {
		const next_game = new_game.minimalCopy();
		next_game.state.clue_tokens--;

		const diff = (state.clue_tokens === 0) ? -10 : (sieving_trash() ? -10 : -0.25);
		const new_value = value + mult(diff);

		logger.info(state.playerNames[playerIndex], 'forced clue', mult(diff));
		return best_value(next_game, i + 1, new_value);
	}

	const discard = common.thinksTrash(state, playerIndex)[0] ??
		state.hands[playerIndex].find(o => common.thoughts[o].called_to_discard) ??
		state.hands[playerIndex][0];

	const { suitIndex, rank } = state.deck[discard];
	const action = /** @type {const} */({ type: 'discard', suitIndex, rank, order: discard, playerIndex, failed: false});
	const diff = 0.25 + (1 - cardValue(state, me, state.deck[discard], discard)) + (discard !== state.hands[playerIndex][0] && sieving_trash() ? -10 : 0);
	const new_value = value + mult(diff);

	logger.info(state.playerNames[playerIndex], 'discarding', logCard(action), mult(diff).toFixed(2), diff);
	return best_value(advance_game(new_game, action), i + 1, new_value);
}

/**
 * @param {Game} game
 * @param {Action} action
 */
export function predict_value(game, action) {
	const { common, me, state } = game;
	const hypo_game = advance_game(game, action);

	let value = 0;

	if (action.type === 'clue') {
		if (hypo_game.lastMove === CLUE_INTERP.NONE) {
			logger.info(`${logAction(action)}: -10 (${hypo_game.lastMove})`);
			return -100;
		}

		const mult = me.thinksPlayables(state, state.ourPlayerIndex).length > 0 ? (state.inEndgame() ? 0.1 : 0.25) : 0.5;

		value += get_result(game, hypo_game, action)*mult - 0.25;
	}
	else if (action.type === 'play') {
		value += 1.5;
	}
	else if (action.type === 'discard') {
		const mult = state.inEndgame() ? 0.2 : 1;
		// Discarding known trash is particularly good compared to ref dc and chop
		if (common.thinksTrash(state, action.playerIndex).some(o => o == action.order))
			value += 1.5*mult;
		else if (action.intentional)
			value += 2*mult;
		else
			value += 0.5*mult;
	}

	logger.info('starting value', value.toFixed(2));

	const { value: best } = best_value(hypo_game, 1, value);
	logger.highlight('green', `${logAction(action)}: ${best.toFixed(2)} (${hypo_game.lastMove})`);
	return best;
}

/**
 * @param {Game} game
 * @param {Game} hypo_game
 * @param {ClueAction} action
 */
export function get_result(game, hypo_game, action) {
	const { common, me, state } = game;
	const { clue, target } = action;
	const list = state.clueTouched(state.hands[target], clue);

	const clue_str = logClue({ ...clue, target });

	const { common: hypo_common, me: hypo_me, state: hypo_state } = hypo_game;
	const { bad_touch, trash } = bad_touch_result(game, hypo_game, hypo_common, state.ourPlayerIndex, target);

	const { new_touched, fill, elim } = elim_result(hypo_state, common, hypo_common, hypo_state.hands[target], list);
	const revealed_trash = hypo_common.thinksTrash(hypo_state, target).filter(o =>
		hypo_state.deck[o].clued && !common.thinksTrash(state, target).includes(o));
	const { playables } = playables_result(hypo_state, me, hypo_me);

	// Card that looks playable but actually isn't
	const bad_playable = state.hands[target].find(o =>
		hypo_common.thoughts[o].finessed && !hypo_me.hypo_plays.has(o));

	if (bad_playable !== undefined) {
		logger.info(clue_str, 'results in', logCard(me.thoughts[bad_playable]), 'looking playable when it isn\'t');
		return -100;
	}

	if (hypo_game.lastMove === CLUE_INTERP.REF_PLAY && playables.length === 0) {
		logger.info(clue_str, 'looks like ref play but gets no playables!');
		return -100;
	}

	const bad_inferences = state.hands[target].find(o =>
		!bad_touch.includes(o) && !trash.includes(o) && !hypo_state.hasConsistentInferences(hypo_common.thoughts[o]));

	if (bad_inferences !== undefined) {
		logger.info(clue_str, 'gives wrong inferences to', bad_inferences, hypo_common.thoughts[bad_inferences].inferred.map(logCard).join());
		return -100;
	}

	if (hypo_game.lastMove === CLUE_INTERP.REVEAL && playables.length === 0 && trash.every(o => hypo_state.deck[o].newly_clued)) {
		logger.info(clue_str, `only reveals new trash but isn't a trash push!`);
		return -100;
	}

	const duped_playables = Array.from(hypo_me.hypo_plays).filter(p => state.hands.some(hand =>
		hand.some(o => o !== p && common.thoughts[o].touched && state.deck[o].matches(state.deck[p]))));

	const good_touch = [0, 0.25, 0.5, 0.6, 0.7, 0.75][new_touched.length - bad_touch.length + trash.length] ?? -1;

	const untouched_plays = playables.filter(p => !hypo_state.deck[p.card.order].clued).length;

	const value_log = {
		good_touch,
		playables: playables.map(p => `${logCard(state.deck[p.card.order])} ${p.card.order}`),
		duped: duped_playables,
		trash: revealed_trash,
		fill,
		elim,
		bad_touch
	};

	const value = parseFloat((good_touch
		+ (playables.length - 2*duped_playables.length)
		+ 0.2*untouched_plays
		+ 0.1*revealed_trash.length
		+ 0.1*fill
		+ 0.05*elim
		- 0.1*bad_touch.length).toFixed(2));

	logger.info(clue_str, value, JSON.stringify(value_log));

	return value;
}
