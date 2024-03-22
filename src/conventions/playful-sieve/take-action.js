import { ACTION, CLUE } from '../../constants.js';
import { clue_value } from './action-helper.js';
import { isTrash  } from '../../basics/hanabi-util.js';
import { unlock_promise } from './interpret-play.js';
import { find_fix_clue } from './fix-clues.js';
import { find_sarcastic } from '../shared/sarcastic.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../playful-sieve.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {Game} game
 * @returns {PerformAction}
 */
export function take_action(game) {
	const { common, me, state, tableID } = game;
	const hand = state.hands[state.ourPlayerIndex];
	const partner = (state.ourPlayerIndex + 1) % state.numPlayers;
	const partner_hand = state.hands[partner];

	// Look for playables, trash and important discards in own hand
	let playable_cards = me.thinksPlayables(state, state.ourPlayerIndex).map(c => me.thoughts[c.order]);
	let trash_cards = me.thinksTrash(state, state.ourPlayerIndex).filter(c => c.clued);

	// Add cards called to discard
	for (const { order } of hand) {
		const card = me.thoughts[order];
		if (!trash_cards.some(c => c.order === order) && card.called_to_discard && card.possible.some(p => !state.isCritical(p)))
			trash_cards.push(card);
	}

	// Discards must be inferred, playable, trash and not duplicated in our hand
	const discards = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		return id !== undefined &&
			trash_cards.some(c => c.order === card.order) &&
			!playable_cards.some(c => me.thoughts[c.order].matches(id, { infer: true }) && c.order !== card.order);
	});

	// Pick the leftmost of all playable trash cards
	const playable_trash = playable_cards.filter(card => {
		const id = card.identity({ infer: true });
		return id !== undefined && playable_cards.some(c => c.matches(id, { infer: true }) && c.order < card.order);
	});

	// Remove trash from playables (but not playable trash) and discards and playable trash from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order) || playable_trash.some(pt => pt.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order) && !playable_trash.some(pt => pt.order === tc.order));

	if (playable_cards.length > 0)
		logger.info('playable cards', logHand(playable_cards));

	if (trash_cards.length > 0)
		logger.info('trash cards', logHand(trash_cards));

	if (discards.length > 0)
		logger.info('discards', logHand(discards));

	const playable_priorities = determine_playable_card(state, playable_cards);
	const priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);

	const chop = partner_hand[0];
	const chop_away = state.playableAway(chop);

	const fix_clue = find_fix_clue(game);

	const locked_discard_action = { tableID, type: ACTION.DISCARD, target: me.lockedDiscard(state, state.hands[state.ourPlayerIndex]).order };

	// Stalling situation
	if (me.thinksLocked(state, state.ourPlayerIndex)) {
		// Forced discard
		if (state.clue_tokens === 0)
			return locked_discard_action;

		// Bad situation (for now, just treat as forced discard)
		if (me.thinksLocked(state, partner))
			return locked_discard_action;

		// Chop is delayed playable
		if (!isTrash(state, me, chop, chop.order) && me.hypo_stacks[chop.suitIndex] + 1 === chop.rank)
			return Utils.clueToAction({ type: CLUE.COLOUR, value: chop.suitIndex, target: partner }, tableID);

		if (fix_clue !== undefined)
			return Utils.clueToAction(fix_clue, tableID);

		// Can't give colour clues touching chop
		const valid_clues = state.allValidClues(partner).filter(clue =>
			!(clue.type === CLUE.COLOUR && partner_hand.clueTouched(clue, state.variant).some(card => card.order === chop.order)));

		const best_clue = Utils.maxOn(valid_clues, (clue) => clue_value(game, clue), 0);

		if (best_clue !== undefined)
			return Utils.clueToAction(best_clue, tableID);
		else
			return locked_discard_action;
	}

	if (fix_clue !== undefined && state.clue_tokens > 0)
		return Utils.clueToAction(fix_clue, tableID);

	logger.info('fix clue?', fix_clue ? logClue(fix_clue) : undefined);

	const sarcastic_chop = playable_cards.find(c => c.identity({ infer: true })?.matches(chop));

	if (common.thinksLoaded(state, partner) ||
		partner_hand.some(c => common.thoughts[c.order].called_to_discard) ||
		(chop_away === 0 && this.turn_count !== 1 && !sarcastic_chop)
	) {
		if (common.thinksLoaded(state, partner)) {
			const playables = common.thinksPlayables(state, partner);

			if (playables.length > 0)
				logger.info('partner loaded on playables:', playables.map(logCard));
			else
				logger.info('partner loaded on trash:', common.thinksTrash(state, partner).map(logCard));
		}
		else {
			logger.info('partner loaded', (partner_hand.some(c => common.thoughts[c.order].called_to_discard) ? 'on ptd' : 'on playable slot 1'));
		}

		// TODO: If in endgame, check if a clue needs to be given before playing.
		if (playable_cards.length > 0)
			return { tableID, type: ACTION.PLAY, target: playable_priorities[priority][0].order };

		if (state.clue_tokens !== 8 && !state.inEndgame()) {
			if (discards.length > 0)
				return { tableID, type: ACTION.DISCARD, target: discards[0].order };

			if (trash_cards.length > 0)
				return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

			const { type, card } = game.last_actions[partner];
			if (state.clue_tokens === 0 || (state.clue_tokens === 1 && (type === 'discard' || (type === 'play' && card.rank === 5))))
				return locked_discard_action;

			// Otherwise, try to give some clue?
		}
	}

	if (common.thinksLocked(state, partner)) {
		// Playables that don't trigger an incorrect unlock promise
		const safe_playables = [];

		for (const playable of playable_cards.concat(discards)) {
			const identity = playable.identity({ infer: true });

			if (identity !== undefined) {
				const unlocked_order = unlock_promise(game, {
					type: 'play',
					order: playable.order,
					playerIndex: state.ourPlayerIndex,
					suitIndex: identity.suitIndex,
					rank: identity.rank
				}, state.ourPlayerIndex, partner, game.locked_shifts[playable.order]);

				if (unlocked_order) {
					if (me.thoughts[unlocked_order].matches({ suitIndex: identity.suitIndex, rank: identity.rank + 1 }))
						return { tableID, type: ACTION.PLAY, target: playable.order };
				}
				else {
					safe_playables.push(playable);
				}
			}
		}

		if (discards.length > 0)
			return { tableID, type: ACTION.DISCARD, target: discards[0].order };

		if (trash_cards.length > 0)
			return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

		if (safe_playables.length > 0) {
			// Play playable that leads to closest card
			const partner_lowest_ranks = state.variant.suits.map(_ => 6);

			for (const card of state.hands[partner])
				partner_lowest_ranks[card.suitIndex] = Math.min(partner_lowest_ranks[card.suitIndex], card.rank);

			const target = Utils.maxOn(safe_playables, (card) => {
				const { suitIndex, rank } = card.identity({ infer: true });
				return rank - partner_lowest_ranks[suitIndex];
			}).order;

			return { tableID, type: ACTION.PLAY, target };
		}

		return locked_discard_action;
	}

	// Partner isn't loaded/locked and their chop isn't playable

	if (chop_away === 1) {
		const connecting_playable = playable_cards.find(card => card.identity({ infer: true })?.suitIndex === chop.suitIndex);

		if (connecting_playable !== undefined)
			return { tableID, type: ACTION.PLAY, target: connecting_playable.order };
	}

	if (sarcastic_chop)
		return { tableID, type: ACTION.DISCARD, target: sarcastic_chop.order };

	const playable_sarcastic = discards.find(card => state.isPlayable(card) && find_sarcastic(hand, me, card).length === 1);

	if (playable_sarcastic !== undefined && state.clue_tokens !== 8)
		return { tableID, type: ACTION.DISCARD, target: playable_sarcastic.order };

	const direct_connections = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		if (id === undefined)
			return false;

		return id !== undefined && partner_hand.some(c => common.thoughts[c.order].matches({ suitIndex: id.suitIndex, rank: id.rank + 1 }));
	});

	if (direct_connections.length > 0)
		return { tableID, type: ACTION.PLAY, target: direct_connections[0].order };

	if (state.clue_tokens === 0)
		return locked_discard_action;

	/** @type {Clue} */
	let best_clue;
	let best_clue_value = -9999;

	/** @type {Clue} */
	let lock_clue;

	for (const clue of state.allValidClues(partner)) {
		const value = clue_value(game, clue);

		logger.info('clue', logClue(clue), 'value', value);

		if (value == -2)
			lock_clue = clue;

		if (value > best_clue_value) {
			best_clue = clue;
			best_clue_value = value;
		}
	}

	logger.info('best clue', logClue(best_clue), 'value', best_clue_value);

	// 1 playable + 1 new_touched + 1 elim is enough
	if (best_clue_value >= 2)
		return Utils.clueToAction(best_clue, tableID);

	// Best clue is too low value, lock
	if (best_clue_value <= 0.25 && lock_clue !== undefined)
		return Utils.clueToAction(lock_clue, tableID);

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
		// Part of a finesse
		if (card.finessed) {
			priorities[5].push(card);
			continue;
		}

		let priority = 0;
		for (const inference of card.possibilities) {
			const { suitIndex, rank } = inference;

			let connected = false;

			// Start at next player so that connecting in our hand has lowest priority
			for (let i = 1; i < state.numPlayers + 1; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;
				if (state.hands[target].findCards({ suitIndex, rank: rank + 1 }).length > 0) {
					connected = true;

					// Connecting in own hand, demote priority to 2
					if (target === state.ourPlayerIndex)
						priority = 1;

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
		const rank = card.possibilities.reduce((lowest_rank, card) => card.rank < lowest_rank ? card.rank : lowest_rank, 5);

		// Playing a 5
		if (rank === 5) {
			priorities[2].push(card);
			continue;
		}

		// Unknown card
		if (card.possibilities.length > 1) {
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
