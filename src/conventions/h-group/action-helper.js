import { CLUE, ACTION } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { find_chop } from './hanabi-logic.js';
import { card_value } from './clue-finder/clue-safe.js';
import { playableAway, inStartingHand } from '../../basics/hanabi-util.js';
import { cardTouched } from '../../variants.js';

import logger from '../../tools/logger.js';
import { logClue } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').ClueResult} ClueResult
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').SaveClue} SaveClue
 * @typedef {import('../../types.js').FixClue} FixClue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 * @typedef {import('../../types.js').Action} Action
 */

/**
 * Returns the "value" of the clue result. A higher number means that it is more valuable.
 * 
 * A clue must have value >= 1 to meet Minimum Clue Value Principle (MCVP).
 * @param {ClueResult} clue_result
 */
export function find_clue_value(clue_result) {
	const { finesses, new_touched, playables, bad_touch, elim, remainder } = clue_result;

	// Touching 1 card is much better than touching none, but touching more cards is only marginally better
	const new_touched_value = (new_touched >= 1) ? 0.51 + 0.1 * (new_touched - 1) : 0;
	return 0.5*(finesses + playables.length) + new_touched_value + 0.01*elim - 1*bad_touch - 0.2*remainder;
}

/**
 * Returns the play clue with the highest value.
 * @param {Clue[]} play_clues
 */
export function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const clue_value = find_clue_value(clue.result);
		logger.info('clue', logClue(clue), 'value', clue_value);

		if (clue_value > best_clue_value) {
			best_clue_value = clue_value;
			best_clue = clue;
		}
	}

	return { clue: best_clue, clue_value: best_clue_value };
}

/**
 * Determines whether we can play a connecting card into the target's hand.
 * @param {State} state
 * @param {number} target
 * @returns {PerformAction | undefined}	The action to perform if we can do so, otherwise undefined.
 */
function find_unlock(state, target) {
	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (playableAway(state, suitIndex, rank) === 1) {
			// See if we have the connecting card (should be certain)
			const our_connecting = state.hands[state.ourPlayerIndex].find(c => c.matches(suitIndex, rank - 1, { infer: true }));

			if (our_connecting !== undefined) {
				// The card must become playable
				const known = card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0 || c.matches(suitIndex, rank));

				if (known) {
					return { tableID: state.tableID, type: ACTION.PLAY, target: our_connecting.order };
				}
			}
		}
	}
	return;
}

/**
 * Looks for a play clue that can be given to avoid giving a save clue to the target.
 * @param {State} state
 * @param {number} target 				The index of the player that needs a save clue.
 * @param {Clue[]} all_play_clues 		An array of all valid play clues that can be currently given.
 * @param {boolean} locked 				Whether the target is locked
 * @param {number} remainder_boost		The value of the new chop after the save clue.
 * @returns {PerformAction | undefined}	The play clue to give if it exists, otherwise undefined.
 */
function find_play_over_save(state, target, all_play_clues, locked, remainder_boost) {
	/** @type {{clue: Clue, playables: Card[]}[]} */
	const play_clues = [];

	for (const clue of all_play_clues) {
		const clue_value = find_clue_value(clue.result) + remainder_boost;

		// Locked reduces needed clue value, only 1 clue token increases needed clue value
		if (clue_value < (locked ? 0 : 1) + (state.clue_tokens === 1 ? 1 : 0)) {
			logger.debug('clue value', clue_value, 'skipping');
			continue;
		}

		const { playables } = clue.result;
		const target_cards = playables.filter(({ playerIndex }) => playerIndex === target).map(p => p.card);
		const immediately_playable = target_cards.filter(card =>
			playableAway(state, card.suitIndex, card.rank) === 0 && card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0));

		// The card can be played without any additional help
		if (immediately_playable.length > 0) {
			play_clues.push({ clue, playables: immediately_playable });
			continue;
		}

		// Try to see if any target card can be made playable by players between us and them, including themselves
		for (const target_card of target_cards) {
			const { suitIndex } = target_card;
			let stackRank = state.play_stacks[suitIndex];

			for (let i = 1; i <= state.numPlayers; i++) {
				const nextPlayer = (state.ourPlayerIndex + i) % state.numPlayers;
				const current_playables = playables.filter(({ playerIndex, card }) => playerIndex === nextPlayer && card.matches(suitIndex, stackRank + 1));

				if (current_playables.length > 0) {
					if (nextPlayer === target) {
						play_clues.push({ clue, playables: current_playables.map(p => p.card) });
						break;
					}
					else {
						stackRank++;
						continue;
					}
				}

				// We've reached the target's turn and weren't able to find a playable
				if (nextPlayer === target) {
					break;
				}
			}
		}
	}

	if (play_clues.length === 0) {
		return;
	}

	// If there are clues that make the save target playable, we should prioritize those
	// TODO: Consider adding this back?
	// const save_target = state.hands[target][find_chop(state.hands[target])];
	// const playable_saves = play_clues.filter(({ playables }) => playables.some(c => c.matches(save_target.suitIndex, save_target.rank)));

	const { clue } = Utils.maxOn(play_clues, ({ clue }) => find_clue_value(clue.result));

	// Convert CLUE to ACTION
	return Utils.clueToAction(clue, state.tableID);
}

