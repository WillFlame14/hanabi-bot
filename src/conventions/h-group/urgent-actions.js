import { ACTION } from '../../constants.js';
import { ACTION_PRIORITY as PRIORITY, LEVEL } from './h-constants.js';
import { clue_safe } from './clue-finder/clue-safe.js';
import { get_result } from './clue-finder/determine-clue.js';
import { determine_focus, valuable_tempo_clue } from './hanabi-logic.js';
import { cardValue, playableAway } from '../../basics/hanabi-util.js';
import { find_clue_value, order_1s } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logHand } from '../../tools/log.js';

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

		if (playableAway(state, card) !== 1)
			continue;

		// See if we have the connecting card (should be certain)
		const our_connecting = state.hands[state.ourPlayerIndex].find(c => state.me.thoughts[c.order].matches({ suitIndex, rank: rank - 1 }, { infer: true }));
		if (our_connecting === undefined)
			continue;

		// The card must become playable
		const known = state.players[target].thoughts[card.order].inferred.every(c => playableAway(state, c) === 0 || c.matches(card));
		if (known)
			return { tableID: state.tableID, type: ACTION.PLAY, target: our_connecting.order };
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

		// Locked reduces needed clue value (TODO: try readding only 1 clue token increases needed clue value?)
		if (clue_value < (locked ? 0 : 1)) {
			logger.debug('clue value', clue_value, 'skipping');
			continue;
		}

		const { playables } = clue.result;
		const target_cards = playables.filter(({ playerIndex }) => playerIndex === target).map(p => p.card);
		const immediately_playable = target_cards.filter(card =>
			playableAway(state, state.me.thoughts[card.order]) === 0 && card.inferred.every(c => playableAway(state, c) === 0));

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
				const current_playables = playables.filter(({ playerIndex, card }) => playerIndex === nextPlayer && card.matches({ suitIndex, rank: stackRank + 1 }));

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
				if (nextPlayer === target)
					break;
			}
		}

		const touches_chop = state.hands[target].clueTouched(clue, state.variant).some(c => c.order === state.common.chop(state.hands[target])?.order);
		if (!locked && touches_chop && clue_safe(state, state.me, clue))
			play_clues.push({ clue, playables: [] });
	}

	if (play_clues.length === 0)
		return;

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
 * @param {Clue[][]} stall_clues
 * @param {Card[][]} playable_priorities
 */
