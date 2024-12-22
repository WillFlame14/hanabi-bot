import { DISCARD_INTERP, LEVEL, PLAY_INTERP } from './h-constants.js';
import { isTrash } from '../../basics/hanabi-util.js';
import { team_elim, undo_hypo_stacks } from '../../basics/helper.js';
import { interpret_sarcastic } from '../shared/sarcastic.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';
import { getRealConnects } from './hanabi-logic.js';
import { check_ocm } from './interpret-play.js';
import { interpret_baton, interpret_gd } from '../shared/special-discards.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../h-player.js').HGroup_Player} Player
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').DiscardAction} DiscardAction
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 */

/**
 * Impure! (updates game if rewinded, otherwise only common.wcs)
 * @param {Game} game
 * @param {DiscardAction} action
 */
function check_transfer(game, action) {
	const { common, state } = game;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };

	/** @type {WaitingConnection[]} */
	const new_wcs = [];

	for (const [i, waiting_connection] of common.waiting_connections.entries()) {
		const { connections, conn_index, inference, action_index, giver } = waiting_connection;

		const dc_conn_index = connections.findIndex((conn, index) => index >= conn_index && conn.order === order);
		if (dc_conn_index === -1) {
			new_wcs.push(waiting_connection);
			continue;
		}

		if (failed && game.finesses_while_finessed[playerIndex].some(c => c.matches({ suitIndex, rank }))) {
			logger.info('bombed duplicated card from finessing while finessed');
			action.intentional = true;
			new_wcs.push(waiting_connection);
			continue;
		}

		logger.info(`discarded connecting card ${logCard({ suitIndex, rank })}, cancelling waiting connection for inference ${logCard(inference)}`);

		const replaceable = (state.deck[order].clued || (game.level >= LEVEL.SPECIAL_DISCARDS && common.thoughts[order].touched)) &&
			rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex] &&
			!failed;

		let transfers = [], interp;

		if (replaceable) {
			transfers = interpret_sarcastic(game, action);
			interp = DISCARD_INTERP.SARCASTIC;

			if (transfers.length === 0 && game.level >= LEVEL.SPECIAL_DISCARDS) {
				transfers = interpret_gd(game, action, common.find_finesse.bind(common));
				interp = DISCARD_INTERP.GENTLEMANS;
			}

			/** @param {Connection} new_conn */
			const add_remaining_wcs = (new_conn) => {
				for (let j = i + 1; j < common.waiting_connections.length; j++) {
					const wc = common.waiting_connections[j];
					const dc_ci = wc.connections.findIndex((conn, index) => index >= conn_index && conn.order === order);

					if (dc_ci === -1)
						new_wcs.push(wc);
					else
						new_wcs.push({ ...wc, connections: wc.connections.with(dc_ci, new_conn) });
				}
			};

			// Sarcastic/GD, rewrite connection onto this person
			if (transfers.length === 1) {
				logger.info('rewriting connection to transfer to', transfers[0]);
				const reacting = state.hands.findIndex(hand => hand.includes(transfers[0]));
				const new_conn = /** @type {const} */({ ...connections[dc_conn_index], type: 'known', reacting, order: transfers[0] });

				new_wcs.push({ ...waiting_connection, connections: connections.with(dc_conn_index, new_conn) });

				add_remaining_wcs(new_conn);

				common.waiting_connections = new_wcs;
				return { interp, new_game: game };
			}
			else if (transfers.length > 1 && transfers.every(o => state.hands[giver].includes(o))) {
				logger.info('rewriting connection to transfer to', transfers);

				const new_conn = /** @type {const} */({
					...connections[dc_conn_index],
					type: 'playable',
					reacting: state.hands.findIndex(hand => hand.includes(transfers[0])),
					order: transfers.find(o => state.deck[o].matches(identity, { assume: true })),
					linked: transfers
				});

				new_wcs.push({ ...waiting_connection, connections: connections.with(dc_conn_index, new_conn) });
				add_remaining_wcs(new_conn);

				common.waiting_connections = new_wcs;
				return { interp, new_game: game };
			}
		}

		// Another waiting connection exists for this, can ignore
		const other_waiting = new_wcs.find(wc => !wc.symmetric && action_index === wc.action_index) ??
			common.waiting_connections.find((wc, index) => index > i && !wc.symmetric && action_index === wc.action_index);

		if (other_waiting !== undefined) {
			logger.info('other waiting connection', other_waiting.connections.map(logConnection).join(' -> '), 'exists, continuing');
			continue;
		}

		const real_connects = getRealConnects(connections, dc_conn_index);
		const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: real_connects, order, inference }]);
		if (new_game) {
			new_game.updateNotes();
			Object.assign(game, new_game);
			return { interp, new_game };
		}
	}

	game.common.waiting_connections = new_wcs;
	return { interp: DISCARD_INTERP.NONE, new_game: game };
}

