import { ACTION } from '../../constants.js';
import { ACTION_PRIORITY as PRIORITY, LEVEL, CLUE_INTERP } from './h-constants.js';
import { clue_safe } from './clue-finder/clue-safe.js';
import { get_result } from './clue-finder/determine-clue.js';
import { playersBetween, valuable_tempo_clue } from './hanabi-logic.js';
import { cardValue } from '../../basics/hanabi-util.js';
import { find_clue_value, order_1s } from './action-helper.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { cardTouched } from '../../variants.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logClue } from '../../tools/log.js';
import { ActualCard } from '../../basics/Card.js';

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
 * @returns {number | undefined}	The order of the card to play, otherwise undefined.
 */
export function find_unlock(game, target) {
	const { common, me, state } = game;

	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (state.playableAway(card) !== 1)
			continue;

		// See if we have the connecting card (should be certain)
		const our_connecting = state.ourHand.find(c => me.thoughts[c.order].matches({ suitIndex, rank: rank - 1 }, { infer: true }));
		if (our_connecting === undefined)
			continue;

		// The card must become playable
		const known = game.players[target].thoughts[card.order].inferred.every(c => state.isPlayable(c) || c.matches(card)) ||
			(game.level >= LEVEL.STALLING &&
				common.thinksLocked(state, target) &&
				state.clue_tokens === 0 &&
				game.players[target].anxietyPlay(state, state.hands[target]).order === card.order);

		if (known)
			return our_connecting.order;
	}
	return;
}

/**
 * Looks for a play clue that can be given to avoid giving a save clue to the target.
 * @param {Game} game
 * @param {number} target 				The index of the player that needs a save clue.
 * @param {Clue[]} all_play_clues 		An array of all valid play clues that can be currently given.
 * @param {SaveClue} [save_clue]		The save clue that may need to be given (undefined if the target is simply locked).
 * @returns {PerformAction | undefined}	The play clue to give if it exists, otherwise undefined.
 */
function find_play_over_save(game, target, all_play_clues, save_clue) {
	const { common, state, tableID } = game;

	const play_clues = all_play_clues.filter(clue => {
		// Locked reduces needed clue value
		if (find_clue_value(clue.result) < (save_clue === undefined ? 0 : 1))
			return false;

		// Check if the play clue touches all the cards that need to be saved
		if (save_clue !== undefined) {
			if (save_clue.cm?.length > 0) {
				if (save_clue.cm.every(c => cardTouched(c, state.variant, clue)))
					return true;
			}
			else {
				if (cardTouched(common.chop(state.hands[target]), state.variant, clue))
					return true;
			}
		}

		// Unsafe play clue
		if (clue.result.trash === 0 && state.clue_tokens < (state.numPlayers > 2 ? 1 : 2))
			return false;

		const { playables } = clue.result;
		const target_cards = playables.filter(({ playerIndex }) => playerIndex === target).map(p => p.card);
		const immediately_playable = target_cards.filter(card =>
			state.isPlayable(state.deck[card.order]) && card.inferred.every(i => state.isPlayable(i)));

		// The card can be played without any additional help
		if (immediately_playable.length > 0)
			return true;

		// Try to see if any target card can be made playable by players between us and them, including themselves
		for (const { order } of target_cards) {
			const { suitIndex, rank } = state.deck[order];
			let stackRank = state.play_stacks[suitIndex];

			for (let i = 1; i <= state.numPlayers; i++) {
				const nextPlayer = (state.ourPlayerIndex + i) % state.numPlayers;

				if (nextPlayer === target) {
					if (stackRank + 1 === rank)
						return true;

					break;
				}

				const common_playables = common.thinksPlayables(state, nextPlayer);
				const connecting_playable =
					playables.some(p => p.playerIndex === nextPlayer && p.card.matches({ suitIndex, rank: stackRank + 1 })) ||
					common_playables.some(p => p.matches({ suitIndex, rank: stackRank + 1 }));

				if (connecting_playable)
					stackRank++;
			}
		}
		return false;
	});

	if (play_clues.length === 0)
		return;

	// If there are clues that make the save target playable, we should prioritize those
	// TODO: Consider adding this back?
	// const save_target = state.hands[target].chop();
	// const playable_saves = play_clues.filter(({ playables }) => playables.some(c => c.matches(save_target.suitIndex, save_target.rank)));

	const clue = Utils.maxOn(save_clue === undefined ? play_clues : play_clues.concat(save_clue), (clue) => find_clue_value(clue.result));

	// Convert CLUE to ACTION
	return Utils.clueToAction(clue, tableID);
}

