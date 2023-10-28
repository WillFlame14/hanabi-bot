import { ACTION, CLUE } from '../../constants.js';
import { Hand } from '../../basics/Hand.js';
import { clue_value } from './action-helper.js';
import { getPace, isCritical, isTrash, playableAway } from '../../basics/hanabi-util.js';
import { find_sarcastic } from './interpret-discard.js';
import { unlock_promise } from './interpret-play.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';
import { find_fix_clue } from './fix-clues.js';


/**
 * @typedef {import('../playful-sieve.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

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
	let playable_cards = Hand.find_playables(state, state.ourPlayerIndex);
	let trash_cards = Hand.find_known_trash(state, state.ourPlayerIndex).filter(c => c.clued);

	// Add cards called to discard
	for (const card of hand) {
		if (!trash_cards.some(c => c.order === card.order) && card.called_to_discard && card.possible.some(p => !isCritical(state, p))) {
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
		if (!playable_cards.some(c => c.matches(id, { infer: true }) && c.order !== card.order)) {
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
	const chop_away = playableAway(state, chop);

	const fix_clue = find_fix_clue(state);

	const locked_discard_action = { tableID, type: ACTION.DISCARD, target: Hand.locked_discard(state, state.ourPlayerIndex).order };

	// Stalling situation
	if (Hand.isLocked(state, state.ourPlayerIndex)) {
		// Forced discard
		if (state.clue_tokens === 0) {
			return locked_discard_action;
		}

		// Bad situation (for now, just treat as forced discard)
		if (Hand.isLocked(state, partner)) {
			return locked_discard_action;
		}

		const chop_trash = isTrash(state, state.ourPlayerIndex, chop, chop.order);

		// Chop is delayed playable
		if (!chop_trash && state.hypo_stacks[state.ourPlayerIndex][chop.suitIndex] + 1 === chop.rank) {
			const clue = { type: CLUE.COLOUR, value: chop.suitIndex, target: partner };
			return Utils.clueToAction(clue, tableID);
		}

		if (fix_clue !== undefined) {
			return Utils.clueToAction(fix_clue, tableID);
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
			const touch = partner_hand.clueTouched(clue, state.suits);

			// Can't give empty clues or colour clues touching chop
			if (touch.length === 0 || (clue.type === CLUE.COLOUR && touch.some(card => card.order === chop.order))) {
				continue;
			}

			const value = clue_value(state, clue);

			if (value > best_clue_value) {
				best_clue = clue;
				best_clue_value = value;
			}
		}

		if (best_clue !== undefined) {
			return Utils.clueToAction(best_clue, tableID);
		}
		else {
			return locked_discard_action;
		}
	}

	if (fix_clue !== undefined && state.clue_tokens > 0) {
		return Utils.clueToAction(fix_clue, tableID);
	}

	logger.info('fix clue?', fix_clue ? logClue(fix_clue) : undefined);

	if (Hand.isLoaded(state, partner) || partner_hand.some(c => c.called_to_discard) || (chop_away === 0 && this.turn_count !== 1)) {
		if (Hand.isLoaded(state, partner)) {
			const playables = Hand.find_playables(state, partner);

			if (playables.length > 0) {
				logger.info('partner loaded on playables:', playables.map(c => logCard(c)));
			}
			else {
				const trash = Hand.find_known_trash(state, partner);
				logger.info('partner loaded on trash:', trash.map(c => logCard(c)));
			}
		}
		else {
			logger.info('partner loaded', (partner_hand.some(c => c.called_to_discard) ? 'on ptd' : 'on playable slot 1'));
		}

		if (playable_cards.length > 0) {
			const sarcastic_chop = playable_cards.find(c => c.identity({ infer: true })?.matches(chop));

			if (sarcastic_chop) {
				return { tableID, type: ACTION.DISCARD, target: sarcastic_chop.order };
			}
			return { tableID, type: ACTION.PLAY, target: playable_priorities[priority][0].order };
		}

		if (state.clue_tokens !== 8 && getPace(state) !== 0) {
			if (discards.length > 0) {
				return { tableID, type: ACTION.DISCARD, target: discards[0].order };
			}

			if (trash_cards.length > 0) {
				return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
			}

			const { type, card } = state.last_actions[partner];
			if (state.clue_tokens === 0 || (state.clue_tokens === 1 && (type === 'discard' || (type === 'play' && card.rank === 5)))) {
				return locked_discard_action;
			}

			// Bomb a possibly playable chop
			if (hand[0].inferred.some(c => playableAway(state, c) === 0)) {
				return { tableID, type: ACTION.PLAY, target: hand[0].order };
			}

			// Otherwise, try to give some clue?
		}
	}

	if (chop_away === 1) {
		const connecting = hand.findCards({ suitIndex: chop.suitIndex, rank: chop.rank - 1 }, { infer: true });

		if (connecting.length > 0) {
			return  { tableID, type: ACTION.PLAY, target: connecting[0].order };
		}
	}

	if (Hand.isLocked(state, partner)) {
		for (const playable of playable_cards) {
			const identity = playable.identity({ infer: true });

			if (identity !== undefined) {
				const unlocked = unlock_promise(state, {
					type: 'play',
					order: playable.order,
					playerIndex: state.ourPlayerIndex,
					suitIndex: identity.suitIndex,
					rank: identity.rank
				}, state.ourPlayerIndex, partner, state.locked_shifts[playable.order]);

				if (unlocked?.matches({ suitIndex: identity.suitIndex, rank: identity.rank + 1 })) {
					return { tableID, type: ACTION.PLAY, target: playable.order };
				}
			}
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

		return locked_discard_action;
	}

	// Partner isn't loaded/locked and their chop isn't playable

	if (chop_away === 1) {
		const connecting_playable = playable_cards.find(card =>
			card.suitIndex === chop.suitIndex && card.rank === state.play_stacks[chop.suitIndex] + 1);

		if (connecting_playable !== undefined) {
			return { tableID, type: ACTION.PLAY, target: connecting_playable.order };
		}
	}

	const playable_sarcastic = discards.find(card => playableAway(state, card) === 0 && find_sarcastic(hand, card).length === 1);

	if (playable_sarcastic !== undefined && state.clue_tokens !== 8) {
		return { tableID, type: ACTION.DISCARD, target: playable_sarcastic.order };
	}

	if (state.clue_tokens === 0) {
		return locked_discard_action;
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
	if (best_clue_value <= 0.25 && lock_clue !== undefined) {
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
				if (state.hands[target].findCards({ suitIndex, rank: rank + 1 }).length > 0) {
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
