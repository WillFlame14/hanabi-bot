import { ACTION, CLUE } from '../../constants.js';
import { ACTION_PRIORITY, LEVEL } from './h-constants.js';
import { select_play_clue, determine_playable_card, order_1s, find_clue_value, find_positional_discard } from './action-helper.js';
import { find_gd, find_unlock, find_urgent_actions } from './urgent-actions.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { find_sarcastics } from '../shared/sarcastic.js';
import { inBetween, minimum_clue_value, older_queued_finesse, stall_severity, unknown_1 } from './hanabi-logic.js';
import { cardValue, isTrash } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

import { Worker } from 'worker_threads';
import * as path from 'path';
import { shortForms } from '../../variants.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').SaveClue} SaveClue
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param {Game} game
 * @param {number[]} playable_cards
 * @param {number[][]} playable_priorities
 */
function find_best_playable(game, playable_cards, playable_priorities) {
	const { state, common, me } = game;
	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
	let best_playable_order = playable_priorities[priority][0];

	// Best playable card is an unknown 1, so we should order correctly
	if (priority !== 0 && playable_priorities[priority].some(o => unknown_1(state.deck[o]))) {
		const ordered_1s = order_1s(state, common, playable_cards);

		if (ordered_1s.length > 0 && game.level >= LEVEL.BASIC_CM) {
			// Try to find a non-negative value OCM (TODO: Fix double OCMs)
			const best_ocm_index = Utils.maxOn(Utils.range(1, ordered_1s.length), i => {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

				if (playerIndex === state.ourPlayerIndex)
					return -0.1;

				const old_chop = common.chop(state.hands[playerIndex]);
				const old_chop_card = state.deck[old_chop];
				// Player is locked or has playable/trash chop, don't OCM
				if (old_chop === undefined || isTrash(state, me, old_chop_card, old_chop) || (state.isPlayable(old_chop_card) && state.clue_tokens !== 0))
					return -0.1;

				const old_chop_value = cardValue(state, me, old_chop_card);

				// Simulate chop move
				const new_chop = common.withThoughts(old_chop, (draft) => { draft.chop_moved = true; }, false).chop(state.hands[playerIndex]);
				const new_chop_value = new_chop !== undefined ? cardValue(state, me, state.deck[new_chop]) : me.thinksLoaded(state, playerIndex) ? 0 : 4;

				return old_chop_value - new_chop_value;
			}, -0.1) ?? 0;

			if (best_ocm_index !== 0) {
				logger.highlight('yellow', `performing ocm by playing ${best_ocm_index + 1}'th 1`);

				// Artificially increase priority of doing an OCM
				priority = 2;
			}
			best_playable_order = ordered_1s[best_ocm_index];
		}
		else {
			// Play (possibly pinkish) 1s in order
			const clued_1s = playable_priorities[priority].filter(o => unknown_1(state.deck[o]));
			best_playable_order = order_1s(state, common, clued_1s, { no_filter: true })[0];
		}
	}

	if (game.level >= LEVEL.INTERMEDIATE_FINESSES && priority === 0) {
		playable_priorities[0] = playable_priorities[0].filter(o => {
			const older_finesse = older_queued_finesse(state, state.ourPlayerIndex, common, o);

			if (older_finesse !== undefined)
				logger.warn('older finesse', logCard(state.deck[older_finesse]), older_finesse, 'could be layered, unable to play newer finesse', logCard(state.deck[o]));

			return older_finesse === undefined;
		});

		// Find new best playable card
		priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
		best_playable_order = playable_priorities[priority]?.[0];
	}

	if (best_playable_order !== undefined)
		logger.info(`best playable card is order ${best_playable_order}, inferences ${me.thoughts[best_playable_order].inferred.map(logCard)}`);

	return { priority, best_playable_order };
}

/**
 * @param {Clue[][]} stall_clues
 * @param {number} severity
 * @param {Clue | SaveClue} [best_play_clue]
 * @returns {Clue | undefined}
 */
