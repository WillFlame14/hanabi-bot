import { bad_touch_result, elim_result, playables_result } from '../../basics/clue-result.js';
import { cardValue } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} Game
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param  {Game} game
 * @param  {Clue} clue
 */
export function get_result(game, clue) {
	const { common, me, state } = game;
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const list = state.clueTouched(state.hands[partner], clue);

	if (list.length === 0)
		throw new Error(`Tried to get a result with a clue ${logClue(clue)} that touches no cards!`);

	const hypo_game = game.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target: partner, list, clue });
	const { common: hypo_common, state: hypo_state } = hypo_game;
	const { bad_touch, trash } = bad_touch_result(game, hypo_game, hypo_common, state.ourPlayerIndex, partner);

	const { new_touched, fill, elim } = elim_result(hypo_state, common, hypo_common, hypo_state.hands[partner], list);
	const revealed_trash = hypo_common.thinksTrash(hypo_state, partner).filter(o1 =>
		state.deck[o1].clued && !common.thinksTrash(state, partner).some(o2 => o1 !== o2));
	const { playables } = playables_result(hypo_state, common, hypo_common);

	// Card that looks playable but actually isn't
	const bad_playable = state.hands[partner].find(o => ((card = hypo_common.thoughts[o]) => card.finessed && !card.inferred.has(me.thoughts[o]))());

	if (bad_playable) {
		logger.info(logClue(clue), 'results in', logCard(me.thoughts[bad_playable]), 'looking playable when it isn\'t');
		return { hypo_game, value: -10 };
	}

	const new_discards = hypo_state.hands[partner].filter(o =>
		hypo_common.thoughts[o].called_to_discard && !common.thoughts[o].called_to_discard);

	const good_touch = new_touched.length - (bad_touch.length + trash.length);

	const value_log = {
		good_touch,
		playables: playables.map(p => logCard(p.card)),
		new_discards: new_discards.map(o => logCard(state.deck[o])),
		trash: revealed_trash.map(o => logCard(state.deck[o])),
		fill,
		elim,
		bad_touch
	};

	const value = parseFloat((0.25*good_touch +
		playables.length +
		new_discards.reduce((acc, curr) => acc + (1.5 - (new_discards ? cardValue(state, me, state.deck[curr], curr) : 1.5)) / 3, 0) +
		0.5*revealed_trash.length +
		0.25*fill +
		0.05*elim -
		0.1*bad_touch.length).toFixed(2));

	logger.info(logClue(clue), value, JSON.stringify(value_log));

	return { hypo_game, value };
}

/**
 * @param  {Game} game
 * @param  {Clue} clue
 */
export function clue_value(game, clue) {
	const { state } = game;
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const touch = state.clueTouched(state.hands[partner], clue);

	if (touch.length === 0)
		return -9999;

	return get_result(game, clue).value;
}
