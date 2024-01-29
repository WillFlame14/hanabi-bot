import { CLUE } from '../../constants.js';
import { bad_touch_result, elim_result, playables_result } from '../../basics/clue-result.js';
import { cardValue, isTrash, playableAway, refer_right } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

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
	const touch = state.hands[partner].clueTouched(clue, state.suits);

	if (touch.length === 0) {
		throw new Error(`Tried to get a result with a clue ${logClue(clue)} that touches no cards!`);
	}
	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target: partner, list: touch.map(c => c.order), clue });
	const { bad_touch, trash } = bad_touch_result(hypo_state, hypo_state.common, hypo_state.hands[partner]);

	const { new_touched, fill, elim } = elim_result(state.common, hypo_state.common, hypo_state.hands[partner], touch.map(c => c.order));
	const revealed_trash = hypo_state.common.thinksTrash(hypo_state, partner).filter(c1 =>
		c1.clued && !state.common.thinksTrash(state, partner).some(c2 => c1.order !== c2.order));
	const { safe_playables: playables } = playables_result(hypo_state, state.common, hypo_state.common, clue.target);

	const good_touch = new_touched - (bad_touch + trash);

	const value = 0.25*good_touch +
		playables.length +
		0.5*revealed_trash.length +
		0.25*fill +
		0.05*elim -
		0.1*bad_touch;

	logger.info(logClue(clue), value, 'good touch', good_touch, 'playables', playables.map(p => logCard(p.card)), 'trash', revealed_trash.map(logCard), 'fill', fill, 'elim', elim, 'bad touch', bad_touch);

	const bad_playable = playables.find(({ card }) => {
		const id = card.identity({ infer: true });
		return id !== undefined && !state.me.thoughts[card.order].matches(id);
	});

	if (bad_playable) {
		logger.info(logClue(clue), 'results in', logCard(bad_playable.card), 'looking playable when it isn\'t');
		return { hypo_state, value: -1, referential: false };
	}

	const referential = !(state.common.thinksLocked(state, state.ourPlayerIndex) && clue.type === CLUE.COLOUR) &&
		playables.length === 0 && (revealed_trash.length === 0 || revealed_trash.every(c => c.newly_clued));
	return { hypo_state, value, referential };
}

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
export function clue_value(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];
	const touch = partner_hand.clueTouched(clue, state.suits);

	if (touch.length === 0) {
		return -1;
	}

	const result = get_result(state, clue);
	const { hypo_state, referential } = result;
	let value = result.value;

	if (value === -10) {
		return -1;
	}

	if (referential) {
		const newly_touched = Utils.findIndices(hypo_state.hands[partner], card => card.newly_clued);
		const touch = hypo_state.hands[partner].clueTouched(clue, state.suits);
		const fix = (() => {
			const oldTrash = state.common.thinksTrash(state, partner);
			const newTrash = hypo_state.common.thinksTrash(state, partner);
			return touch.some(t => newTrash.some(c => c.order === t.order) && !oldTrash.some(c => c.order === t.order) && !t.newly_clued);
		})();
		const trash_push = !fix && touch.every(c =>
			!c.newly_clued || hypo_state.common.thoughts[c.order].inferred.every(inf => isTrash(hypo_state, hypo_state.common, inf, c.order))) &&
			touch.some(c => c.newly_clued);

		if (clue.type === CLUE.RANK && !trash_push) {
			const looks_directly_playable = newly_touched.filter(i =>
				hypo_state.common.thoughts[partner_hand[i].order].inferred.every(inf => playableAway(state, inf) === 0));

			if (looks_directly_playable.length > 0) {
				const focus = partner_hand[looks_directly_playable[0]];

				if (playableAway(state, focus) !== 0) {
					logger.warn(logCard(focus), 'looks directly playable but isn\'t');
					return -1;
				}

				const directly_playable = looks_directly_playable.filter(i => playableAway(state, partner_hand[i]) === 0);
				logger.info('adding directly playable', directly_playable.map(i => logCard(partner_hand[i])));
				value += directly_playable.length;
			}
			else {
				const get_target_index = () => {
					if (newly_touched.length === 0) {
						// Fill in with no playables (discard chop)
						return 0;
					}

					const referred = newly_touched.map(index =>
						Math.max(0, Utils.nextIndex(hypo_state.hands[partner], (card) => !card.clued, index)));
					return referred.reduce((min, curr) => Math.min(min, curr));
				};

				const target_index = get_target_index();
				const dc_value = cardValue(state, state.me, partner_hand[target_index]);

				if (target_index === 0 && newly_touched.includes(0)) {
					logger.warn('looks like lock, skipping');
					return -1;
				}

				logger.info('targeting slot', target_index + 1, logCard(partner_hand[target_index]), 'for discard with clue', clue.value, 'and value', dc_value, (3.5 - dc_value) / 3.5);
				if (dc_value >= 4) {
					logger.warn('high value card, skipping');
					return -1;
				}

				value += (3.5 - dc_value) / 3.5;
			}
		}
		else {
			const newly_touched = Utils.findIndices(partner_hand, card => touch.some(c => c.order === card.order) && !card.clued);
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(partner_hand, index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Unloaded referential play on chop is not a play
				if (target_index === 0 && !state.common.thinksLoaded(state, partner) && !trash_push) {
					return -2;
				}

				const target_card = partner_hand[target_index];

				// Target card is not delayed playable
				if (state.common.thinksLoaded(state, partner) ? state.me.hypo_stacks[target_card.suitIndex] + 1 !== target_card.rank : playableAway(state, target_card) !== 0) {
					return -1;
				}
				return 10;
			}
			// Fill in with no playables (discard chop)
			else {
				value += (3.5 - cardValue(state, state.me, partner_hand[0])) / 3.5;
			}
		}
	}
	return value;
}
