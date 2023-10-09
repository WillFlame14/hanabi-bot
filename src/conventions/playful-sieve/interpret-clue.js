import { CLUE } from '../../constants.js';
import { Card } from '../../basics/Card.js';
import { isTrash, refer_right } from '../../basics/hanabi-util.js';
import { bad_touch_possibilities, update_hypo_stacks } from '../../basics/helper.js';
import * as Basics from '../../basics.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard, logHand } from '../../tools/log.js';


/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').BasicCard} BasicCard
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 */
function infer_elim(state, playerIndex, suitIndex, rank) {
	// We just learned about the card
	if (playerIndex === state.ourPlayerIndex) {
		for (let i = 0; i < state.numPlayers; i++) {
			Basics.card_elim(state, i, suitIndex, rank);
		}
	}
	// Everyone already knew about the card except the person who drew it
	else {
		Basics.card_elim(state, playerIndex, suitIndex, rank);
	}
}

/**
 * Interprets the given clue.
 * @param  {State} state
 * @param  {ClueAction} action
 */
export function interpret_clue(state, action) {
	const { clue, giver, list, target } = action;
	const hand = state.hands[target];
	const partner_hand = state.hands[giver];

	const had_inferences = hand.filter(c => c.inferred.length > 0).map(c => c.order);
	const old_playables = hand.find_playables().map(c => c.order);
	const old_trash = hand.find_known_trash().map(c => c.order);

	for (const card of state.hands[target]) {
		if (card.inferred.length > 0) {
			had_inferences.push(card.order);
		}
	}

	const no_info = hand.every(card => !list.includes(card.order) || card.clues.some(c => Utils.objEquals(c, clue)));

	Basics.onClue(state, action);

	let fix = false;

	let bad_touch = bad_touch_possibilities(state, giver, target);
	let bad_touch_len;

	// Recursively deduce information until no new information is learned
	do {
		bad_touch_len = bad_touch.length;
		const reduced_inferences = [];

		for (const card of state.hands[target]) {
			if (card.inferred.length > 1 && (card.clued || card.chop_moved)) {
				card.subtract('inferred', bad_touch);
				reduced_inferences.push(card);
			}

			if (had_inferences.includes(card.order) && card.inferred.length === 0) {
				fix = true;
				card.inferred = Utils.objClone(card.possible);
				card.subtract('inferred', bad_touch);
				card.reset = true;
				reduced_inferences.push(card);
			}
		}

		for (const card of reduced_inferences) {
			if (card.inferred.length === 1) {
				infer_elim(state, target, card.inferred[0].suitIndex, card.inferred[0].rank);
			}
		}
		bad_touch = bad_touch_possibilities(state, giver, target, bad_touch);
	}
	while (bad_touch_len !== bad_touch.length);

	for (const card of hand) {
		// Revoke ctd if clued
		if (card.called_to_discard && card.clued) {
			card.called_to_discard = false;
		}

		const last_action = state.last_actions[giver];

		// Revoke finesse if newly clued after a possibly matching play
		if (card.finessed && card.newly_clued && last_action.type === 'play') {
			const { suitIndex, rank } = state.last_actions[giver].card;

			logger.warn('revoking finesse?', card.possible.map(p => logCard(p)), logCard({ suitIndex, rank }));

			if (card.possible.some(c => c.matches(suitIndex, rank))) {
				card.inferred = [new Card(suitIndex, rank)];
				card.finessed = false;
			}
		}
	}

	update_hypo_stacks(state);

	const newly_touched = Utils.findIndices(hand, (card) => card.newly_clued);
	const trash_push = hand.every(card => !list.includes(card.order) ||
		(card.newly_clued && card.inferred.every(inf => isTrash(state, state.ourPlayerIndex, inf.suitIndex, inf.rank, card.order))));

	if (trash_push) {
		logger.highlight('cyan', 'trash push!')
	}

	if (partner_hand.isLocked()) {
		if (clue.type === CLUE.RANK) {
			// Rank fill-in/trash reveal, no additional meaning
			if (hand.find_known_trash().length + hand.filter(card => card.called_to_discard).length > 0) {
				return;
			}

			// Referential discard
			if (newly_touched.length > 0 && !trash_push) {
				const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (card) => !card.clued, index)));
				const target_index = referred.reduce((min, curr) => Math.min(min, curr));

				// Don't call to discard if that's the only card touched
				if (!newly_touched.every(index => index === target_index)) {
					hand[target_index].called_to_discard = true;
				}
			}
			else {
				// Fill-in (locked hand ptd on slot 1)
				hand[0].called_to_discard = true;
			}
		}
		// Colour clue
		else {
			const suitIndex = clue.value;

			// Slot 1 is playable
			if (hand[0].newly_clued) {
				hand[0].intersect('inferred', [{ suitIndex, rank: state.hypo_stacks[state.ourPlayerIndex][suitIndex] + 1 }]);
			}
			else {
				// Colour fill-in/trash reveal, no additional meaning
				if (hand.find_known_trash().length + hand.filter(card => card.called_to_discard).length > 0) {
					return;
				}

				// Fill-in (locked hand ptd on slot 1)
				hand[0].called_to_discard = true;
			}
		}
		return;
	}

	if (!trash_push && (hand.find_playables().length > old_playables.length || hand.find_known_trash(true).length > old_trash.length)) {
		logger.info('new safe action provided, not continuing');
	}
	else if (fix) {
		logger.info('fix clue, not continuing');
	}
	else if (no_info) {
		logger.highlight('cyan', 'no info clue! trash dump');

		for (const card of hand) {
			if (!card.clued && !card.finessed && !card.chop_moved) {
				card.called_to_discard = true;
			}
		}
	}
	else {
		const playable_possibilities = state.hypo_stacks[giver].map((rank, suitIndex) => {
			return { suitIndex, rank: rank + 1 };
		});

		// Referential play (right)
		if (clue.type === CLUE.COLOUR || trash_push) {
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(hand, index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Telling chop to play while not loaded, lock
				if (target_index === 0 && !hand.isLoaded()) {
					for (const card of hand) {
						if (!card.clued) {
							card.chop_moved = true;
						}
					}
					logger.highlight('yellow', 'lock!');
					state.last_actions[giver].lock = true;
					return;
				}

				hand[target_index].finessed = true;
				hand[target_index].intersect('inferred', playable_possibilities);
				logger.info(`ref play on ${state.playerNames[target]}'s slot ${target_index + 1}`);
				return;
			}
			else {
				// Fill-in (anti-finesse)
				hand[0].called_to_discard = true;
				return;
			}
		}
		// Referential discard (right)
		else {
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (card) => !card.clued, index)));
				const target_index = referred.reduce((min, curr) => Math.min(min, curr));

				hand[target_index].called_to_discard = true;
				logger.info(`ref discard on ${state.playerNames[target]}'s slot ${target_index + 1}`);
			}
			else {
				// Fill-in (anti-finesse)
				hand[0].called_to_discard = true;
				return;
			}
		}
	}

	hand.refresh_links();
	update_hypo_stacks(state);
}
