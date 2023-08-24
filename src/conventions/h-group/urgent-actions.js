import { ACTION } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { cardValue, playableAway } from '../../basics/hanabi-util.js';
import { find_clue_value, order_1s } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { clue_safe } from './clue-finder/clue-safe.js';
import { get_result } from './clue-finder/determine-clue.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').SaveClue} SaveClue
 * @typedef {import('../../types.js').FixClue} FixClue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Determines whether we can play a connecting card into the target's hand.
 * @param {State} state
 * @param {number} target
 * @returns {PerformAction | undefined}	The action to perform if we can do so, otherwise undefined.
 */
function find_unlock(state, target) {
	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (playableAway(state, suitIndex, rank) !== 1) {
			continue;
		}

		// See if we have the connecting card (should be certain)
		const our_connecting = state.hands[state.ourPlayerIndex].find(c => c.matches(suitIndex, rank - 1, { infer: true }));
		if (our_connecting === undefined) {
			continue;
		}

		// The card must become playable
		const known = card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0 || c.matches(suitIndex, rank));
		if (known) {
			return { tableID: state.tableID, type: ACTION.PLAY, target: our_connecting.order };
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

		// Touches the chop card
		if (!locked && state.hands[target].clueTouched(clue).some(c => c.order === state.hands[target].chop().order) && clue_safe(state, clue)) {
			play_clues.push({ clue, playables: [] });
		}
	}

	if (play_clues.length === 0) {
		return;
	}

	// If there are clues that make the save target playable, we should prioritize those
	// TODO: Consider adding this back?
	// const save_target = state.hands[target].chop();
	// const playable_saves = play_clues.filter(({ playables }) => playables.some(c => c.matches(save_target.suitIndex, save_target.rank)));

	const { clue } = Utils.maxOn(play_clues, ({ clue }) => find_clue_value(clue.result));

	// Convert CLUE to ACTION
	return Utils.clueToAction(clue, state.tableID);
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

		// They are locked, we should try to unlock
		if (state.hands[target].isLocked()) {
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[i === 1 ? 0 : 4].push(unlock_action);
				continue;
			}

			const play_over_save = find_play_over_save(state, target, play_clues.flat(), true, 0);
			if (play_over_save !== undefined) {
				urgent_actions[i === 1 ? 2 : 6].push(play_over_save);
				continue;
			}

			const trash_fix = fix_clues[target].find(clue => clue.trash);
			if (trash_fix !== undefined) {
				urgent_actions[i === 1 ? 2 : 6].push(Utils.clueToAction(trash_fix, state.tableID));
				continue;
			}
			continue;
		}

		// They require a save clue
		// Urgency: [next, unlock] [next, save only] [next, play/trash fix over save] [next, urgent fix] [other, unlock]
		// (play) (give play if 2+ clues)
		// [other, save only] [other, play/trash fix over save] [all other fixes]
		// (give play if < 2 clues) [early saves]
		if (save_clues[target] !== undefined) {
			const hand = state.hands[target];
			const save = save_clues[target];

			// They already have a playable or trash (i.e. early save)
			if (hand.isLoaded()) {
				urgent_actions[8].push(Utils.clueToAction(save, state.tableID));
				continue;
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[i === 1 ? 0 : 4].push(unlock_action);
				continue;
			}

			const list = state.hands[target].clueTouched(save).map(c => c.order);
			const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, list, clue: save, target });
			const hand_after_save = hypo_state.hands[target];

			// Try to give a play clue involving them (if 2 players, too risky to try play over save at 1 clue)
			if (state.clue_tokens >= (state.numPlayers > 2 ? 1 : 2)) {
				const all_play_clues = play_clues.flat();

				// Save clue reveals a play
				if (hand_after_save.find_playables().length > 0) {
					all_play_clues.push(Object.assign({}, save, { result: get_result(state, hypo_state, save, state.ourPlayerIndex )}));
				}

				// If we're going to give a save clue, we shouldn't penalize the play clue's remainder if the save clue's remainder is also bad
				const play_over_save = find_play_over_save(state, target, all_play_clues, false, hand_after_save.chopValue());
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
				playable_priorities.every((cards, priority) => priority >= 4 || cards.length === 0) &&
				!save.playable
			) {
				const ordered_1s = order_1s(state, playable_priorities[4]);
				const distance = (target + state.numPlayers - state.ourPlayerIndex) % state.numPlayers;

				// If we want to OCM the next player (distance 1), we need at least two unknown 1s.
				if (ordered_1s.length > distance) {
					const hand_after_ocm = Utils.objClone(hand);
					hand_after_ocm.chop().chop_moved = true;

					const [old_chop_value, new_chop_value] = [hand, hand_after_ocm].map(h => h.chopValue());

					// Make sure the old chop is better than the new one
					if (old_chop_value >= new_chop_value) {
						urgent_actions[i === 1 ? 1 : 5].push({ tableID: state.tableID, type: ACTION.PLAY, target: ordered_1s[distance].order });
						continue;
					}
				}
			}

			const bad_save = hypo_state.hands[target].isLocked() ?
				hand.chopValue() < cardValue(state, hypo_state.hands[target].locked_discard()) :
				hand.chopValue() < hand_after_save.chopValue();

			// Do not save at 1 clue if new chop or sacrifice discard are better than old chop
			if (state.clue_tokens === 1 && save.cm.length === 0 && bad_save) {
				continue;
			}

			// Do not save if unsafe
			if (!save.safe) {
				continue;
			}

			// No alternative, have to give save
			urgent_actions[i === 1 ? 1 : 5].push(Utils.clueToAction(save_clues[target], state.tableID));
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