/**
 * Given a set of playable cards, returns the unknown 1s in the order that they should be played.
 * @param  {State} state
 * @param  {Card[]} cards
 */
export function order_1s(state, cards) {
	const unknown_1s = cards.filter(card => card.clues.length > 0 && card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1));

	return unknown_1s.sort((c1, c2) => {
		const [c1_start, c2_start] = [c1, c2].map(c => inStartingHand(state, c));
		// c1 is chop focus
		if (c1.chop_when_first_clued) {
			return -1;
		}

		// c2 is chop focus
		if (c2.chop_when_first_clued) {
			return 1;
		}

		// c1 is fresh 1 (c2 isn't fresh, or fresh but older)
		if (!c1_start && (c2_start || c1.order > c2.order)) {
			return -1;
		}

		// c1 isn't fresh (c2 also isn't fresh and newer)
		if (c1_start && c2_start && c2.order > c1.order) {
			return -1;
		}

		return 1;
	});
}

/**
 * Returns a 2D array of urgent actions in order of descending priority.
 * @param {State} state
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 * @param {FixClue[][]} fix_clues
 * @param {Card[][]} playable_priorities
 */
export function find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities) {
	const urgent_actions = /** @type {PerformAction[][]} */ ([[], [], [], [], [], [], [], [], []]);

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;

		// They require a save clue or are locked
		// Urgency: [next, unlock] [next, save only] [next, play/trash fix over save] [next, urgent fix] [other, unlock]
		// (play) (give play if 2+ clues)
		// [other, save only] [other, play/trash fix over save] [all other fixes]
		// (give play if < 2 clues) [early saves]
		if (save_clues[target] !== undefined || state.hands[target].isLocked()) {
			// They already have a playable or trash (i.e. early save)
			if (state.hands[target].isLoaded()) {
				if (save_clues[target] !== undefined) {
					urgent_actions[8].push(Utils.clueToAction(save_clues[target], state.tableID));
				}
				continue;
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[i === 1 ? 0 : 4].push(unlock_action);
				continue;
			}

			// Try to give a play clue involving them (2 players, too risky to try play over save at 1 clue)
			if (state.clue_tokens >= (state.numPlayers > 2 ? 1 : 2)) {
				let remainder_boost = 0;

				// If we're going to give a save clue, we shouldn't penalize the play clue's remainder if the save clue's remainder is also bad
				// Prioritize cm-type saves over plays?
				if (save_clues[target] !== undefined) {
					const saved_hand = Utils.objClone(state.hands[target]);
					for (const card of saved_hand) {
						if (cardTouched(card, state.suits, save_clues[target])) {
							card.clued = true;
						}
						else if (save_clues[target].cm.some(c => c.order === card.order)) {
							card.chop_moved = true;
						}
					}
					const new_chop = saved_hand[find_chop(saved_hand)];
					remainder_boost = new_chop ? card_value(state, new_chop) * 0.2 : 3;
				}

				const play_over_save = find_play_over_save(state, target, play_clues.flat(), state.hands[target].isLocked(), remainder_boost);
				if (play_over_save !== undefined) {
					urgent_actions[i === 1 ? 2 : 6].push(play_over_save);
					continue;
				}
			}

			// Give them a fix clue with known trash if possible (TODO: Re-examine if this should only be urgent fixes)
			const trash_fix = fix_clues[target].find(clue => clue.trash);
			if (trash_fix !== undefined) {
				urgent_actions[i === 1 ? 2 : 6].push(Utils.clueToAction(trash_fix, state.tableID));
				continue;
			}

			// Check if Order Chop Move is available - 4 (unknown card) must be highest priority, they must be 1s, and this cannot be a playable save
			if (state.level >= LEVEL.BASIC_CM &&
				playable_priorities.every((priority_cards, priority) => priority >= 4 || priority_cards.length === 0) &&
				(save_clues[target] && !save_clues[target].playable)
			) {
				const ordered_1s = order_1s(state, playable_priorities[4]);
				const distance = (target + state.numPlayers - state.ourPlayerIndex) % state.numPlayers;

				// If we want to OCM the next player (distance 1), we need at least two unknown 1s.
				if (ordered_1s.length > distance) {
					const hand = state.hands[target];
					const new_hand = Utils.objClone(state.hands[target]);
					new_hand[find_chop(new_hand)].chop_moved = true;

					const [old_chop_value, new_chop_value] = [hand, new_hand].map(h => {
						const chopIndex = find_chop(h);

						// A locked hand is value 4. It is worth locking hand for a unique 2, but not anything less.
						return chopIndex === -1 ? 4 : card_value(state, h[chopIndex]);
					});


					// Make sure the old chop is better than the new one
					if (old_chop_value >= new_chop_value) {
						urgent_actions[i === 1 ? 1 : 5].push({ tableID: state.tableID, type: ACTION.PLAY, target: ordered_1s[distance].order });
						continue;
					}
				}
			}

			// No alternative, have to give save
			if (save_clues[target] !== undefined) {
				urgent_actions[i === 1 ? 1 : 5].push(Utils.clueToAction(save_clues[target], state.tableID));
			}
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			const urgent_fix = fix_clues[target].find(clue => clue.urgent);

			// Urgent fix on the next player is particularly urgent, but we should prioritize urgent fixes for others too
			if (urgent_fix !== undefined) {
				urgent_actions[i === 1 ? 3 : 7].push(Utils.clueToAction(urgent_fix, state.tableID));
				continue;
			}

			// No urgent fixes required
			urgent_actions[7].push(Utils.clueToAction(fix_clues[target][0], state.tableID));
		}
	}
	return urgent_actions;
}