/**
 * Impure!
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {typeof DISCARD_INTERP[keyof typeof DISCARD_INTERP]} interp
 */
function resolve_discard(game, action, interp) {
	const { common, state } = game;
	const { playerIndex } = action;

	game.interpretMove(interp);

	team_elim(game);

	if (playerIndex === state.ourPlayerIndex) {
		for (const order of state.ourHand) {
			if (common.thoughts[order].uncertain)
				common.updateThoughts(order, (draft) => { draft.uncertain = false; });
		}
	}
}

/**
 * Interprets (writes notes) for a discard of the given card.
 * 
 * Impure!
 * @param {Game} game
 * @param {DiscardAction} action
 */
export function interpret_discard(game, action) {
	const { common, state, me } = game;
	const { order, playerIndex, suitIndex, rank, failed } = action;
	const identity = { suitIndex, rank };

	const before_trash = common.thinksTrash(state, playerIndex).filter(o => common.thoughts[o].saved);
	const old_chop = common.chop(state.hands[playerIndex]);
	const slot = state.hands[playerIndex].findIndex(o => o === order) + 1;

	if (game.level >= LEVEL.BASIC_CM && rank === 1 && failed) {
		const ocm_order = check_ocm(game, action);

		if (ocm_order !== -1) {
			common.updateThoughts(ocm_order, (draft) => { draft.chop_moved = true; });
			game.interpretMove(PLAY_INTERP.CM_ORDER);
		}
	}

	Basics.onDiscard(game, action);

	const { interp } = check_transfer(game, action);
	if (interp !== DISCARD_INTERP.NONE) {
		resolve_discard(game, action, interp);
		return;
	}

	// End early game?
	if (state.early_game && !action.failed && !state.deck[order].clued) {
		logger.warn('ending early game from discard of', logCard(state.deck[order]));
		state.early_game = false;
	}

	const thoughts = common.thoughts[order];

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!thoughts.rewinded && playerIndex === state.ourPlayerIndex && (failed || (!state.hasConsistentInferences(thoughts) && !isTrash(state, me, state.deck[order], order)))) {
		logger.info('all inferences', thoughts.inferred.map(logCard));

		const action_index = state.deck[order].drawn_index;
		const new_game = game.rewind(action_index, [{ type: 'identify', order, playerIndex, identities: [{ suitIndex, rank }] }], thoughts.finessed);
		if (new_game) {
			new_game.updateNotes();
			Object.assign(game, new_game);
			return;
		}
	}

	// Discarding a useful card
	// Note: we aren't including chop moved and finessed cards here since those can be asymmetric.
	// Discarding with a finesse will trigger the waiting connection to resolve.
	if (rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex] && !state.hands.flat().some(o => common.thoughts[o].matches(identity, { infer: true }))) {
		if (state.deck[order].clued) {
			logger.warn('discarded useful clued card!');
			common.restore_elim(state.deck[order]);

			// Card was bombed
			if (failed) {
				undo_hypo_stacks(game, identity);
			}
			else {
				/** @type {typeof DISCARD_INTERP[keyof typeof DISCARD_INTERP]} */
				let interp = DISCARD_INTERP.SARCASTIC;
				let transferred = interpret_sarcastic(game, action).length > 0;

				if (!transferred && game.level >= LEVEL.SPECIAL_DISCARDS) {
					if (state.isPlayable(identity)) {
						transferred = interpret_gd(game, action, common.find_finesse.bind(common)).length > 0;
						interp = DISCARD_INTERP.GENTLEMANS;
					}
					else {
						transferred = interpret_baton(game, action, (state, index) => [common.find_finesse(state, index)].filter(c => c !== undefined)).length > 0;
						interp = DISCARD_INTERP.BATON;
					}
				}

				if (transferred) {
					logger.info('interpreted', interp);
					resolve_discard(game, action, interp);
					return;
				}
			}
		}

		if (game.level >= LEVEL.STALLING) {
			// If there is only one of this card left and it could be in the next player's chop,
			// they are to be treated as in double discard avoidance.
			const chop = common.chop(state.hands[state.nextPlayerIndex(playerIndex)]);

			if (state.isCritical({ suitIndex, rank }) && common.thoughts[chop]?.possible.has(state.deck[order].identity()))
				state.dda = state.deck[order].identity();
		}
	}

	if (game.level >= LEVEL.LAST_RESORTS && !action.failed && !state.inEndgame()) {
		let interp = check_sdcm(game, action, before_trash, old_chop);

		if (interp !== undefined) {
			const nextPlayerIndex = state.nextPlayerIndex(playerIndex);
			const chop = common.chop(state.hands[nextPlayerIndex]);

			if (interp === DISCARD_INTERP.SCREAM || interp === DISCARD_INTERP.SHOUT) {
				state.screamed_at = true;

				if (chop === undefined) {
					logger.warn(`${state.playerNames[nextPlayerIndex]} has no chop!`);
					interp = DISCARD_INTERP.NONE;
				}
				else {
					logger.info(`interpreting ${interp}!`);
					common.updateThoughts(chop, (draft) => { draft.chop_moved = true; });
				}
			}
			else if (interp === DISCARD_INTERP.GENERATION) {
				logger.info(`interpreting ${interp}!`);
				state.generated = true;
			}

			resolve_discard(game, action, interp);
			return;
		}
	}

	if (!state.screamed_at && !state.generated && game.level >= LEVEL.ENDGAME && state.inEndgame()) {
		const targets = check_positional_discard(game, action, before_trash, old_chop, slot);

		if (targets.length > 0) {
			const playable_possibilities = game.players[playerIndex].hypo_stacks
				.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }))
				.filter(id => !isTrash(state, common, id, -1, { infer: true }) && !state.hands[playerIndex].some(o => ((card = state.deck[o]) =>
					!state.isBasicTrash(card) && card.playedBefore(id))()));		// Disallow selfish pos discards

			/** @type {Connection[]} */
			const connections = [];

			for (const r of targets) {
				const order = state.hands[r][slot - 1];
				common.updateThoughts(order, (draft) => {
					draft.finessed = true;
					draft.focused = true;
					draft.old_inferred = draft.inferred;
					draft.inferred = common.thoughts[order].inferred.intersect(playable_possibilities);
				});

				logger.info('interpreting pos on', state.playerNames[r], 'slot', slot);
				connections.push({ type: 'positional', reacting: r, order, identities: common.thoughts[order].inferred.array });
			}

			const actual_card = state.deck[connections.at(-1).order];

			common.waiting_connections.push({
				connections,
				giver: playerIndex,
				target: targets.at(-1),
				conn_index: 0,
				turn: state.turn_count,
				focus: connections.at(-1).order,
				inference: actual_card.raw(),
				action_index: state.actionList.length - 1
			});

			resolve_discard(game, action, failed ? DISCARD_INTERP.POS_MISPLAY : DISCARD_INTERP.POS_DISCARD);
			return;
		}
	}
	resolve_discard(game, action, DISCARD_INTERP.NONE);
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {number[]} before_trash
 * @param {number} old_chop
 * @param {number} slot
 * @returns {number[]} The player indices that are called to play.
 */
