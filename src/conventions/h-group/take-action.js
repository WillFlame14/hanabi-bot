import { ACTION, CLUE } from '../../constants.js';
import { ACTION_PRIORITY, LEVEL } from './h-constants.js';
import { select_play_clue, determine_playable_card, order_1s, find_clue_value } from './action-helper.js';
import { find_urgent_actions } from './urgent-actions.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { determine_focus, minimum_clue_value, older_queued_finesse, stall_severity } from './hanabi-logic.js';
import { cardValue, isTrash, visibleFind } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {Game} game
 * @returns {PerformAction}
 */
export function take_action(game) {
	const { common, state, me, tableID } = game;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;

	// Look for playables, trash and important discards in own hand
	let playable_cards = me.thinksPlayables(state, state.ourPlayerIndex).map(({ order }) => me.thoughts[order]);
	let trash_cards = me.thinksTrash(state, state.ourPlayerIndex).filter(c => c.clued).map(({ order }) => me.thoughts[order]);

	// Discards must be inferred, playable, trash and not duplicated in our hand
	const discards = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		return game.level >= LEVEL.SARCASTIC &&
			id !== undefined &&
			trash_cards.some(c => c.order === card.order) &&
			!playable_cards.some(c => me.thoughts[c.order].matches(id, { infer: true }) && c.order !== card.order);
	});

	const playable_trash = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		// Pick the leftmost of all playable trash cards
		return id !== undefined && !playable_cards.some(c => c.matches(id, { infer: true }) && c.order > card.order);
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

	const playable_priorities = determine_playable_card(game, playable_cards);
	const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

	if (urgent_actions.some(actions => actions.length > 0))
		logger.info('all urgent actions', urgent_actions.map((actions, index) => actions.map(action => ({ [index]: logPerformAction(action) }))).flat());

	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
	const actionPrioritySize = Object.keys(ACTION_PRIORITY).length;

	/** @type {ActualCard} */
	let best_playable_card;
	if (priority !== -1) {
		best_playable_card = playable_priorities[priority][0];

		// Best playable card is an unknown 1, so we should order correctly
		if (best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
			const ordered_1s = order_1s(state, common, playable_cards);

			if (ordered_1s.length > 0 && game.level >= LEVEL.BASIC_CM) {
				// Try to find a non-negative value OCM (TODO: Fix double OCMs)
				const best_ocm_index = Utils.maxOn(Utils.range(1, ordered_1s.length), i => {
					const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

					if (playerIndex === state.ourPlayerIndex)
						return -0.1;

					const old_chop = common.chop(state.hands[playerIndex]);
					// Player is locked or has trash chop, don't OCM
					if (old_chop === undefined || isTrash(state, me, old_chop, old_chop.order))
						return -0.1;

					// Simulate chop move
					const old_chop_value = cardValue(state, me, old_chop);
					common.thoughts[old_chop.order].chop_moved = true;

					const new_chop = common.chop(state.hands[playerIndex]);
					const new_chop_value = new_chop ? cardValue(state, me, new_chop) : me.thinksLoaded(state, playerIndex) ? 0 : 4;

					// Undo chop move
					common.thoughts[old_chop.order].chop_moved = false;

					return old_chop_value - new_chop_value;
				}, -0.1) ?? 0;

				if (best_ocm_index !== 0)
					logger.highlight('yellow', `performing ocm by playing ${best_ocm_index + 1}'th 1`);

				best_playable_card = ordered_1s[best_ocm_index];
			}
		}

		if (game.level >= LEVEL.INTERMEDIATE_FINESSES) {
			while (priority === 0) {
				const older_finesse = older_queued_finesse(hand, common, best_playable_card.order);

				if (older_finesse === undefined)
					break;

				logger.warn('older finesse', logCard(older_finesse), older_finesse.order, 'could be layered, unable to play newer finesse', logCard(best_playable_card));

				// Remove from playable cards
				playable_priorities[priority].splice(playable_priorities[priority].findIndex(c => c.order === best_playable_card.order), 1);
				playable_cards.splice(playable_cards.findIndex(c => c.order === best_playable_card.order), 1);

				// Find new best playable card
				priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
				best_playable_card = playable_priorities[priority]?.[0];
			}
		}

		if (priority !== -1)
			logger.info(`best playable card is order ${best_playable_card.order}, inferences ${me.thoughts[best_playable_card.order].inferred.map(logCard)}`);
	}

	// Playing into finesse/bluff
	if (playable_cards.length > 0 && priority === 0)
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	// Unlock next player
	if (urgent_actions[ACTION_PRIORITY.UNLOCK].length > 0)
		return urgent_actions[ACTION_PRIORITY.UNLOCK][0];

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < actionPrioritySize; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0)
				return actions[0];
		}
	}

	// Get a high value play clue involving next player (otherwise, next player can give it)
	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		const all_play_clues = play_clues.flat();
		({ clue: best_play_clue, clue_value } = select_play_clue(all_play_clues));
	}

	/**
	 * A card must be played from a particular player if it is critical or no one else has a copy of it.
	 * @type {(identity: Identity, index: number) => boolean}
	 */
	const mustPlay = (identity, index) =>
		!state.isBasicTrash(identity) &&
		(state.isCritical(identity) || visibleFind(state, game.me, identity, { infer: true, ignore: [index] }).length === 0);

	const selfMustPlay = playable_cards.filter(c => c.inferred.every(i => mustPlay(i, state.ourPlayerIndex)));

	// Endgame stall before drawing the last card
	if (state.cardsLeft === 1 && state.clue_tokens > 0 && selfMustPlay.length < 2) {
		const mustPlays = state.hands.map((hand, i) => i === state.ourPlayerIndex ? [] : hand.filter(c => mustPlay(c, i)));
		const doubleIndex = mustPlays.findIndex(plays => plays.length > 1);

		if (doubleIndex !== -1 && state.clue_tokens >= (doubleIndex + state.numPlayers - state.ourPlayerIndex) % state.numPlayers) {
			const stall_clue = best_play_clue ??
				stall_clues.find(clues => clues.length > 0)?.[0] ??
				{ type: CLUE.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank };

			return Utils.clueToAction(stall_clue, tableID);
		}
	}

	if (best_play_clue?.result.finesses.length > 0 && best_play_clue.result.finesses.some(f => f.playerIndex === nextPlayerIndex))
		return Utils.clueToAction(best_play_clue, tableID);

	// Sarcastic discard to someone else
	if (game.level >= LEVEL.SARCASTIC && discards.length > 0 && state.clue_tokens !== 8) {
		const identity = discards[0].identity({ infer: true });
		const duplicates = visibleFind(state, me, identity, { ignore: [state.ourPlayerIndex] }).filter(c => c.clued).map(c => me.thoughts[c.order]);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (state.inEndgame() && duplicates.every(c => c.inferred.length === 0 || (c.inferred.every(inf => inf.matches(identity) || state.isBasicTrash(inf)))))
			return { tableID, type: ACTION.PLAY, target: discards[0].order };

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize].length > 0)
		return urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize][0];

	// Forced discard if next player is locked
	// TODO: Anxiety play
	if (state.clue_tokens === 0 && common.thinksLocked(state, nextPlayerIndex))
		return trash_cards.length > 0 ? { tableID, type: ACTION.DISCARD, target: trash_cards[0].order } : discard_chop(game, state.ourPlayerIndex, tableID);

	// Playing a connecting card or playing a 5
	if (best_playable_card !== undefined && priority <= 3)
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	// Discard known trash at high pace, low clues
	if (trash_cards.length > 0 && state.pace > state.numPlayers * 2 && state.clue_tokens <= 2)
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

	// Give TCCM on a valuable card that moves chop to trash
	if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && state.clue_tokens > 0) {
		for (const clue of stall_clues[1]) {
			const { target } = clue;

			const chop = common.chop(state.hands[target]);

			// Chop doesn't exist or is trash, ignore
			if (chop === undefined || cardValue(state, me, chop) === 0)
				continue;

			// Temporarily chop move their chop
			me.thoughts[chop.order].chop_moved = true;
			const new_chop_value = me.chopValue(state, target);

			// Undo chop move
			me.thoughts[chop.order].chop_moved = false;

			if (new_chop_value === 0) {
				logger.highlight('yellow', `performing tccm on ${logCard(chop)}`);
				return Utils.clueToAction(clue, tableID);
			}
		}
	}

	const play_clue_2p = best_play_clue ?? Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result));

	const not_selfish = (clue) => {
		const list = state.hands[nextPlayerIndex].clueTouched(clue, state.variant).map(c => c.order);
		const { focused_card } = determine_focus(state.hands[nextPlayerIndex], common, list, { beforeClue: true });
		const { suitIndex } = focused_card;

		return common.hypo_stacks[suitIndex] === state.play_stacks[suitIndex] ||
			Utils.range(state.play_stacks[suitIndex] + 1, common.hypo_stacks[suitIndex] + 1).every(rank =>
				!state.hands[state.ourPlayerIndex].some(c => me.thoughts[c.order].matches({ suitIndex, rank })));
	};

	// Play clue in 2 players while partner is not loaded and not selfish
	if (state.numPlayers === 2 && state.clue_tokens > 0 && play_clue_2p &&
		!me.thinksLoaded(state, nextPlayerIndex) && not_selfish(play_clue_2p))
		return Utils.clueToAction(play_clue_2p, tableID);

	// Playable card with any priority
	if (best_playable_card !== undefined)
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	if (state.clue_tokens > 0) {
		for (let i = actionPrioritySize + 1; i <= actionPrioritySize * 2; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? actionPrioritySize + 1 : actionPrioritySize * 2) && best_play_clue !== undefined) {
				if (clue_value >= minimum_clue_value(state)) {
					return Utils.clueToAction(best_play_clue, tableID);
				}
				else {
					logger.info('clue too low value', logClue(best_play_clue), clue_value);
					stall_clues[1].push(best_play_clue);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== actionPrioritySize * 2 && urgent_actions[i].length > 0)
				return urgent_actions[i][0];
		}
	}

	// Any play clue in 2 players
	if (state.numPlayers === 2 && state.clue_tokens > 0 && (best_play_clue || stall_clues[1].length > 0))
		return Utils.clueToAction(best_play_clue ?? Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result)), tableID);

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	// Discard known trash (no pace requirement)
	if (trash_cards.length > 0 && !state.inEndgame() && state.clue_tokens < 8)
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[actionPrioritySize * 2].length > 0)
		return urgent_actions[actionPrioritySize * 2][0];

	const severity = stall_severity(state, common, state.ourPlayerIndex);
	const endgame_stall = state.inEndgame() && me.hypo_stacks.some((stack, index) => stack > state.play_stacks[index]);

	// Stalling situations
	if (state.clue_tokens > 0 && (severity > 0 || endgame_stall)) {
		const validStall = stall_clues.find((clues, index) => (index <= severity && clues.length > 0))?.[0];

		// 8 clues, must stall
		if (state.clue_tokens === 8) {
			return validStall ? Utils.clueToAction(validStall, tableID) :
				{ type: ACTION.RANK, value: state.hands[nextPlayerIndex].at(-1).rank, target: nextPlayerIndex, tableID };
		}

		if (validStall)
			return Utils.clueToAction(validStall, tableID);
	}

	// Discarding known trash is still preferable to chop
	if (trash_cards.length > 0)
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

	return discard_chop(game, state.ourPlayerIndex, tableID);
}

/**
 * Discards the card on chop for the given playerIndex.
 * @param {Game} game
 * @param {number} playerIndex
 * @param {number} tableID
 */
function discard_chop(game, playerIndex, tableID) {
	const { common, state } = game;

	// Nothing else to do, so discard chop
	const discard = common.chop(state.hands[playerIndex]) ?? common.lockedDiscard(state, state.hands[playerIndex]);

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
