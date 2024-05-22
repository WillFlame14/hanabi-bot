import { ACTION } from '../../constants.js';
import { ACTION_PRIORITY as PRIORITY, LEVEL } from './h-constants.js';
import { clue_safe } from './clue-finder/clue-safe.js';
import { get_result } from './clue-finder/determine-clue.js';
import { determine_focus, valuable_tempo_clue } from './hanabi-logic.js';
import { cardValue } from '../../basics/hanabi-util.js';
import { find_clue_value, order_1s } from './action-helper.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').SaveClue} SaveClue
 * @typedef {import('../../types.js').FixClue} FixClue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Determines whether we can play a connecting card into the target's hand.
 * @param {Game} game
 * @param {number} target
 * @returns {PerformAction | undefined}	The action to perform if we can do so, otherwise undefined.
 */
function find_unlock(game, target) {
	const { me, state, tableID } = game;

	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (state.playableAway(card) !== 1)
			continue;

		// See if we have the connecting card (should be certain)
		const our_connecting = state.hands[state.ourPlayerIndex].find(c => me.thoughts[c.order].matches({ suitIndex, rank: rank - 1 }, { infer: true }));
		if (our_connecting === undefined)
			continue;

		// The card must become playable
		const known = game.players[target].thoughts[card.order].inferred.every(c => state.isPlayable(c) || c.matches(card));
		if (known)
			return { tableID, type: ACTION.PLAY, target: our_connecting.order };
	}
	return;
}

/**
 * Looks for a play clue that can be given to avoid giving a save clue to the target.
 * @param {Game} game
 * @param {number} target 				The index of the player that needs a save clue.
 * @param {Clue[]} all_play_clues 		An array of all valid play clues that can be currently given.
 * @param {boolean} locked 				Whether the target is locked
 * @param {number} remainder_boost		The value of the new chop after the save clue.
 * @returns {PerformAction | undefined}	The play clue to give if it exists, otherwise undefined.
 */
function find_play_over_save(game, target, all_play_clues, locked, remainder_boost) {
	const { common, state, tableID } = game;

	/** @type {Clue[]} */
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
			state.isPlayable(state.deck[card.order]) && card.inferred.every(i => state.isPlayable(i)));

		// The card can be played without any additional help
		if (immediately_playable.length > 0) {
			play_clues.push(clue);
			continue;
		}

		// Try to see if any target card can be made playable by players between us and them, including themselves
		for (const { order } of target_cards) {
			const { suitIndex, rank } = state.deck[order];
			let stackRank = state.play_stacks[suitIndex];

			for (let i = 1; i <= state.numPlayers; i++) {
				const nextPlayer = (state.ourPlayerIndex + i) % state.numPlayers;

				if (nextPlayer === target) {
					if (stackRank + 1 === rank)
						play_clues.push(clue);

					break;
				}

				const common_playables = common.thinksPlayables(state, nextPlayer);
				const connecting_playable =
					playables.some(p => p.playerIndex === nextPlayer && p.card.matches({ suitIndex, rank: stackRank + 1 })) ||
					common_playables.some(p => p.matches({ suitIndex, rank: stackRank + 1 }));

				if (connecting_playable) {
					logger.info('found connecting playable', stackRank + 1);
					stackRank++;
				}
			}
		}

		// Unsure what this does?
		// const touches_chop = state.hands[target].clueTouched(clue, state.variant).some(c => c.order === common.chop(state.hands[target])?.order);
		// if (!locked && touches_chop && clue_safe(game, me, clue))
		// 	play_clues.push({ clue, playables: [] });
	}

	const safe_play_clues = play_clues.filter(clue => clue.result.trash > 0 || state.clue_tokens >= (state.numPlayers > 2 ? 1 : 2));

	if (safe_play_clues.length === 0)
		return;

	// If there are clues that make the save target playable, we should prioritize those
	// TODO: Consider adding this back?
	// const save_target = state.hands[target].chop();
	// const playable_saves = play_clues.filter(({ playables }) => playables.some(c => c.matches(save_target.suitIndex, save_target.rank)));

	const clue = Utils.maxOn(safe_play_clues, (clue) => find_clue_value(clue.result));

	// Convert CLUE to ACTION
	return Utils.clueToAction(clue, tableID);
}

/**
 * Returns a 2D array of urgent actions in order of descending priority.
 * @param {Game} game
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 * @param {FixClue[][]} fix_clues
 * @param {Clue[][]} stall_clues
 * @param {Card[][]} playable_priorities
 */