function best_stall_clue(stall_clues, severity, best_play_clue) {
	// 5 Stall
	if (severity === 1 || stall_clues[0].length > 0) {
		if (stall_clues[0].length > 0)
			return stall_clues[0][0];

		return best_play_clue;
	}

	// Tempo clue stall
	if (stall_clues[1].length > 0)
		return Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result));

	const precedence4_levels = [null, null, [2], [2, 3], [2, 3, 4]];
	const allowed_stalls = precedence4_levels[severity].reduce((acc, i) => acc.concat(stall_clues[i]), []);

	const precedence4_stall = Utils.maxOn(allowed_stalls, clue => find_clue_value(clue.result));

	if (precedence4_stall !== undefined)
		return precedence4_stall;

	if (best_play_clue !== undefined)
		return best_play_clue;

	// Hard burn
	return stall_clues[5][0];
}

/**
 * @param {Game} game
 * @param {number} giver
 * @returns {Clue[]}
 */
export function find_all_clues(game, giver) {
	logger.off();
	const { play_clues, save_clues, stall_clues } = find_clues(game, { giver, noFix: true });
	logger.on();

	return [
		...play_clues.flatMap((clues, target) => clues.map(clue => ({ ...clue,  target }))),
		...Utils.range(0, game.state.numPlayers).flatMap(target => save_clues[target] ? [{ ...save_clues[target], target }] : []),
		...stall_clues.slice(0, 3).flat(), ...stall_clues[6]		// distribution clues
	];
}

/**
 * @param {Game} game
 * @param {number} playerIndex
 */
