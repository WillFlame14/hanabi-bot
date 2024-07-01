import { ACTION, CLUE } from '../../constants.js';
import { ACTION_PRIORITY, LEVEL } from './h-constants.js';
import { select_play_clue, determine_playable_card, order_1s, find_clue_value } from './action-helper.js';
import { UnsolvedGame, solve_game } from '../shared/endgame.js';
import { find_unlock, find_urgent_actions } from './urgent-actions.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { determine_focus, inBetween, minimum_clue_value, older_queued_finesse, stall_severity } from './hanabi-logic.js';
import { cardValue, isTrash } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param {Game} game
 * @param {ActualCard[]} playable_cards
 * @param {ActualCard[][]} playable_priorities
 */
function find_best_playable(game, playable_cards, playable_priorities) {
	const { state, common, me } = game;
	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
	let best_playable_card = playable_priorities[priority][0];

	// Best playable card is an unknown 1, so we should order correctly
	if (priority !== 0 && best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
		const ordered_1s = order_1s(state, common, playable_cards);

		if (ordered_1s.length > 0 && game.level >= LEVEL.BASIC_CM) {
			// Try to find a non-negative value OCM (TODO: Fix double OCMs)
			const best_ocm_index = Utils.maxOn(Utils.range(1, ordered_1s.length), i => {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

				if (playerIndex === state.ourPlayerIndex)
					return -0.1;

				const old_chop = common.chop(state.hands[playerIndex]);
				// Player is locked or has playable/trash chop, don't OCM
				if (old_chop === undefined || isTrash(state, me, old_chop, old_chop.order) || (state.isPlayable(old_chop) && state.clue_tokens !== 0))
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

			if (best_ocm_index !== 0) {
				logger.highlight('yellow', `performing ocm by playing ${best_ocm_index + 1}'th 1`);

				// Artificially increase priority of doing an OCM
				priority = 2;
			}
			best_playable_card = ordered_1s[best_ocm_index];
		}
	}

	if (game.level >= LEVEL.INTERMEDIATE_FINESSES && priority === 0) {
		playable_priorities[0] = playable_priorities[0].filter(c => {
			const older_finesse = older_queued_finesse(state.hands[state.ourPlayerIndex], common, c.order);

			if (older_finesse !== undefined)
				logger.warn('older finesse', logCard(older_finesse), older_finesse.order, 'could be layered, unable to play newer finesse', logCard(c));

			return older_finesse === undefined;
		});

		// Find new best playable card
		priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
		best_playable_card = playable_priorities[priority]?.[0];
	}

	if (best_playable_card !== undefined)
		logger.info(`best playable card is order ${best_playable_card.order}, inferences ${me.thoughts[best_playable_card.order].inferred.map(logCard)}`);

	return { priority, best_playable_card };
}

/**
 * @param {Clue[][]} stall_clues
 * @param {number} severity
 * @returns {Clue | undefined}
 */
function best_stall_clue(stall_clues, severity) {
	// 5 Stall
	if (severity === 1 || stall_clues[0].length > 0)
		return stall_clues[0][0];

	// Tempo clue stall
	if (stall_clues[1].length > 0)
		return stall_clues[1][0];

	const precedence4_levels = [null, null, [2], [2, 3], [2, 3, 4]];
	const allowed_stalls = precedence4_levels[severity].reduce((acc, i) => acc.concat(stall_clues[i]), []);

	const precedence4_stall = Utils.maxOn(allowed_stalls, clue => find_clue_value(clue.result));

	if (precedence4_stall !== undefined)
		return precedence4_stall;

	// Hard burn
	return stall_clues[5][0];
}

/** @param {Game} game */
export function find_all_clues(game) {
	logger.collect();
	const { play_clues, save_clues } = find_clues(game);
	logger.flush(false);

	return [
		...play_clues.flatMap((clues, target) => clues.map(clue => Object.assign(clue, { target }))),
		...Utils.range(0, game.state.numPlayers).reduce((acc, target) => (save_clues[target] ? acc.concat([Object.assign(save_clues[target], { target })]) : acc), []),
	];
}

/**
 * Returns the list of players who could give the given clue originally considered for giver.
 * @param {Game} game
 * @param {Clue} clue
 * @param {number} giver
 * @returns {number[]}
 */
export function find_clue_givers(game, clue, giver) {
	const { state } = game;
	const { result } = clue;

	const givers = [giver];
	for (let playerIndex = state.nextPlayerIndex(giver);
		playerIndex != giver;
		playerIndex = state.nextPlayerIndex(playerIndex)) {
		// Once we reach a finessed play, any players after would no longer
		// be able to give this clue.
		if (result.finesses.some(f => f.playerIndex == playerIndex))
			return givers;

		// The targeted player can't clue themselves.
		if (playerIndex == clue.target) {
			const playerChop = game.players[playerIndex].chop(state.hands[playerIndex]).order;
			// If the play was on chop, the clue has to be given before this player.
			// TODO: This is also true if the clue focus would change after the chop discard.
			if (result.playables.some(p => p.playerIndex == playerIndex && p.card.order == playerChop))
				return givers;
			continue;
		}

		// A player can't give a clue if it involves playing a previously unknown card in its own hand.
		if (result.playables.some(p => p.playerIndex == playerIndex && game.players[playerIndex].thoughts[p.card.order].identity() === undefined))
			continue;

		givers.push(playerIndex);
	}
	return givers;
}

/**
 * Performs the most appropriate action given the current state.
 * @param {Game} game
 * @returns {PerformAction}
 */
export function take_action(game) {
	const { common, state, me, tableID } = game;
	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;

	// Look for playables, trash and important discards in own hand
	let playable_cards = me.thinksPlayables(state, state.ourPlayerIndex).map(({ order }) => me.thoughts[order]);
	let trash_cards = me.thinksTrash(state, state.ourPlayerIndex).filter(c => common.thoughts[c.order].saved).map(({ order }) => me.thoughts[order]);

	// Discards must be inferred, playable, trash, not duplicated in our hand and not part of a connection
	const discards = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		return game.level >= LEVEL.SARCASTIC &&
			id !== undefined &&
			trash_cards.some(c => c.order === card.order) &&
			!playable_cards.some(c => me.thoughts[c.order].matches(id, { infer: true }) && c.order !== card.order) &&
			!common.waiting_connections.some(wc =>
				!wc.symmetric &&
				wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === card.order));
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

	const actionPrioritySize = Object.keys(ACTION_PRIORITY).length;
	const { priority, best_playable_card } = playable_priorities.some(playables => playables.length > 0) ?
		find_best_playable(game, playable_cards, playable_priorities) :
		{ priority: -1, best_playable_card: undefined };
	const is_finessed = playable_cards.length > 0 && priority === 0;

	// Bluffs should never be deferred as they can lead to significant desync with human players
	if (is_finessed && playable_cards.some(c => common.thoughts[c.order].bluffed))
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities, is_finessed ? best_playable_card : undefined);

	if (urgent_actions.some(actions => actions.length > 0))
		logger.info('all urgent actions', urgent_actions.flatMap((actions, index) => actions.map(action => ({ [index]: logPerformAction(action) }))));

	// Unlock next player
	if (urgent_actions[ACTION_PRIORITY.UNLOCK].length > 0)
		return urgent_actions[ACTION_PRIORITY.UNLOCK][0];

	// Urgent save for next player
	for (let i = 1; i < actionPrioritySize; i++) {
		const action = urgent_actions[i].find(action => state.clue_tokens > 0 || (action.type !== ACTION.RANK && action.type !== ACTION.COLOUR));

		if (action)
			return action;
	}

	const discardable = trash_cards[0] ?? common.chop(state.hands[state.ourPlayerIndex]);

	if (!is_finessed && state.clue_tokens === 0 && state.numPlayers > 2 && discardable !== undefined) {
		const nextNextPlayerIndex = (nextPlayerIndex + 1) % state.numPlayers;

		// Generate for next next player
		if (me.chopValue(state, nextNextPlayerIndex) >= 4 && !common.thinksLoaded(state, nextNextPlayerIndex, {assume: false}) && find_unlock(game, nextNextPlayerIndex) === undefined) {
			const nextChop = common.chop(state.hands[nextPlayerIndex]);

			// Play a 5 if we have one
			if (playable_priorities[3].length > 0)
				return { tableID, type: ACTION.PLAY, target: playable_priorities[3][0].order };

			// Next player can't SDCM
			if (me.thinksPlayables(state, nextPlayerIndex).length === 0 || nextChop === undefined || cardValue(state, me, nextChop, nextChop.order) >= 4) {
				logger.highlight('yellow', `performing generation discard for ${state.playerNames[nextNextPlayerIndex]}`);
				return { tableID, type: ACTION.DISCARD, target: discardable.order };
			}
		}
	}

	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		const all_play_clues = play_clues.flat();
		let consider_clues = all_play_clues;
		const chop = game.me.chop(state.hands[state.ourPlayerIndex]);
		let saved_clue;
		let saved_clue_value = -99;

		// Consider saving clues to finesse positions for players who likely have
		// better cards on chop.
		if (!state.inEndgame() && !state.early_game && state.clue_tokens < 4 && chop !== undefined) {
			const our_chop_value = cardValue(state, game.me, chop, chop.order);
			const better_givers = [];
			for (let i = 0; i < state.numPlayers; ++i) {
				if (i == state.ourPlayerIndex)
					continue;
				const player = game.players[i];
				const hand = state.hands[i];
				if (player.thinksLoaded(state, i, {assume: false}))
					continue;
				const otherChop = player.chop(hand);
				// Saves clue for locked players or players who likely have a better chop.
				if (otherChop === undefined && player.thinksLocked(state, i))
					better_givers.push(i);
				else if (otherChop !== undefined && cardValue(state, player, otherChop, otherChop.order) >= our_chop_value)
					better_givers.push(i);
			}
			if (better_givers.length > 0) {
				let saved_for = [];
				consider_clues = consider_clues.filter(clue => {
					const list = state.hands[clue.target].clueTouched(clue, state.variant).map(c => c.order);
					const { finesse } = determine_focus(state.hands[clue.target], common, list, {beforeClue: true});
					if (!finesse)
						return true;

					const save_for = find_clue_givers(game, clue, state.ourPlayerIndex).filter(playerIndex => better_givers.includes(playerIndex));
					if (save_for.length == 0)
						return true;
					const value = find_clue_value(clue.result);
					if (saved_clue === undefined || value > saved_clue_value) {
						saved_for = save_for;
						saved_clue = clue;
						saved_clue_value = value;
					}
					return false;
				});
				if (saved_clue !== undefined)
					logger.info(`saved clue ${logClue(saved_clue)} for ${saved_for.map(playerIndex => state.playerNames[playerIndex]).join(', ')}`);
			}
		}

		({ clue: best_play_clue, clue_value } = select_play_clue(consider_clues));
		if (saved_clue !== undefined && saved_clue_value > clue_value && state.clue_tokens < 2)
			best_play_clue = clue_value = undefined;
	}

	// Attempt to solve endgame
	if (!is_finessed && state.inEndgame() && state.cardsLeft > 0) {
		try {
			const action = solve_game(game, state.ourPlayerIndex, find_all_clues);

			if (action.type === ACTION.COLOUR || action.type === ACTION.RANK) {
				const stall_clue = best_play_clue ?? best_stall_clue(stall_clues, 4) ??
					{ type: CLUE.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank };

				return Utils.clueToAction(stall_clue, tableID);
			}

			if (action.type === ACTION.PLAY)
				return { tableID, type: ACTION.PLAY, target: action.target };

			if (action.type === ACTION.DISCARD)
				return take_discard(game, state.ourPlayerIndex, trash_cards);
		}
		catch (err) {
			if (err instanceof UnsolvedGame)
				logger.warn(`couldn't solve endgame yet: ${err.message}`);
			else
				throw err;
		}
	}

	/** @param {Clue} clue */
	const not_selfish = (clue) => {
		const list = state.hands[clue.target].clueTouched(clue, state.variant).map(c => c.order);
		const { focused_card } = determine_focus(state.hands[clue.target], common, list, { beforeClue: true });
		const { suitIndex } = focused_card;

		return common.hypo_stacks[suitIndex] === state.play_stacks[suitIndex] ||
			Utils.range(state.play_stacks[suitIndex] + 1, common.hypo_stacks[suitIndex] + 1).every(rank =>
				!state.hands[state.ourPlayerIndex].some(c => me.thoughts[c.order].matches({ suitIndex, rank })));
	};

	// Consider finesses while finessed if we are only waited on to play one card,
	// it's not a selfish finesse, doesn't require more than one play from our own hand,
	// and we're not in the end-game.
	const waiting_self_connections = game.common.waiting_connections.filter(c => c.connections[c.conn_index]?.reacting === state.ourPlayerIndex);
	const waiting_cards = waiting_self_connections.reduce((sum, c) => sum + c.connections.length - c.conn_index, 0);
	const waiting_out_of_order = waiting_self_connections.some(c => c.connections.length >= c.conn_index + 2 && !inBetween(state.numPlayers, c.connections[c.conn_index + 1].reacting, state.ourPlayerIndex, c.connections[c.conn_index + 2]?.reacting ?? c.target));
	const consider_finesse = !is_finessed || best_play_clue && waiting_cards < 3 && !waiting_out_of_order && not_selfish(best_play_clue) && !state.inEndgame();

	// Get a high value play clue involving next player (otherwise, next player can give it)
	if (consider_finesse && best_play_clue?.result.finesses.length > 0 && (best_play_clue.target == nextPlayerIndex || best_play_clue.result.finesses.some(f => f.playerIndex === nextPlayerIndex)))
		return Utils.clueToAction(best_play_clue, tableID);

	// If we have a finesse and no urgent high value clues to give, play into the finesse.
	if (is_finessed)
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	// Sarcastic discard to someone else
	if (game.level >= LEVEL.SARCASTIC && discards.length > 0 && state.clue_tokens !== 8) {
		const identity = discards[0].identity({ infer: true });

		/** @type {Card[]} */
		const duplicates = state.hands.reduce((cards, hand, index) => {
			if (index === state.ourPlayerIndex)
				return cards;
			return cards.concat(hand.filter(c => me.thoughts[c.order].matches(identity)).map(c => game.players[index].thoughts[c.order]));
		}, []);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (duplicates.every(c => c.possible.every(p => p.matches(identity) || state.isBasicTrash(p))))
			return { tableID, type: ACTION.PLAY, target: discards[0].order };

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize].length > 0)
		return urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize][0];

	// Forced discard if next player is locked
	// TODO: Anxiety play
	if ((state.clue_tokens === 0 || (state.clue_tokens === 1 && playable_cards.length === 0)) && common.thinksLocked(state, nextPlayerIndex))
		return take_discard(game, state.ourPlayerIndex, trash_cards);

	// Playing a connecting card or playing a 5
	if (best_playable_card !== undefined && priority <= 3)
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };

	// Discard known trash at high pace, low clues
	if (best_playable_card === undefined && trash_cards.length > 0 && state.pace > state.numPlayers * 2 && state.clue_tokens <= 2)
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

	// Shout Discard on a valuable card that moves chop to trash
	const next_chop = me.chop(state.hands[nextPlayerIndex]);
	if (game.level >= LEVEL.LAST_RESORTS && best_playable_card !== undefined && trash_cards.length > 0 && next_chop !== undefined && state.clue_tokens <= 2) {
		// Temporarily chop move their chop
		me.thoughts[next_chop.order].chop_moved = true;
		const new_chop_value = me.chopValue(state, nextPlayerIndex);

		// Undo chop move
		me.thoughts[next_chop.order].chop_moved = false;

		if (cardValue(state, me, next_chop, next_chop.order) >= 1 && new_chop_value === 0) {
			logger.highlight('yellow', `performing shout discard on ${logCard(next_chop)}`);
			return{ tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
		}
	}

	// Give TCCM on a valuable card that moves chop to trash
	if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && state.clue_tokens > 0) {
		const best_tempo_clue = Utils.maxOn(stall_clues[1], clue => {
			const { target } = clue;

			const chop = common.chop(state.hands[target]);

			// Chop doesn't exist or is playable/trash, ignore
			if (chop === undefined || cardValue(state, me, chop) === 0 || state.isPlayable(chop))
				return -1;

			// Temporarily chop move their chop
			me.thoughts[chop.order].chop_moved = true;
			const new_chop_value = me.chopValue(state, target);

			// Undo chop move
			me.thoughts[chop.order].chop_moved = false;

			return new_chop_value === 0 ? find_clue_value(clue.result) : -1;
		}, 0);

		if (best_tempo_clue !== undefined) {
			logger.highlight('yellow', `performing tccm on valuable card moving chop to trash ${logClue(best_tempo_clue)}`);
			return Utils.clueToAction(best_tempo_clue, tableID);
		}
	}

	const play_clue_2p = best_play_clue ?? Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result));

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

	const common_severity = stall_severity(state, common, state.ourPlayerIndex);
	const actual_severity = stall_severity(state, game.me, state.ourPlayerIndex);

	// Stalling situations
	if (state.clue_tokens > 0 && actual_severity > 0) {
		const validStall = best_stall_clue(stall_clues, common_severity);

		// 8 clues, must stall
		if (state.clue_tokens === 8) {
			return validStall ? Utils.clueToAction(validStall, tableID) :
				{ type: ACTION.RANK, value: state.hands[nextPlayerIndex].at(-1).rank, target: nextPlayerIndex, tableID };
		}

		if (validStall)
			return Utils.clueToAction(validStall, tableID);

		logger.info('no valid stall! severity', common_severity);
	}

	return take_discard(game, state.ourPlayerIndex, trash_cards);
}

/**
 * Takes the best discard in hand for the given playerIndex.
 * @param {Game} game
 * @param {number} playerIndex
 * @param {ActualCard[]} trash_cards
 */
function take_discard(game, playerIndex, trash_cards) {
	const { tableID } = game;

	// Discarding known trash is preferable to chop
	if (trash_cards.length > 0)
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };

	return discard_chop(game, playerIndex);
}

/**
 * Discards the card on chop for the given playerIndex.
 * @param {Game} game
 * @param {number} playerIndex
 */
function discard_chop(game, playerIndex) {
	const { common, state, tableID } = game;

	// Nothing else to do, so discard chop
	const discard = common.chop(state.hands[playerIndex]) ?? common.lockedDiscard(state, state.hands[playerIndex]);

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