function check_positional_discard(game, action, before_trash, old_chop, slot) {
	const { common, state, me } = game;
	const { order, playerIndex } = action;
	const card = common.thoughts[order];
	const expected_discard = before_trash[0] ?? old_chop;

	// Locked hand, blind played a chop moved card that could be good, discarded expected card
	const not_intended = expected_discard === undefined || (action.failed ?
		(card.chop_moved && card.old_possible?.some(i => !state.isBasicTrash(i)) && card.old_possible?.some(i => state.isPlayable(i))) :
		order === expected_discard);

	if (not_intended)
		return [];

	logger.debug('expected discard', expected_discard);

	const num_plays = (action.failed && order !== expected_discard) ? 2 : 1;

	const playable_possibilities = game.players[playerIndex].hypo_stacks
		.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }))
		.filter(id => !isTrash(state, common, id, -1, { infer: true }));

	const reacting = [];

	for (let i = 1; i < state.numPlayers; i++) {
		const index = (playerIndex + i) % state.numPlayers;
		const target_order = state.hands[index][slot - 1];

		if (target_order === undefined || index === state.ourPlayerIndex || game.next_ignore[0]?.some(({ order }) => order === target_order))
			continue;

		// Find the latest player with an unknown playable
		if (playable_possibilities.some(i => state.deck[target_order].matches(i)) && !common.thinksPlayables(state, index).includes(target_order))
			reacting.push(index);
	}

	// If we haven't found a target, check if we can be the target.
	if (reacting.length < num_plays && playerIndex !== state.ourPlayerIndex) {
		if (state.ourHand.length >= slot &&
			me.thoughts[state.ourHand[slot - 1]].inferred.some(i => playable_possibilities.some(p => i.matches(p)))
		)
			reacting.push(state.ourPlayerIndex);

		if (reacting.length !== num_plays) {
			logger.warn(`weird discard detected, but not enough positional discard targets! (found [${reacting}], need ${num_plays})`);
			return [];
		}
	}

	// Only take the last N reacting players.
	return reacting.slice(-num_plays);
}