export function find_all_discards(game, playerIndex) {
	const { common, state, me } = game;

	const trash_cards = me.thinksTrash(state, playerIndex).filter(o => common.thoughts[o].saved);
	const discardable = trash_cards[0] ?? common.chop(state.hands[playerIndex]);

	logger.off();
	const positional = find_positional_discard(game, playerIndex, discardable ?? -1);
	logger.on();

	return positional !== undefined ? [positional] : (discardable ? [{ misplay: false, order: discardable }] : []);
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
			const playerChop = game.players[playerIndex].chop(state.hands[playerIndex]);
			// If the play was on chop, the clue has to be given before this player.
			// TODO: This is also true if the clue focus would change after the chop discard.
			if (playerChop !== undefined && result.playables.some(p => p.playerIndex == playerIndex && p.card.order === playerChop))
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
 * @returns {Promise<PerformAction>}
 */
export async function take_action(game) {
	const { common, state, me, tableID } = game;
	const nextPlayerIndex = state.nextPlayerIndex(state.ourPlayerIndex);

	// Look for playables, trash and important discards in own hand
	let playable_orders = me.thinksPlayables(state, state.ourPlayerIndex);
	let trash_orders = me.thinksTrash(state, state.ourPlayerIndex).filter(o => common.thoughts[o].saved);

	// Discards must be inferred, playable, trash, and not duplicated in our hand
	const discards = playable_orders.filter(order => {
		const card = me.thoughts[order];
		const id = card.identity({ infer: true });

		return game.level >= LEVEL.SARCASTIC &&
			id !== undefined &&
			trash_orders.includes(order) &&
			!playable_orders.some(o => me.thoughts[o].matches(id, { infer: true }) && o !== order);
	});

	const playable_trash = playable_orders.filter(order => {
		const id = me.thoughts[order].identity({ infer: true });

		// Pick the leftmost of all playable trash cards (except unknown 1s)
		return id !== undefined &&
			trash_orders.includes(order) &&
			(unknown_1(state.deck[order]) || !playable_orders.some(o => me.thoughts[o].matches(id, { infer: true }) && o > order));
	});

	// Remove trash from playables (but not playable trash) and discards and playable trash from trash cards
	playable_orders = playable_orders.filter(o => !trash_orders.includes(o) || playable_trash.includes(o));
	trash_orders = trash_orders.filter(o => !discards.includes(o) && !playable_trash.includes(o));

	if (playable_orders.length > 0)
		logger.info('playable cards', logHand(playable_orders));

	if (trash_orders.length > 0)
		logger.info('trash cards', logHand(trash_orders));

	if (discards.length > 0)
		logger.info('discards', logHand(discards));

	if (playable_orders.length > 0 && state.endgameTurns > 0) {
		const best_connector = Utils.maxOn(playable_orders, order => {
			const card_id = me.thoughts[order].identity({ infer: true });

			if (card_id === undefined)
				return -Infinity;

			const play_stacks = state.play_stacks.with(card_id.suitIndex, card_id.rank);
			let connectables = 0;

			for (let i = 1; i < state.endgameTurns; i++) {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;
				const connectable = state.hands[playerIndex].some(o => {
					const id = game.players[playerIndex].thoughts[o].identity({ infer: true });
					return id !== undefined && id.rank === play_stacks[id.suitIndex] + 1;
				});

				if (connectable) {
					connectables++;
					play_stacks[card_id.suitIndex]++;
				}
			}

			return connectables;
		}, 0);

		const best_playable = best_connector ??
			playable_orders.find(o => me.thoughts[o].inferred.every(i => i.rank === 5)) ??
			playable_orders.find(o => me.thoughts[o].inferred.every(i => state.isCritical(i))) ??
			playable_orders[0];

		return { tableID, type: ACTION.PLAY, target: best_playable };
	}

	const playable_priorities = determine_playable_card(game, playable_orders);

	const actionPrioritySize = Object.keys(ACTION_PRIORITY).length;
	const { priority, best_playable_order } = playable_priorities.some(playables => playables.length > 0) ?
		find_best_playable(game, playable_orders, playable_priorities) :
		{ priority: -1, best_playable_order: undefined };
	const is_finessed = playable_orders.length > 0 && priority === 0 && !state.deck[best_playable_order].clued;

	// Bluffs should never be deferred as they can lead to significant desync with human players
	if (is_finessed) {
		const best_playable_card = common.thoughts[best_playable_order];
		const { bluffed, possibly_bluffed } = best_playable_card;

		if (bluffed || possibly_bluffed) {
			logger.info('playing into potential bluff');
			return { tableID, type: ACTION.PLAY, target: best_playable_order };
		}
	}

	const chop_hidden_f = () => common.dependentConnections(best_playable_order).some(wc =>
		!wc.symmetric && wc.connections.some((conn, i) => i >= wc.conn_index && conn.reacting === nextPlayerIndex && conn.hidden &&
			wc.connections.some((conn2, j) => j > i && conn2.order === state.hands[nextPlayerIndex].findLast(o => ((c = common.thoughts[o]) => !c.clued && !c.chop_moved)()))));

	if (playable_orders.length > 0 && priority === 0 && chop_hidden_f()) {
		logger.info('must play into hidden component that may be discarded!');
		return { tableID, type: ACTION.PLAY, target: best_playable_order };
	}

	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(game);

	// ALways give a save clue after a Generation Discard to avoid desync
	if (state.generated && save_clues[nextPlayerIndex]?.safe) {
		logger.info('giving save clue after generation!');
		return Utils.clueToAction(save_clues[nextPlayerIndex], tableID);
	}

	const urgent_actions = find_urgent_actions(game, play_clues, save_clues, fix_clues, stall_clues, playable_priorities, is_finessed ? best_playable_order : -1);

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

	const discardable = discards[0] ?? trash_orders[0] ?? common.chop(state.ourHand);

	if (!is_finessed && state.clue_tokens === 0 && state.numPlayers > 2 && discardable !== undefined) {
		const nextNextPlayerIndex = state.nextPlayerIndex(nextPlayerIndex);

		const gen_required = me.chopValue(state, nextNextPlayerIndex) >= 4 &&
			!common.thinksLocked(state, nextNextPlayerIndex) &&
			!game.players[nextNextPlayerIndex].thinksLoaded(state, nextNextPlayerIndex, { assume: false }) &&
			find_unlock(game, nextNextPlayerIndex) === undefined;

		// Generate for next next player
		if (gen_required) {
			// Play a 5 if we have one
			if (playable_priorities[3].length > 0)
				return { tableID, type: ACTION.PLAY, target: playable_priorities[3][0] };

			const gen_action = () => {
				const nextChop = common.chop(state.hands[nextPlayerIndex]);

				// Try to let next player SDCM
				if (nextChop !== undefined && cardValue(state, me, state.deck[nextChop], nextChop) < 4) {
					if (me.thinksLoaded(state, nextPlayerIndex))
						return;

					const next_connecting = find_unlock(game, nextPlayerIndex);
					if (next_connecting !== undefined)
						return { tableID, type: ACTION.PLAY, target: next_connecting };
				}

				logger.highlight('yellow', `performing generation discard for ${state.playerNames[nextNextPlayerIndex]}`);
				return { tableID, type: ACTION.DISCARD, target: discardable };
			};

			const action = gen_action();
			if (action !== undefined)
				return action;
		}
	}

	/** @type {(clue: Clue, playerIndex: number) => boolean} clue */
	const not_selfish = (clue, playerIndex) => {
		const { suitIndex } = state.deck[clue.result.focus];

		return common.hypo_stacks[suitIndex] === state.play_stacks[suitIndex] ||
			Utils.range(state.play_stacks[suitIndex] + 1, common.hypo_stacks[suitIndex] + 1).every(rank =>
				!state.hands[playerIndex].some(o => me.thoughts[o].matches({ suitIndex, rank }, { infer: true })));
	};

	let best_play_clue, best_clue_value;
	let saved_clue;

	if (state.clue_tokens > 0) {
		const consider_clues = play_clues.flat().concat(save_clues.filter(clue => clue !== undefined && clue.safe));
		const chop = me.chop(state.ourHand);
		const saved_clues = [];

		// Consider saving clues to finesse positions for players who likely have
		// better cards on chop.
		if (!state.inEndgame() && !state.early_game && state.clue_tokens < 4 && chop !== undefined) {
			// Remove critical and playable identities from our chop
			const modified_me = me.withThoughts(chop, (draft) =>
				draft.possible = me.thoughts[chop].possible.intersect(me.thoughts[chop].possible.filter(i => !state.isCritical(i))), false);
			const our_chop_value = cardValue(state, modified_me, state.deck[chop], chop);

			for (const clue of consider_clues) {
				const { target } = clue;

				if (game.players[target].find_finesse(state, target) !== clue.result.focus)
					continue;

				const list = state.clueTouched(state.hands[clue.target], clue);
				const hypo_game = game.simulate_clue({ type: 'clue', clue, list, giver: state.ourPlayerIndex, target: target });

				/** @param {Player} player */
				const better_giver = (player) => {
					const { playerIndex } = player;

					if (player.thinksLoaded(state, playerIndex, { assume: false }) || !not_selfish(clue, playerIndex))
						return false;

					const otherChop = player.chop(state.hands[playerIndex]);
					const chop_value = otherChop === undefined ? 4 : cardValue(state, player, state.deck[otherChop], otherChop);

					if (chop_value > 0 && chop_value >= our_chop_value)
						logger.info(`saved clue ${logClue(clue)} for ${state.playerNames[playerIndex]} ${chop_value} > ${our_chop_value}`);

					return chop_value > 0 && chop_value >= our_chop_value;
				};

				const saved_for = find_clue_givers(game, clue, state.ourPlayerIndex).filter(i => i !== state.ourPlayerIndex && better_giver(hypo_game.players[i]));
				if (saved_for.length === 0)
					continue;

				saved_clues.push(clue);
			}

			const { clue, clue_value } = select_play_clue(consider_clues.filter(clue => !saved_clues.some(cl => Utils.objEquals(clue, cl))));
			const save = select_play_clue(saved_clues);
			saved_clue = save.clue;
			const saved_value = save.clue_value;

			if (saved_clue === undefined || clue_value > saved_value) {
				best_play_clue = clue;
				best_clue_value = clue_value;
			}
		}
		else {
			({ clue: best_play_clue, clue_value: best_clue_value } = select_play_clue(consider_clues));
		}
		logger.info('best play clue', logClue(best_play_clue));
	}

	// Attempt to solve endgame
	if (state.inEndgame()) {
		logger.highlight('purple', 'Attempting to solve endgame...');

		const workerData = { game: Utils.toJSON(game), playerTurn: state.ourPlayerIndex, conv: 'HGroup', logLevel: logger.level, shortForms };
		const worker = new Worker(path.resolve(import.meta.dirname, '../', 'shared', 'endgame.js'), { workerData });

		const result = await new Promise((resolve, reject) => {
			worker.on('message', ({ success, action, err }) => {
				if (success) {
					resolve({ action });
				}
				else {
					logger.warn(`couldn't solve endgame yet: ${err.message}`);
					resolve(undefined);
				}
			});

			worker.on('error', (msg) => {
				console.log('worker threw an error while solving endgame!', msg);
				reject(msg);
			});
		});

		if (result !== undefined) {
			const { action } = result;

			if (action.type === ACTION.COLOUR || action.type === ACTION.RANK) {
				const stall_clue = best_play_clue ??
					best_stall_clue(stall_clues, 4) ??
					{ type: CLUE.RANK, target: nextPlayerIndex, value: state.deck[state.hands[nextPlayerIndex].at(-1)].rank };

				return Utils.clueToAction(stall_clue, tableID);
			}

			return { tableID, type: action.type, target: action.target };
		}
	}

	// Consider finesses while finessed if we are only waited on to play one card,
	// it's not a selfish finesse, doesn't require more than one play from our own hand,
	// and we're not in the end-game.
	const waiting_self_connections = common.waiting_connections.filter(c => !c.symmetric && c.connections[c.conn_index]?.reacting === state.ourPlayerIndex);
	const waiting_cards = waiting_self_connections.reduce((sum, c) => sum + c.connections.length - c.conn_index, 0);
	const waiting_out_of_order = waiting_self_connections.some(({ connections, conn_index, target }) =>
		connections.length >= conn_index + 2 &&
		!inBetween(state.numPlayers, connections[conn_index + 1].reacting, state.ourPlayerIndex, connections[conn_index + 2]?.reacting ?? target));
	const consider_finesse = !is_finessed || best_play_clue && waiting_cards < 3 && !waiting_out_of_order && not_selfish(best_play_clue, state.ourPlayerIndex) && !state.inEndgame();

	// Get a high value play clue involving next player (otherwise, next player can give it)
	if (consider_finesse && best_play_clue?.result.finesses.length > 0 && (best_play_clue.target == nextPlayerIndex || best_play_clue.result.finesses.some(f => f.playerIndex === nextPlayerIndex)))
		return Utils.clueToAction(best_play_clue, tableID);

	// If we have a finesse and no urgent high value clues to give, play into the finesse.
	if (playable_orders.length > 0 && priority === 0 && !playable_trash.includes(best_playable_order))
		return { tableID, type: ACTION.PLAY, target: best_playable_order };

	// Blind play a missing card in the endgame
	if (state.cardsLeft === 0 && state.strikes < 2) {
		for (let suitIndex = 0; suitIndex < state.variant.suits.length; suitIndex++) {
			if (state.play_stacks[suitIndex] === state.max_ranks[suitIndex])
				continue;

			const identity = { suitIndex, rank: state.play_stacks[suitIndex] + 1 };
			const slot1 = state.ourHand[0];

			if (me.thoughts[slot1].possible.has(identity)) {
				logger.highlight('yellow', 'trying to play slot 1 as', logCard(identity));
				return { tableID, type: ACTION.PLAY, target: slot1 };
			}
		}
	}

	// Sarcastic discard to someone else
	if (game.level >= LEVEL.SARCASTIC && discards.length > 0 && state.clue_tokens !== 8) {
		const valid_discards = game.level >= LEVEL.SPECIAL_DISCARDS ? discards : discards.filter(o => state.deck[o].clued);

		if (valid_discards.length > 0) {
			const order = valid_discards[0];
			const identity = me.thoughts[order].identity({ infer: true });

			const duplicates = state.hands.reduce((cards, hand, index) => {
				if (index === state.ourPlayerIndex)
					return cards;
				return cards.concat(hand.filter(o => me.thoughts[o].matches(identity)).map(o => game.players[index].thoughts[o]));
			}, /** @type {Card[]} */ ([]));

			if (!duplicates.every(c => c.inferred.every(p => p.matches(identity) || state.isBasicTrash(p)))) {
				// If playing reveals duplicates are trash, playing is better for tempo
				if (duplicates.every(c => c.possible.every(p => p.matches(identity) || state.isBasicTrash(p))))
					return { tableID, type: ACTION.PLAY, target: order };

				return { tableID, type: ACTION.DISCARD, target: order };
			}
		}
	}

	// Unlock other player than next
	if (urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize].length > 0)
		return urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize][0];

	// Forced discard if next player is locked
	if ((state.clue_tokens === 0 || (state.clue_tokens === 1 && playable_orders.length === 0)) && common.thinksLocked(state, nextPlayerIndex)) {
		logger.info('next player is locked, forcing discard');
		return take_discard(game, state.ourPlayerIndex, trash_orders);
	}

	// Attempt a Gentleman's Discard
	if (game.level >= LEVEL.SPECIAL_DISCARDS && state.pace >= 2 * state.numPlayers) {
		for (let i = 0; i < state.numPlayers; i++) {
			if (i === state.ourPlayerIndex || me.chopValue(state, i) === 0)
				continue;

			const gd_target = find_gd(game, i);

			if (gd_target !== undefined) {
				logger.info('performing gd on', state.playerNames[i]);
				return { tableID, type: ACTION.DISCARD, target: gd_target };
			}
		}
	}

	// Playing a connecting card or playing a 5
	if (best_playable_order !== undefined && priority <= 3)
		return { tableID, type: ACTION.PLAY, target: best_playable_order };

	// Attempt a Baton Discard
	if (game.level >= LEVEL.SPECIAL_DISCARDS && state.pace >= 2 * state.numPlayers) {
		for (let i = 0; i < state.numPlayers; i++) {
			if (i === state.ourPlayerIndex || state.hands[i].filter(o => !state.deck[o].clued).length <= 2)
				continue;

			const baton_target = state.ourHand.find(o => {
				const id = me.thoughts[o].identity({ infer: true });
				const finesse = common.find_finesse(state, i);

				return id !== undefined && me.thoughts[o].clued && !state.isPlayable(id) && !state.isBasicTrash(id) && state.deck[finesse]?.matches(id) &&
					find_sarcastics(state, i, common, state.deck[finesse]).length === 0;
			});

			if (baton_target !== undefined) {
				logger.info('performing baton on', state.playerNames[i]);
				return { tableID, type: ACTION.DISCARD, target: baton_target };
			}
		}
	}

	// Discard known trash at high pace, low clues
	if (best_playable_order === undefined && trash_orders.length > 0 && state.pace > state.numPlayers * 2 && state.clue_tokens <= 2)
		return { tableID, type: ACTION.DISCARD, target: trash_orders[0] };

	// Shout Discard on a valuable card that moves chop to trash
	const next_chop = me.chop(state.hands[nextPlayerIndex]);
	const should_shout = game.level >= LEVEL.LAST_RESORTS &&
		best_playable_order !== undefined &&
		!me.thinksLoaded(state, nextPlayerIndex) &&
		trash_orders.length > 0 &&
		next_chop !== undefined &&
		state.clue_tokens <= 2;

	if (should_shout) {
		const new_chop_value = me.withThoughts(next_chop, (draft) => { draft.chop_moved = true; }).chopValue(state, nextPlayerIndex);

		if (cardValue(state, me, state.deck[next_chop], next_chop) >= 1 && new_chop_value === 0) {
			logger.highlight('yellow', `performing shout discard on ${logCard(state.deck[next_chop])}`);
			return { tableID, type: ACTION.DISCARD, target: trash_orders[0] };
		}
	}

	// Give TCCM on a valuable card that moves chop to trash
	if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && state.clue_tokens > 0) {
		const best_tempo_clue = Utils.maxOn(stall_clues[1], clue => {
			const { target } = clue;
			const chop = common.chop(state.hands[target]);

			// Chop doesn't exist or is playable/trash, ignore
			if (chop === undefined || cardValue(state, me, state.deck[chop]) === 0 || state.isPlayable(state.deck[chop]))
				return -1;

			const new_chop_value = me.withThoughts(chop, (draft) => { draft.chop_moved = true; }).chopValue(state, target);
			return new_chop_value === 0 ? find_clue_value(clue.result) : -1;
		}, 0);

		if (best_tempo_clue !== undefined) {
			logger.highlight('yellow', `performing tccm on valuable card moving chop to trash ${logClue(best_tempo_clue)}`);
			return Utils.clueToAction(best_tempo_clue, tableID);
		}
	}

	const play_clue_2p = best_play_clue ?? Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result));

	// Play clue in 2 players while partner is not loaded and not selfish
	if (state.numPlayers === 2 && state.clue_tokens > 0 && play_clue_2p && !me.thinksLoaded(state, nextPlayerIndex) && not_selfish(play_clue_2p, state.ourPlayerIndex))
		return Utils.clueToAction(play_clue_2p, tableID);

	// Playable card with any priority
	if (best_playable_order !== undefined)
		return { tableID, type: ACTION.PLAY, target: best_playable_order };

	const common_severity = stall_severity(state, common, state.ourPlayerIndex);
	const actual_severity = stall_severity(state, me, state.ourPlayerIndex);

	if (state.clue_tokens > 0) {
		for (let i = actionPrioritySize + 1; i <= actionPrioritySize * 2; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? actionPrioritySize + 1 : actionPrioritySize * 2) && best_play_clue !== undefined) {
				if (best_clue_value >= minimum_clue_value(state))
					return Utils.clueToAction(best_play_clue, tableID);
				else
					logger.info('clue too low value', logClue(best_play_clue), best_clue_value);
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

	// Perform a positional discard/misplay at <= 1 clue
	if (game.level >= LEVEL.ENDGAME) {
		const positional = find_positional_discard(game, state.ourPlayerIndex, discardable);

		if (positional !== undefined) {
			const { misplay, order } = positional;
			return { tableID, type: misplay ? ACTION.PLAY : ACTION.DISCARD, target: order };
		}
	}

	// Discard known trash (no pace requirement)
	if (trash_orders.length > 0 && !state.inEndgame() && state.clue_tokens < 8)
		return { tableID, type: ACTION.DISCARD, target: trash_orders[0] };

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[actionPrioritySize * 2].length > 0)
		return urgent_actions[actionPrioritySize * 2][0];

	// Stalling situations
	if (state.clue_tokens > 0 && actual_severity > 0 && common_severity > 0) {
		best_play_clue ??= saved_clue;

		const valid_play_clue = best_play_clue && (state.turn_count === 1 ||
			'cm' in best_play_clue ||
			!best_play_clue.result.bad_touch.some(o => state.deck[o].matches(state.deck[best_play_clue.result.focus])));

		// Give play clue even if possibly duping or someone else has a better chop
		if (valid_play_clue && find_clue_value({ ...best_play_clue.result, avoidable_dupe: 0 }) >= minimum_clue_value(state))
			return Utils.clueToAction(best_play_clue, tableID);

		const validStall = best_stall_clue(stall_clues, common_severity, valid_play_clue ? best_play_clue : undefined);

		// 8 clues, must stall
		if (state.clue_tokens === 8) {
			if (validStall)
				return Utils.clueToAction(validStall, tableID);

			// Give any legal clue
			for (let i = 1; i < state.numPlayers; i++) {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;
				const valid_clues = state.allValidClues(playerIndex);

				logger.warn('unable to find any good clue, giving any valid clue!');

				if (valid_clues.length > 0)
					return Utils.clueToAction(valid_clues[0], tableID);
			}

			// Bomb discardable slot, or slot 1
			const target = discardable ?? state.ourHand[0];
			return { tableID, type: ACTION.PLAY, target };
		}

		if (validStall)
			return Utils.clueToAction(validStall, tableID);

		logger.info('no valid stall! severity', common_severity);
	}

	return take_discard(game, state.ourPlayerIndex, trash_orders);
}

/**
 * Takes the best discard in hand for the given playerIndex.
 * @param {Game} game
 * @param {number} playerIndex
 * @param {number[]} trash_orders
 */
function take_discard(game, playerIndex, trash_orders) {
	const { common, state, tableID } = game;
	const hand = state.hands[playerIndex];

	// Discarding known trash is preferable to chop
	const discard = trash_orders[0] ?? common.chop(hand) ?? common.lockedDiscard(state, hand);

	return { tableID, type: ACTION.DISCARD, target: discard };
}
