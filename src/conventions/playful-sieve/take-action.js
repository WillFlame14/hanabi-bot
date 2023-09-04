import { ACTION } from '../../constants.js';
import { CLUE } from '../../constants.js';
import { cardValue, isTrash, playableAway, refer_right } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard, logClue, logHand } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';
import { find_sarcastic } from './interpret-discard.js';
import { elim_result, playables_result } from '../../basics/clue-result.js';
import { unlock_promise } from './interpret-play.js';

/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
function get_result(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const touch = state.hands[partner].clueTouched(clue);

	if (touch.length === 0) {
		throw new Error(`Tried to get a result with a clue ${logClue(clue)} that touches no cards!`);
	}
	const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, target: partner, list: touch.map(c => c.order), clue });
	const bad_touch = touch.filter(card => !card.clued && isTrash(hypo_state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order));
	const trash = bad_touch.filter(card => card.possible.every(p => isTrash(hypo_state, partner, p.suitIndex, p.rank, card.order)));

	const { new_touched, elim } = elim_result(state, hypo_state, partner, touch.map(c => c.order));
	const revealed_trash = hypo_state.hands[partner].find_known_trash();
	const { playables } = playables_result(state, hypo_state, state.ourPlayerIndex);

	const good_touch = new_touched - (bad_touch.length - trash.length);

	// Touching 1 card is much better than touching none, but touching more cards is only marginally better
	const new_touched_value = (good_touch >= 1) ? 0.5 + 0.1 * (good_touch - 1) : 0;
	const value = new_touched_value +
		playables.length +
		0.5*revealed_trash.length +
		0.25*elim -
		0.2*bad_touch.length;

	// logger.info(logClue(clue), value, new_touched_value, playables.length, revealed_trash.length, elim, bad_touch.length);

	return { hypo_state, value, referential: playables.length === 0 && revealed_trash.length === 0 };
}

/**
 * @param  {State} state
 * @param  {Clue} clue
 */
function clue_value(state, clue) {
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];
	const touch = partner_hand.clueTouched(clue);

	if (touch.length === 0) {
		return -1;
	}

	const result = get_result(state, clue);
	const { hypo_state, referential } = result;
	let value = result.value;

	if (referential) {
		const newly_touched = Utils.findIndices(hypo_state.hands[partner], card => card.newly_clued);

		if (clue.type === CLUE.RANK) {
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
			const dc_value = cardValue(state, partner_hand[target_index]);

			logger.info('targeting slot', target_index + 1, logCard(partner_hand[target_index]), 'for discard with clue', clue.value, 'and value', dc_value, (3.5 - dc_value) / 3.5);
			if (dc_value >= 4) {
				logger.warn('high value card, skipping');
				return -1;
			}

			value += (3.5 - dc_value) / 3.5;
		}
		else {
			const newly_touched = Utils.findIndices(partner_hand, card => touch.some(c => c.order === card.order) && !card.clued);
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(partner_hand, index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Referential play on chop is not a play
				if (target_index === 0) {
					return -2;
				}

				const target_card = partner_hand[target_index];

				// Target card is not delayed playable
				if (state.hypo_stacks[state.ourPlayerIndex][target_card.suitIndex] + 1 !== target_card.rank) {
					return -1;
				}
				return 10;
			}
			// Fill in with no playables (discard chop)
			else {
				value += (3.5 - cardValue(state, partner_hand[0])) / 3.5;
			}
		}
	}
	return value;
}

/**
 * Performs the most appropriate action given the current state.
 * @param {State} state
 * @returns {PerformAction}
 */