export function find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities) {
	const { common, me, state, tableID } = game;
	const prioritySize = Object.keys(PRIORITY).length;
	const urgent_actions = /** @type {PerformAction[][]} */ (Array.from({ length: prioritySize * 2 + 1 }, _ => []));

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;

		// If there is at least one non-finessed player with 1 clue (or 2 non-finessed players with 0 clues) between us and target, lower priority
		let playerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
		let high_priority = true;

		while (playerIndex !== target) {
			if (!state.hands[playerIndex].some(c => common.thoughts[c.order].finessed && state.isPlayable(c))) {
				high_priority = false;
				break;
			}
			playerIndex = (playerIndex + 1) % state.numPlayers;
		}

		const nextPriority = high_priority ? 0 : prioritySize;

		// They are locked, we should try to unlock
		if (common.thinksLocked(state, target)) {
			const unlock_action = find_unlock(game, target);
			if (unlock_action !== undefined) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push(unlock_action);
				continue;
			}

			const play_over_save = find_play_over_save(game, target, play_clues.flat(), true, 0);
			if (play_over_save !== undefined) {
				urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(play_over_save);
				continue;
			}

			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, tableID));
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
				urgent_actions[prioritySize * 2].push(Utils.clueToAction(save, tableID));
				continue;
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(game, target);
			if (unlock_action !== undefined) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push(unlock_action);
				continue;
			}

			const list = state.hands[target].clueTouched(save, state.variant).map(c => c.order);

			// Give them a fix clue with known trash if possible (TODO: Re-examine if this should only be urgent fixes)
			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, tableID));
				continue;
			}

			// Check if Order Chop Move is available - 4 (unknown card) must be highest priority, they must be 1s, and this cannot be a playable save
			if (game.level >= LEVEL.BASIC_CM &&
				playable_priorities.every((cards, priority) => priority >= 4 || cards.length === 0) &&
				!save.playable
			) {
				const ordered_1s = order_1s(state, common, playable_priorities[4]);
				const distance = (target + state.numPlayers - state.ourPlayerIndex) % state.numPlayers;

				// If we want to OCM the next player (distance 1), we need at least two unknown 1s.
				if (ordered_1s.length > distance) {
					// Temporarily chop move the chop card
					const chop = me.chop(hand);
					const old_chop_value = cardValue(state, me, chop);
					me.thoughts[chop.order].chop_moved = true;
					const new_chop_value = me.chopValue(state, target);

					// Undo the chop move
					me.thoughts[chop.order].chop_moved = false;

					// Make sure the old chop is equal or better than the new one
					if (old_chop_value >= new_chop_value) {
						urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push({
							tableID,
							type: ACTION.PLAY,
							target: ordered_1s[distance].order
						});
						continue;
					}
				}
			}

			// Check if Scream/Shout Discard is available (only to next player)
			if (game.level >= LEVEL.LAST_RESORTS && playable_priorities.some(p => p.length > 0) && target === state.nextPlayerIndex(state.ourPlayerIndex)) {
				const trash = me.thinksTrash(state, state.ourPlayerIndex).filter(c => c.clued);

				if (trash.length > 0) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push({ tableID, type: ACTION.DISCARD, target: trash[0].order });
					continue;
				}

				const chop = common.chop(state.hands[state.ourPlayerIndex]);

				if (state.clue_tokens === 0 && chop !== undefined) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push({ tableID, type: ACTION.DISCARD, target: chop.order });
					continue;
				}
			}

			// Check if TCCM is available
			if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && (!save.playable || state.clue_tokens === 1)) {
				let tccm = false;
				for (const clue of stall_clues[1].filter(clue => clue.target === target)) {
					const { playables } = clue.result;

					const list = hand.clueTouched(clue, state.variant).map(c => c.order);
					const { focused_card } = determine_focus(hand, common, list, { beforeClue: true });
					const { tempo, valuable } = valuable_tempo_clue(game, clue, playables, focused_card);

					if (tempo && !valuable && clue_safe(game, me, clue)) {
						urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(Utils.clueToAction(clue, tableID));
						tccm = true;
						break;
					}
				}

				if (tccm)
					continue;
			}

			const hypo_game = game.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, list, clue: save, target });
			const { common: hypo_common, me: hypo_me, state: hypo_state } = hypo_game;

			const all_play_clues = play_clues.flat();

			// Save clue reveals a play
			if (hypo_common.thinksPlayables(hypo_state, target).length > 0)
				all_play_clues.push(Object.assign({}, save, { result: get_result(game, hypo_game, save, state.ourPlayerIndex )}));

			// Try to give a play clue involving them
			// If we're going to give a save clue, we shouldn't penalize the play clue's remainder if the save clue's remainder is also bad
			const play_over_save = find_play_over_save(game, target, all_play_clues, false, hypo_me.chopValue(hypo_state, target, { afterClue: true }));
			if (play_over_save !== undefined) {
				urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(play_over_save);
				continue;
			}

			const bad_save = hypo_me.thinksLocked(hypo_state, target) ?
				me.chopValue(state, target) < cardValue(state, hypo_me, hypo_common.lockedDiscard(hypo_state, hypo_state.hands[target])) :
				me.chopValue(state, target) < hypo_me.chopValue(hypo_state, target);

			// Do not save at 1 clue if new chop or sacrifice discard are better than old chop
			if (state.clue_tokens === 1 && save.cm.length === 0 && bad_save)
				continue;

			// Do not save if unsafe
			if (!save.safe)
				continue;

			// No alternative, have to give save
			urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push(Utils.clueToAction(save_clues[target], tableID));
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			const urgent_fixes = fix_clues[target].filter(clue => clue.urgent);

			// Urgent fix on the next player is particularly urgent, but we should prioritize urgent fixes for others too
			if (urgent_fixes.length > 0) {
				const urgent_fix = Utils.maxOn(urgent_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.URGENT_FIX + nextPriority].push(Utils.clueToAction(urgent_fix, tableID));
				continue;
			}

			const best_fix = Utils.maxOn(fix_clues[target], ({ result }) => find_clue_value(result));

			// No urgent fixes required
			urgent_actions[PRIORITY.URGENT_FIX + prioritySize].push(Utils.clueToAction(best_fix, tableID));
		}
	}
	return urgent_actions;
}