/**
 * Returns the playable cards categorized by priority.
 * @param {State} state
 * @param {Card[]} playable_cards
 */
export function determine_playable_card(state, playable_cards) {
	/** @type {Card[][]} */
	const priorities = [[], [], [], [], [], []];

	let min_rank = 5;
	for (const card of playable_cards) {
		const possibilities = card.inferred.length > 0 ? card.inferred : card.possible;

		// Part of a finesse
		if (card.finessed) {
			priorities[0].push(card);
			continue;
		}

		// Blind playing chop moved cards should be a last resort with < 2 strikes
		if (card.chop_moved && !card.clued) {
			if (state.strikes !== 2) {
				priorities[5].push(card);
			}
			continue;
		}

		let priority = 1;
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
						priority = 2;
					}
					break;
				}
			}

			if (!connected) {
				priority = 3;
				break;
			}
		}

		if (priority < 3) {
			priorities[priority].push(card);
			continue;
		}

		// Find the lowest possible rank for the card
		const rank = possibilities.reduce((lowest_rank, card) => card.rank < lowest_rank ? card.rank : lowest_rank, 5);

		// Playing a 5
		if (rank === 5) {
			priorities[3].push(card);
			continue;
		}

		// Unknown card
		if (possibilities.length > 1) {
			priorities[4].push(card);
			continue;
		}

		// Other
		if (rank <= min_rank) {
			priorities[5].unshift(card);
			min_rank = rank;
		}
	}

	// Speed-up clues first, then oldest finesse to newest
	priorities[0].sort((c1, c2) => {
		if (c1.hidden && !c2.hidden) {
			return 1;
		}
		else if (!c1.hidden && c2.hidden) {
			return -1;
		}
		return c1.finesse_index - c2.finesse_index;
	});

	return priorities;
}