/**
 * @param {Game} game
 * @param {Clue} clue
 * @param {typeof CLUE_INTERP[keyof typeof CLUE_INTERP]} interp
 */
function expected_early_game_clue(game, clue, interp) {
	const { common, state } = game;

	switch(interp) {
		case CLUE_INTERP.STALL_5:
			return game.level >= 2 && !game.stalled_5;

		case CLUE_INTERP.PLAY:
			return clue.result.playables.some(({ card }) => card.newly_clued) && clue.result.bad_touch === 0;

		case CLUE_INTERP.SAVE: {
			const save_clue = /** @type {SaveClue} */(clue);
			const chop = common.chop(state.hands[clue.target]);
			const duplicate_holders = Utils.range(0, state.numPlayers).filter(i => state.hands[i].some(c => c.matches(chop) && c.order !== chop.order));

			return (save_clue.cm === undefined || save_clue.cm.length === 0) &&
				!duplicate_holders.includes(clue.target) &&
				(save_clue.playable || duplicate_holders.length === 0);
		}

		default:
			return false;
	}
}

/**
 * @param {Game} game
 * @param {number} playerIndex
 */
export function early_game_clue(game, playerIndex) {
	const { state } = game;

	if (state.clue_tokens <= 0)
		return false;

	const { screamed_at, generated } = state;
	state.screamed_at = false;

	logger.collect();
	const options = { giver: playerIndex, hypothetical: true, no_fix: true, early_exits: expected_early_game_clue };
	const { play_clues, save_clues, stall_clues } = find_clues(game, options);
	logger.flush(false);

	state.screamed_at = screamed_at;
	state.generated = generated;

	logger.debug('found clues', play_clues.flat().map(logClue), save_clues.filter(c => c !== undefined).map(logClue), state.playerNames[playerIndex]);

	const expected_clue = play_clues.flat().find(clue => clue.result.playables.some(({ card }) => card.newly_clued) && clue.result.bad_touch === 0) ||
		save_clues.find(clue => clue !== undefined && (clue.cm === undefined || clue.cm.length === 0)) ||
		((game.level >= 2 && !game.stalled_5 && stall_clues[0][0]) || undefined);

	if (expected_clue !== undefined)
		logger.highlight('yellow', `expecting ${state.playerNames[playerIndex]} to give ${logClue(expected_clue)} in early game`);

	return expected_clue !== undefined;
}

/**
 * Returns a 2D array of urgent actions in order of descending priority.
 * @param {Game} game
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 * @param {FixClue[][]} fix_clues
 * @param {Clue[][]} stall_clues
 * @param {Card[][]} playable_priorities
 * @param {ActualCard} [finessed_card]
 */