export function find_urgent_actions(state, play_clues, save_clues, fix_clues, stall_clues, playable_priorities) {
	const { common } = state;
	const prioritySize = Object.keys(PRIORITY).length;
	const urgent_actions = /** @type {PerformAction[][]} */ (Array.from({ length: prioritySize * 2 + 1 }, _ => []));

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;

		// If there is at least one non-finessed player with 1 clue (or 2 non-finessed players with 0 clues) between us and target, lower priority
		let playerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
		let high_priority = true;

		while (playerIndex !== target) {
			if (!state.hands[playerIndex].some(c => common.thoughts[c.order].finessed && playableAway(state, c) === 0)) {
				high_priority = false;
				break;
			}
			playerIndex = (playerIndex + 1) % state.numPlayers;
		}

		const nextPriority = high_priority ? 0 : prioritySize;

		// They are locked, we should try to unlock
		if (common.thinksLocked(state, target)) {
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push(unlock_action);
				continue;
			}

			const play_over_save = find_play_over_save(state, target, play_clues.flat(), true, 0);
			if (play_over_save !== undefined) {
				urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(play_over_save);
				continue;
			}

			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, state.tableID));
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
			if (common.thinksLoaded(state, target)) {
				urgent_actions[prioritySize * 2].push(Utils.clueToAction(save, state.tableID));
				continue;
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push(unlock_action);
				continue;
			}

			const list = state.hands[target].clueTouched(save, state.variant).map(c => c.order);
			const hypo_state = state.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, list, clue: save, target });

			// Give them a fix clue with known trash if possible (TODO: Re-examine if this should only be urgent fixes)
			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, state.tableID));
				continue;
			}

			// Check if Order Chop Move is available - 4 (unknown card) must be highest priority, they must be 1s, and this cannot be a playable save
			if (state.level >= LEVEL.BASIC_CM &&
				playable_priorities.every((cards, priority) => priority >= 4 || cards.length === 0) &&
				!save.playable
			) {
				const ordered_1s = order_1s(state, state.common, playable_priorities[4]);
				const distance = (target + state.numPlayers - state.ourPlayerIndex) % state.numPlayers;

				// If we want to OCM the next player (distance 1), we need at least two unknown 1s.
				if (ordered_1s.length > distance) {
					// Temporarily chop move the chop card
					const chop = state.me.chop(hand);
					const old_chop_value = cardValue(state, state.me, chop);
					state.me.thoughts[chop.order].chop_moved = true;
					const new_chop_value = state.me.chopValue(state, target);

					// Undo the chop move
					state.me.thoughts[chop.order].chop_moved = false;

					// Make sure the old chop is equal or better than the new one
					if (old_chop_value >= new_chop_value) {
						urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push({ tableID: state.tableID, type: ACTION.PLAY, target: ordered_1s[distance].order });
						continue;
					}
				}
			}

			// Check if TCCM is available
			if (state.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2) {
				let tccm = false;
				for (const clue of stall_clues[1].filter(clue => clue.target === target)) {
					const { playables } = clue.result;
					const { focused_card } = determine_focus(hand, state.common, hand.clueTouched(clue, state.variant).map(c => c.order), { beforeClue: true });
					const { tempo, valuable } = valuable_tempo_clue(state, state.common, clue, playables, focused_card);

					if (tempo && !valuable && clue_safe(state, state.me, clue)) {
						urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push(Utils.clueToAction(clue, state.tableID));
						tccm = true;
						break;
					}
				}

				if (tccm)
					continue;
			}

			const hand_after_save = hypo_state.hands[target];

			// Try to give a play clue involving them (if 2 players, too risky to try play over save at 1 clue)
			if (state.clue_tokens >= (state.numPlayers > 2 ? 1 : 2)) {
				const all_play_clues = play_clues.flat();

				// Save clue reveals a play
				if (hypo_state.common.thinksPlayables(hypo_state, target).length > 0)
					all_play_clues.push(Object.assign({}, save, { result: get_result(state, hypo_state, save, state.ourPlayerIndex )}));

				logger.debug('hand after save', logHand(hand_after_save));

				// If we're going to give a save clue, we shouldn't penalize the play clue's remainder if the save clue's remainder is also bad
				const play_over_save = find_play_over_save(state, target, all_play_clues, false, hypo_state.me.chopValue(hypo_state, target, { afterClue: true }));
				if (play_over_save !== undefined) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(play_over_save);
					continue;
				}
			}

			const bad_save = hypo_state.me.thinksLocked(hypo_state, target) ?
				state.me.chopValue(state, target) < cardValue(state, hypo_state.me, hypo_state.common.lockedDiscard(hypo_state, hypo_state.hands[target])) :
				state.me.chopValue(state, target) < hypo_state.me.chopValue(hypo_state, target);

			// Do not save at 1 clue if new chop or sacrifice discard are better than old chop
			if (state.clue_tokens === 1 && save.cm.length === 0 && bad_save)
				continue;

			// Do not save if unsafe
			if (!save.safe)
				continue;

			// No alternative, have to give save
			urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push(Utils.clueToAction(save_clues[target], state.tableID));
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			const urgent_fixes = fix_clues[target].filter(clue => clue.urgent);

			// Urgent fix on the next player is particularly urgent, but we should prioritize urgent fixes for others too
			if (urgent_fixes.length > 0) {
				const urgent_fix = Utils.maxOn(urgent_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.URGENT_FIX + nextPriority].push(Utils.clueToAction(urgent_fix, state.tableID));
				continue;
			}

			const best_fix = Utils.maxOn(fix_clues[target], ({ result }) => find_clue_value(result));

			// No urgent fixes required
			urgent_actions[PRIORITY.URGENT_FIX + prioritySize].push(Utils.clueToAction(best_fix, state.tableID));
		}
	}
	return urgent_actions;
}