/**
 * @param {Game} game
 * @param {DiscardAction} action
 * @param {number[]} before_trash
 * @param {number} old_chop
 */
function check_sdcm(game, action, before_trash, old_chop) {
	const { common, state } = game;
	const { order, playerIndex, suitIndex, rank } = action;
	const nextPlayerIndex = state.nextPlayerIndex(playerIndex);
	const nextPlayerIndex2 = state.nextPlayerIndex(nextPlayerIndex);

	const { NONE, SCREAM, SHOUT, GENERATION } = DISCARD_INTERP;

	// Forced discard for locked hand
	if (common.thinksLocked(state, nextPlayerIndex) && state.clue_tokens === 1)
		return NONE;

	const valid_1clue_scream = () => {
		const nextChop = common.chop(state.hands[nextPlayerIndex]);
		if (state.clue_tokens !== 2 || nextChop === undefined)
			return false;

		const screamed_player = game.players[nextPlayerIndex].withThoughts(nextChop, (draft) => { draft.chop_moved = true; });
		return screamed_player.thinksLocked(state, nextPlayerIndex);
	};

	const scream = (state.clue_tokens === 1 || valid_1clue_scream()) && old_chop !== undefined &&
		(common.thinksPlayables(state, playerIndex).length > 0 || before_trash.length > 0) && order === old_chop;

	const shout = common.thinksPlayables(state, playerIndex).length > 0 &&
		before_trash.includes(order) &&
		isTrash(state, common, { suitIndex, rank }, order, { infer: true });

	const res = scream ? SCREAM : SHOUT;

	if (!scream && !shout)
		return NONE;

	if (state.numPlayers === 2)
		return res;

	if (common.thinksLoaded(state, nextPlayerIndex)) {
		logger.warn(`${state.playerNames[playerIndex]} discarded with a playable/kt at 0 clues but next player was safe! (echo?)`);
		return GENERATION;
	}

	const next2Chop = common.chop(state.hands[nextPlayerIndex2]);

	if (next2Chop === undefined)
		return res;

	if (nextPlayerIndex2 === state.ourPlayerIndex || common.thinksLoaded(state, nextPlayerIndex2))
		return res;

	return (common.chopValue(state, nextPlayerIndex2) < 4) ? res : GENERATION;
}
