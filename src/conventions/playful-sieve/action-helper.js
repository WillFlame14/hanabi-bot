import { bad_touch_result, elim_result, playables_result } from '../../basics/clue-result.js';
import { cardValue } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
export function get_result(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const touch = state.hands[partner].clueTouched(clue, state.variant);

	if (touch.length === 0)
		throw new Error(`Tried to get a result with a clue ${logClue(clue)} that touches no cards!`);

	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target: partner, list: touch.map(c => c.order), clue });
	const { bad_touch, trash } = bad_touch_result(hypo_state, hypo_state.common, hypo_state.hands[partner]);

	const { new_touched, fill, elim } = elim_result(state.common, hypo_state.common, hypo_state.hands[partner], touch.map(c => c.order));
	const revealed_trash = hypo_state.common.thinksTrash(hypo_state, partner).filter(c1 =>
		c1.clued && !state.common.thinksTrash(state, partner).some(c2 => c1.order !== c2.order));
	const { playables } = playables_result(hypo_state, state.common, hypo_state.common);

	const { card: bad_playable } = playables.find(({card}) =>
		hypo_state.common.thoughts[card.order].inferred.every(inf => !state.me.thoughts[card.order].matches(inf))) ?? {};

	if (bad_playable) {
		logger.info(logClue(clue), 'results in', logCard(state.me.thoughts[bad_playable.order]), 'looking playable when it isn\'t');
		return { hypo_state, value: -10 };
	}

	const new_discards = hypo_state.hands[partner].filter(c =>
		hypo_state.common.thoughts[c.order].called_to_discard && !state.common.thoughts[c.order].called_to_discard);

	const good_touch = new_touched - (bad_touch + trash);

	const value_log = {
		good_touch,
		playables: playables.map(p => logCard(p.card)),
		new_discards: new_discards.map(logCard),
		trash: revealed_trash.map(logCard),
		fill,
		elim,
		bad_touch
	};

	const value = parseFloat((0.25*good_touch +
		playables.length +
		new_discards.reduce((acc, curr) => acc + (1.5 - (new_discards ? cardValue(state, state.me, curr, curr.order) : 1.5)) / 3, 0) +
		0.5*revealed_trash.length +
		0.25*fill +
		0.05*elim -
		0.1*bad_touch).toFixed(2));

	logger.info(logClue(clue), value, JSON.stringify(value_log));

	return { hypo_state, value };
}

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
export function clue_value(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const touch = state.hands[partner].clueTouched(clue, state.variant);

	if (touch.length === 0)
		return -9999;

	return get_result(state, clue).value;
}