export function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];

	// Look for playables, trash and important discards in own hand
	let playable_cards = hand.find_playables();
	let trash_cards = hand.find_known_trash().filter(c => c.clued);

	// Add cards called to discard
	for (const card of hand) {
		if (!trash_cards.some(c => c.order === card.order) && card.called_to_discard) {
			trash_cards.push(card);
		}
	}

	const discards = [];
	for (const card of playable_cards) {
		const id = card.identity({ infer: true });

		// Skip non-trash cards and cards we don't know the identity of
		if (!trash_cards.some(c => c.order === card.order) || id === undefined) {
			continue;
		}

		// If there isn't a matching playable card in our hand, we should discard it to sarcastic for someone else
		if (!playable_cards.some(c => c.matches(id.suitIndex, id.rank, { infer: true }) && c.order !== card.order)) {
			discards.push(card);
		}
	}

	// Remove trash cards from playables and discards from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order));

	if (playable_cards.length > 0) {
		logger.info('playable cards', logHand(playable_cards));
	}
	if (trash_cards.length > 0) {
		logger.info('trash cards', logHand(trash_cards));
	}
	if (discards.length > 0) {
		logger.info('discards', logHand(discards));
	}

	const playable_priorities = determine_playable_card(state, playable_cards);
	const priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);

	const chop = partner_hand[0];
	const chop_away = playableAway(state, chop.suitIndex, chop.rank);

	// Stalling situation
	if (hand.isLocked()) {
		// Forced discard
		if (state.clue_tokens === 0) {
			return { tableID, type: ACTION.DISCARD, target: hand.locked_discard().order };
		}

		// Bad situation (for now, just treat as forced discard)
		if (partner_hand.isLocked()) {
			return { tableID, type: ACTION.DISCARD, target: hand.locked_discard().order };
		}

		const chop_trash = isTrash(state, state.ourPlayerIndex, chop.suitIndex, chop.rank, chop.order);

		// Chop is delayed playable
		if (!chop_trash && state.hypo_stacks[state.ourPlayerIndex][chop.suitIndex] + 1 === chop.rank) {
			const clue = { type: CLUE.COLOUR, value: chop.suitIndex, target: partner };
			return Utils.clueToAction(clue, tableID);
		}

		/** @type {Clue} */
		let best_clue;
		let best_clue_value = 0;

		const clues = [];

		for (let rank = 1; rank <= 5; rank++) {
			const clue = { type: CLUE.RANK, value: rank, target: partner };
			clues.push(clue);
		}

		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			const clue = { type: CLUE.COLOUR, value: suitIndex, target: partner };
			clues.push(clue);
		}

		for (const clue of clues) {
			const touch = partner_hand.clueTouched(clue);

			// Can't give empty clues or clues touching chop
			if (touch.length === 0 || touch.some(card => card.order === chop.order)) {
				continue;
			}

			const value = clue_value(state, clue);

			if (value > best_clue_value) {
				best_clue = clue;
				best_clue_value = value;
			}
		}

		return Utils.clueToAction(best_clue, tableID);
	}

	if (partner_hand.isLoaded() || partner_hand.some(c => c.called_to_discard) || (chop_away === 0 && this.turn_count !== 1)) {
		state.locked_shifts = 0;

		if (playable_cards.length > 0) {
			return { tableID, type: ACTION.PLAY, target: playable_priorities[priority][0].order };
		}

		if (state.clue_tokens !== 8) {
			if (discards.length > 0) {
				return { tableID, type: ACTION.DISCARD, target: discards[0].order };
			}

			if (trash_cards.length > 0) {
				return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
			}

			// Bomb chop
			return { tableID, type: ACTION.PLAY, target: hand[0].order };
		}
	}

	if (partner_hand.isLocked()) {
		for (const playable of playable_cards) {
			const identity = playable.identity({ infer: true });

			if (identity !== undefined) {
				const unlocked = unlock_promise(state, {
					type: 'play',
					order: playable.order,
					playerIndex: state.ourPlayerIndex,
					suitIndex: identity.suitIndex,
					rank: identity.rank
				}, hand, partner_hand);

				if (unlocked?.matches(identity.suitIndex, identity.rank + 1)) {
					return { tableID, type: ACTION.PLAY, target: playable.order };
				}
			}
		}

		if (playable_cards.length > 0) {
			state.locked_shifts++;
		}

		if (discards.length > 0) {
			return { tableID, type: ACTION.DISCARD, target: discards[0].order };
		}

		if (trash_cards.length > 0) {
			return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
		}

		if (playable_cards.length > 0) {
			return { tableID, type: ACTION.PLAY, target: Utils.maxOn(playable_cards, (card) => -card.reasoning.at(-1)).order };
		}

		return { tableID, type: ACTION.DISCARD, target: hand.locked_discard().order };
	}

	// Partner isn't loaded/locked and their chop isn't playable
	state.locked_shifts = 0;

	if (chop_away === 1) {
		const connecting_playable = playable_cards.find(card =>
			card.suitIndex === chop.suitIndex && card.rank === state.play_stacks[chop.suitIndex] + 1);

		if (connecting_playable !== undefined) {
			return { tableID, type: ACTION.PLAY, target: connecting_playable.order };
		}
	}

	const playable_sarcastic = discards.find(card =>
		playableAway(state, card.suitIndex, card.rank) === 0 &&
		find_sarcastic(hand, card.suitIndex, card.rank).length === 1);

	if (playable_sarcastic !== undefined && state.clue_tokens !== 8) {
		return { tableID, type: ACTION.DISCARD, target: playable_sarcastic.order };
	}

	if (state.clue_tokens === 0) {
		return { tableID, type: ACTION.DISCARD, target: hand.locked_discard().order };
	}

	/** @type {Clue} */
	let best_clue;
	let best_clue_value = 0;

	/** @type {Clue} */
	let lock_clue;

	// Try all rank clues
	for (let rank = 1; rank <= 5; rank++) {
		const clue = { type: CLUE.RANK, value: rank, target: partner };
		const value = clue_value(state, clue);

		logger.info('clue', logClue(clue), 'value', value);

		if (value > best_clue_value) {
			best_clue = clue;
			best_clue_value = value;
		}
	}

	// 1 playable + 1 new_touched + 1 elim is enough
	if (best_clue_value >= 2) {
		return Utils.clueToAction(best_clue, tableID);
	}

	// Try all colour clues
	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		const clue = { type: CLUE.COLOUR, value: suitIndex, target: partner };
		const value = clue_value(state, clue);

		logger.info('clue', logClue(clue), 'value', value);

		if (value === -2) {
			lock_clue = clue;
		}
		else if (value === 10) {
			return Utils.clueToAction(clue, tableID);
		}

		if (value > best_clue_value) {
			best_clue = clue;
			best_clue_value = value;
		}
	}

	logger.info('best clue', logClue(best_clue), 'value', best_clue_value);

	// Best clue is too low value, lock
	if (best_clue_value <= 0.25) {
		return Utils.clueToAction(lock_clue, tableID);
	}

	return Utils.clueToAction(best_clue, tableID);
}