export function find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities, finessed_card) {
	const { common, me, state, tableID } = game;
	const prioritySize = Object.keys(PRIORITY).length;
	const urgent_actions = /** @type {PerformAction[][]} */ (Array.from({ length: prioritySize * 2 + 1 }, _ => []));

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;

		const early_expected_clue = state.early_game && early_game_clue(game, target);
		const potential_cluers = playersBetween(state.numPlayers, state.ourPlayerIndex, target).filter(i =>
			i !== target && !state.hands[i].some(c => common.thoughts[c.order].finessed && state.isPlayable(c))
		).length;

		const nextPriority = (potential_cluers === 0 && !early_expected_clue) ? 0 : prioritySize;

		// They are locked (or will be locked), we should try to unlock
		if (common.thinksLocked(state, target) || state.hands[target].every(c => common.thoughts[c.order].saved || state.isCritical(c))) {
			const unlock_order = find_unlock(game, target);
			if (unlock_order !== undefined && (!finessed_card || finessed_card.order == unlock_order)) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push({ tableID, type: ACTION.PLAY, target: unlock_order });
				continue;
			}

			const play_over_save = find_play_over_save(game, target, play_clues.flat());
			if (!finessed_card && play_over_save !== undefined) {
				urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(play_over_save);
				continue;
			}

			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (!finessed_card && trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, tableID));
				continue;
			}

			if (common.thinksLocked(state, target))
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
			if (common.thinksLoaded(state, target, {assume: false})) {
				urgent_actions[prioritySize * 2].push(Utils.clueToAction(save, tableID));
				continue;
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_order = find_unlock(game, target);
			if (unlock_order !== undefined && (!finessed_card || finessed_card.order == unlock_order)) {
				urgent_actions[PRIORITY.UNLOCK + nextPriority].push({ tableID, type: ACTION.PLAY, target: unlock_order });
				continue;
			}

			const list = state.hands[target].clueTouched(save, state.variant).map(c => c.order);

			// Give them a fix clue with known trash if possible (TODO: Re-examine if this should only be urgent fixes)
			const trash_fixes = fix_clues[target].filter(clue => clue.trash);
			if (!finessed_card && trash_fixes.length > 0) {
				const trash_fix = Utils.maxOn(trash_fixes, ({ result }) => find_clue_value(result));
				urgent_actions[PRIORITY.TRASH_FIX + nextPriority].push(Utils.clueToAction(trash_fix, tableID));
				continue;
			}

			// Check if Order Chop Move is available - they must be 1s, and this cannot be a playable save
			if (!finessed_card && game.level >= LEVEL.BASIC_CM && !save.playable) {
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
			if (!finessed_card && game.level >= LEVEL.LAST_RESORTS && playable_priorities.some(p => p.length > 0) && target === state.nextPlayerIndex(state.ourPlayerIndex)) {
				const trash = me.thinksTrash(state, state.ourPlayerIndex).filter(c =>
					c.clued && me.thoughts[c.order].inferred.every(i => state.isBasicTrash(i)));

				if (trash.length > 0) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push({ tableID, type: ACTION.DISCARD, target: trash[0].order });
					continue;
				}

				const chop = common.chop(state.ourHand);

				// As a last resort, only scream discard if it is critical.
				const save_card = game.players[target].chop(state.hands[target]);
				if ((state.isCritical(save_card) || game.me.hypo_stacks[save_card.suitIndex] + 1 === save_card.rank) && state.clue_tokens === 0 && chop !== undefined) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push({ tableID, type: ACTION.DISCARD, target: chop.order });
					continue;
				}
			}

			// Check if TCCM is available
			if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && (!save.playable || state.clue_tokens === 1)) {
				const tccm = Utils.maxOn(stall_clues[1].filter(clue => clue.target === target), clue => {
					const { playables } = clue.result;
					const focused_card = state.hands[target].findOrder(clue.result.focus);
					const { tempo, valuable } = valuable_tempo_clue(game, clue, playables, focused_card);

					if (tempo && !valuable && clue_safe(game, me, clue).safe)
						return find_clue_value(clue.result);
					else
						return -1;
				}, 0);

				if (tccm) {
					urgent_actions[PRIORITY.PLAY_OVER_SAVE + nextPriority].push(Utils.clueToAction(tccm, tableID));
					continue;
				}
			}

			const hypo_game = game.simulate_clue({ type: 'clue', giver: state.ourPlayerIndex, list, clue: save, target });
			const { common: hypo_common, me: hypo_me, state: hypo_state } = hypo_game;

			const all_play_clues = play_clues.flat();

			// Save clue reveals a play
			if (hypo_common.thinksPlayables(hypo_state, target).length > 0)
				all_play_clues.push(Object.assign({}, save, { result: get_result(game, hypo_game, save, state.ourPlayerIndex )}));

			// Try to give a play clue involving them
			const play_over_save = find_play_over_save(game, target, all_play_clues, save_clues[target]);
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

			if (hypo_me.chopValue(hypo_state, target) >= 4 && potential_cluers > 0 && state.clue_tokens > 1) {
				const urgent = !early_expected_clue && potential_cluers === 1;

				if (urgent)
					logger.info('setting up double save!');

				urgent_actions[PRIORITY.ONLY_SAVE + (urgent ? 0 : prioritySize)].push(Utils.clueToAction(save_clues[target], tableID));
				continue;
			}

			// Do not save if unsafe
			if (!save.safe) {
				logger.info('save clue', logClue(save), 'is unsafe, not giving');
				continue;
			}

			// No alternative, have to give save
			urgent_actions[PRIORITY.ONLY_SAVE + nextPriority].push(Utils.clueToAction(save_clues[target], tableID));
		}

		// They require a fix clue
		if (!finessed_card && fix_clues[target].length > 0) {
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