/**
 * Returns the playable cards categorized by priority.
 * @param {State} state
 * @param {Card[]} playable_cards
 */
function determine_playable_card(state, playable_cards) {
	/** @type {Card[][]} */
	const priorities = [[], [], [], [], [], []];

	let min_rank = 5;
	for (const card of playable_cards) {
		const possibilities = card.inferred.length > 0 ? card.inferred : card.possible;

		// Part of a finesse
		if (card.finessed) {
			priorities[5].push(card);
			continue;
		}

		let priority = 0;
		for (const inference of possibilities) {
			const { suitIndex, rank } = inference;

			let connected = false;

			// Start at next player so that connecting in our hand has lowest priority
			for (let i = 1; i < state.numPlayers + 1; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;
				if (state.hands[target].findCards(suitIndex, rank + 1).length > 0) {
					connected = true;

					// Connecting in own hand, demote priority to 2
					if (target === state.ourPlayerIndex) {
						priority = 1;
					}
					break;
				}
			}

			if (!connected) {
				priority = 2;
				break;
			}
		}

		if (priority < 2) {
			priorities[priority].push(card);
			continue;
		}

		// Find the lowest possible rank for the card
		const rank = possibilities.reduce((lowest_rank, card) => card.rank < lowest_rank ? card.rank : lowest_rank, 5);

		// Playing a 5
		if (rank === 5) {
			priorities[2].push(card);
			continue;
		}

		// Unknown card
		if (possibilities.length > 1) {
			priorities[3].push(card);
			continue;
		}

		// Other
		if (rank <= min_rank) {
			priorities[4].unshift(card);
			min_rank = rank;
		}
	}

	// Oldest finesse to newest
	priorities[5].sort((c1, c2) => {
		return c1.finesse_index - c2.finesse_index;
	});

	return priorities;
}
