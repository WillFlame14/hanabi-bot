import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { interpret_tcm, interpret_5cm, interpret_tccm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus, rankLooksPlayable } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { IllegalInterpretation, RewindEscape, find_own_finesses } from './own-finesses.js';
import { assign_connections, inference_rank, find_symmetric_connections, generate_symmetric_connections, occams_razor, connection_score } from './connection-helper.js';
import { team_elim, checkFix, reset_superpositions } from '../../../basics/helper.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import { remove_finesse } from '../update-turn.js';
import * as Basics from '../../../basics.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection, logConnections, logHand } from '../../../tools/log.js';
import { IdentitySet } from '../../../basics/IdentitySet.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/State.js').State} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Given a clue, recursively applies good touch principle to the target's hand.
 * @param {Game} game
 * @param {ClueAction} action
 * @returns {{fix?: boolean, rewinded?: boolean}} Possible results of the clue.
 */
function apply_good_touch(game, action) {
	const { common, state } = game;
	const { list, target } = action;
	const { thoughts: oldThoughts } = common.clone();		// Keep track of all cards that previously had inferences (i.e. not known trash)

	Basics.onClue(game, action);

	// Check if a layered finesse was revealed on us
	if (target === state.ourPlayerIndex) {
		for (const { order } of state.hands[target]) {
			const card = common.thoughts[order];

			if (card.finessed && oldThoughts[order].inferred.length >= 1 && card.inferred.length === 0) {
				// TODO: Possibly try rewinding older reasoning until rewind works?
				const action_index = list.includes(order) ? card.reasoning.at(-2) : card.reasoning.pop();
				const new_game = game.rewind(action_index, { type: 'finesse', list, clue: action.clue }) ??
					game.rewind(action_index, { type: 'ignore', order, conn_index: 0 });		// Rewinding the layered finesse doesn't work, just ignore us then.

				if (new_game) {
					Object.assign(game, new_game);
					Utils.globalModify({ game: new_game });
					return { rewinded: true };
				}
			}
		}
	}

	return checkFix(game, oldThoughts, action);
}

/**
 * @param {Game} game
 * @param {Game} old_game
 * @param {ClueAction} action
 * @param {FocusPossibility[]} inf_possibilities
 * @param {ActualCard} focused_card
 */
function resolve_clue(game, old_game, action, inf_possibilities, focused_card) {
	const { common, state } = game;
	const { giver, target } = action;
	const focus_thoughts = common.thoughts[focused_card.order];
	const old_inferred = old_game.common.thoughts[focused_card.order].inferred;

	focus_thoughts.inferred = focus_thoughts.inferred.intersect(inf_possibilities);

	for (const { connections, suitIndex, rank, save, interp } of inf_possibilities) {
		const inference = { suitIndex, rank };

		// A finesse is considered important if it could only have been given by this player.
		// A finesse must be given before the first finessed player (card indices would shift after)
		// and only by someone who knows or can see all of the cards in the connections.
		if (connections.some(connection => connection.type == 'finesse')) {
			for (let i = (giver + 1) % state.numPlayers; i != giver; i = (i + 1) % state.numPlayers) {
				if (connections.some(connection => connection.type == 'finesse' && connection.reacting == i)) {
					// The clue must be given before the first finessed player,
					// as otherwise the finesse position may change.
					action.important = true;
					break;
				}
				// The target cannot clue themselves.
				if (i == target)
					continue;

				// A player can't give a finesse if they didn't know some card in the finesse.
				if (connections.some(connection => connection.reacting == i && connection.type != 'known'))
					continue;

				// This player could give the finesse, don't mark the action as important.
				break;
			}
		}

		game.interpretMove(interp);

		const matches = focused_card.matches(inference, { assume: true }) && game.players[target].thoughts[focused_card.order].possible.has(inference);
		// Don't assign save connections or known false connections
		if (!save && matches)
			assign_connections(game, connections, giver);

		// Multiple possible sets, we need to wait for connections
		if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
			common.waiting_connections.push({
				connections,
				conn_index: 0,
				focused_card,
				inference,
				giver,
				target,
				action_index: state.actionList.length - 1,
				turn: state.turn_count,
				symmetric: !matches
			});
		}
	}

	const correct_match = inf_possibilities.find(p => focused_card.matches(p));

	if (target !== state.ourPlayerIndex && !correct_match?.save) {
		const selfRanks = Array.from(new Set(inf_possibilities.flatMap(({ connections }) =>
			connections.filter(conn => conn.type === 'finesse' && conn.reacting === target && conn.identities.length === 1
			).map(conn => conn.identities[0].rank))
		));
		const ownBlindPlays = correct_match?.connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length || 0;
		const symmetric_fps = find_symmetric_connections(game, old_game, action, inf_possibilities, selfRanks, ownBlindPlays);
		const symmetric_connections = generate_symmetric_connections(state, symmetric_fps, inf_possibilities, focused_card, giver, target);

		if (correct_match?.connections[0]?.bluff) {
			const { reacting } = correct_match.connections[0];
			const delay_needed = symmetric_fps.filter(fp =>
				fp.connections.length > 0 &&
				fp.connections[0]?.reacting !== reacting &&
				connection_score(fp, reacting) <= connection_score(correct_match, reacting));

			if (delay_needed.length > 0) {
				logger.warn('invalid bluff, symmetrically needs to delay for', delay_needed.map(logCard).join(), 'possibilities');
				game.interpretMove(CLUE_INTERP.NONE);
				return;
			}
		}

		for (const conn of symmetric_fps.concat(inf_possibilities).flatMap(fp => fp.connections)) {
			if (conn.type === 'playable') {
				const orders = Array.from(conn.linked.map(c => c.order));
				const existing_link = common.play_links.find(pl => Utils.setEquals(new Set(pl.orders), new Set(orders)) && pl.connected === focused_card.order);

				logger.info('adding play link with orders', orders, 'prereq', logCard(conn.identities[0]), 'connected', logCard(focused_card));

				if (existing_link !== undefined)
					existing_link.prereqs.push(conn.identities[0]);
				else
					common.play_links.push({ orders, prereqs: [conn.identities[0]], connected: focused_card.order });
			}
		}

		common.waiting_connections = common.waiting_connections.concat(symmetric_connections);
		focus_thoughts.inferred = focus_thoughts.inferred
			.union(old_inferred.filter(inf => symmetric_fps.some(fp => !fp.fake && inf.matches(fp))))
			.intersect(focus_thoughts.possible);
	}
	reset_superpositions(game);
}

/**
 * Finalizes the bluff connections.
 * @param {Game} game
 * @param {number} giver
 * @param {number} target
 * @param {FocusPossibility[]} connections
 * @returns {FocusPossibility[]}
 */
export function finalize_bluff_connections(game, giver, target, connections) {
	const { state } = game;

	const bluff_seat = (giver + 1) % state.numPlayers;
	const no_bluff_connections = connections.some(conn =>
		conn.connections.length > 0 && (
			// If there's a visible connection outside of the bluff seat, expect them to play.
			conn.connections[0].reacting !== bluff_seat && (bluff_seat == state.ourPlayerIndex || target !== state.ourPlayerIndex) ||
			// If there's a non-bluff interpretation playing a different card, it would be simpler than a bluff interpretation
			conn.connections[0].reacting == bluff_seat && !conn.connections[0].bluff && conn.connections[0].type != 'finesse'));

	if (no_bluff_connections) {
		// Convert possible bluff connections to non-bluff connections.
		logger.info('removing bluffs due to visible non-bluff connection');
		return connections.reduce((acc, conn) => {
			if (!conn.connections[0]?.bluff)
				return acc.concat(conn);

			const expected = { suitIndex: conn.suitIndex, rank: conn.rank - conn.connections.filter(c => !c.hidden).length };

			// If not a hidden connection, and we know the bluff card doesn't match, the real card wasn't found.
			if (!conn.connections[0].hidden && !conn.connections[0].card.matches(expected, { assume: true }))
				return acc;

			conn.connections[0].bluff = false;
			return acc.concat(conn);
		}, []);
	}

	const bluff_connections = connections.some(connection =>
		connection.connections.length > 0 && connection.connections[0].bluff);

	let removed = 0;
	// Filter plays after hidden bluff connection,
	const filtered_connections = connections.reduce((acc, conn) => {
		if (!conn.connections[0]?.bluff || !conn.connections[0].hidden) {
			// A non-bluff connection is invalid if it requires a self finesse after a potential bluff play.
			// E.g. if we could be bluffed for a 3 in one suit, we can't assume we have the connecting 2 in another suit.
			if (bluff_connections && conn.connections[1]?.type == 'finesse' && conn.connections[1]?.self) {
				removed++;
				return acc;
			}
			return acc.concat(conn);
		}
		// Remove everything after the bluff play to the non-hidden play as they won't
		// play after the bluff play.
		const next_visible_connection = conn.connections.findIndex(c => !c.bluff && !c.hidden);
		conn.connections.splice(1, next_visible_connection);

		return acc.concat(conn);
	}, []);

	if (removed)
		logger.info(`Removing ${removed} self finesses due to possible bluff interpretation`);

	return filtered_connections;
}

/**
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} focused_order
 * @param {Player} oldCommon
 */
function urgent_save(game, action, focused_order, oldCommon) {
	const { common, state } = game;
	const { giver, target } = action;
	const old_focus_thoughts = oldCommon.thoughts[focused_order];
	const focus_thoughts = common.thoughts[focused_order];

	if (old_focus_thoughts.saved || !focus_thoughts.saved || common.thinksLoaded(state, target, { assume: false }))
		return false;

	const old_play_stacks = game.state.play_stacks.slice();
	let played = new IdentitySet(state.variant.suits.length, 0);

	/**
	 * @param {number} index
	 * @param {boolean} includeHidden
	 */
	const get_finessed_card = (index, includeHidden) =>
		Utils.maxOn(state.hands[index], ({ order }) => {
			const card = game.common.thoughts[order];

			if (card.finessed && (includeHidden || !card.hidden) && card.inferred.every(id => played.has(id) || state.isPlayable(id)))
				return -card.finesse_index;

			return -10000;
		}, -9999);

	// If there is at least one player without a finessed play between the giver and target, the save was not urgent.
	let urgent = true;
	let playerIndex = giver;

	while (playerIndex !== target) {
		const finessed_play = get_finessed_card(playerIndex, false);
		if (!finessed_play) {
			urgent = false;
			break;
		}

		// If we know what the card is, update the play stacks. If we don't, then
		// we can't know if playing it would make someone else's cards playable.
		const card = game.common.thoughts[get_finessed_card(playerIndex, true).order].identity({ infer: true });
		if (card !== undefined) {
			played = played.union(card);
			state.play_stacks[card.suitIndex]++;
		}
		playerIndex = (playerIndex + 1) % state.numPlayers;
	}
	game.state.play_stacks = old_play_stacks;
	return urgent;
}

/**
 * Interprets the given clue. First tries to look for inferred connecting cards, then attempts to find prompts/finesses.
 * @param {Game} game
 * @param {ClueAction} action
 */
export function interpret_clue(game, action) {
	const { common, state } = game;
	const prev_game = game.minimalCopy();
	const oldCommon = common.clone();

	const { clue, giver, list, target, mistake = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list, { beforeClue: true });

	const focus_thoughts = common.thoughts[focused_card.order];
	focus_thoughts.focused = true;

	const { fix, rewinded } = apply_good_touch(game, action);

	// Rewind occurred, this action will be completed as a result of it
	if (rewinded)
		return;

	if (chop) {
		focus_thoughts.chop_when_first_clued = true;
		action.important = urgent_save(game, action, focused_card.order, oldCommon);
	}

	if (focus_thoughts.inferred.length === 0 && oldCommon.thoughts[focused_card.order].possible.length > 1) {
		focus_thoughts.inferred = focus_thoughts.possible;
		logger.warn(`focus had no inferences after applying good touch (previously ${oldCommon.thoughts[focused_card.order].inferred.map(logCard).join()})`);

		// There is a waiting connection that depends on this card
		if (focus_thoughts.possible.length === 1 && common.dependentConnections(focused_card.order).length > 0) {
			const new_game = game.rewind(focused_card.drawn_index, { type: 'identify', order: focused_card.order, playerIndex: target, identities: [focus_thoughts.possible.array[0].raw()] });
			if (new_game) {
				Object.assign(game, new_game);
				Utils.globalModify({ game: new_game });
				return;
			}
		}
	}

	const to_remove = new Set();

	for (const [i, waiting_connection] of Object.entries(common.waiting_connections)) {
		const { connections, conn_index, focused_card: wc_focus, inference, target: wc_target } = waiting_connection;

		const impossible_conn = connections.find((conn, index) => {
			const { reacting, card, identities } = conn;
			const current_card = common.thoughts[card.order];

			// No intersection between connection's identities and current card's possibilities
			if (current_card.possible.intersect(identities).value === 0)
				return true;

			const last_reacting_action = game.last_actions[reacting];

			return index >= conn_index &&
				last_reacting_action?.type === 'play' &&
				last_reacting_action?.card.order === card.order &&
				!identities.some(id => last_reacting_action.card.matches(id));
		});

		if (impossible_conn !== undefined)
			logger.warn(`connection [${connections.map(logConnection)}] depends on revealed card having identities ${impossible_conn.identities.map(logCard)}`);

		else if (!common.thoughts[wc_focus.order].possible.has(inference))
			logger.warn(`connection [${connections.map(logConnection)}] depends on focused card having identity ${logCard(inference)}`);

		else
			continue;

		const rewind_card = impossible_conn?.card ?? wc_focus;
		const rewind_identity = common.thoughts[rewind_card.order]?.identity();

		if (rewind_identity !== undefined && !common.thoughts[rewind_card.order].rewinded && wc_target === state.ourPlayerIndex && state.hands[state.ourPlayerIndex].findOrder(rewind_card.order)) {
			const new_game = game.rewind(rewind_card.drawn_index, { type: 'identify', order: rewind_card.order, playerIndex: state.ourPlayerIndex, identities: [rewind_identity.raw()] });
			if (new_game) {
				Object.assign(game, new_game);
				Utils.globalModify({ game: new_game });
				return;
			}
		}

		to_remove.add(i);
		remove_finesse(game, waiting_connection);
	}

	common.waiting_connections = common.waiting_connections.filter((_, i) => !to_remove.has(i));

	logger.debug('pre-inferences', focus_thoughts.inferred.map(logCard).join());

	if ((game.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focus_thoughts.inferred.length === 1)
			common.update_hypo_stacks(state);

		// Focus doesn't matter for a fix clue
		focus_thoughts.focused = oldCommon.thoughts[focused_card.order].focused;
		game.moveHistory.push({ turn: state.turn_count, move: CLUE_INTERP.FIX });
		return;
	}

	// Check if the giver was in a stalling situation
	const stall = stalling_situation(game, action, prev_game);

	if (stall !== undefined) {
		logger.info('stalling situation', stall);

		if (stall === CLUE_INTERP.STALL_5 && state.early_game)
			game.stalled_5 = true;

		common.update_hypo_stacks(state);
		team_elim(game);
		game.moveHistory.push({ turn: state.turn_count, move: stall });
		return;
	}

	// Check for chop moves at level 4+
	if (game.level >= LEVEL.BASIC_CM) {
		// Trash chop move
		if (interpret_tcm(game, target, focused_card.order)) {
			game.interpretMove(CLUE_INTERP.CM_TRASH);
			team_elim(game);
			return;
		}

		// 5's chop move
		if (interpret_5cm(game, target, focused_card.order, clue)) {
			game.interpretMove(CLUE_INTERP.CM_5);
			team_elim(game);
			return;
		}
	}

	let focus_possible = find_focus_possible(game, action);
	focus_possible = finalize_bluff_connections(game, giver, target, focus_possible);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save }) => logCard({suitIndex, rank}) + (save ? ' (save)' : '')));

	const matched_inferences = focus_possible.filter(p => focus_thoughts.inferred.has(p));
	const old_game = game.minimalCopy();

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_inferences.find(p => focused_card.matches(p))) {
		if (giver === state.ourPlayerIndex) {
			const simplest_symmetric_connections = occams_razor(game, focus_possible, target, focused_card.order);

			focus_thoughts.inferred = focus_thoughts.inferred.intersect(simplest_symmetric_connections);

			if (!simplest_symmetric_connections.some(fp => focused_card.matches(fp)))
				game.interpretMove(CLUE_INTERP.NONE);
			else
				resolve_clue(game, old_game, action, matched_inferences, focused_card);
		}
		else {
			focus_thoughts.inferred = focus_thoughts.inferred.intersect(focus_possible);
			resolve_clue(game, old_game, action, matched_inferences, focused_card);
		}
	}
	else if (action.hypothetical) {
		game.interpretMove(CLUE_INTERP.NONE);
	}
	// Card doesn't match any inferences (or we don't know the card)
	else {
		if (target !== state.ourPlayerIndex || matched_inferences.length === 0)
			logger.info(`card ${logCard(focused_card)} order ${focused_card.order} doesn't match any inferences! currently ${focus_thoughts.inferred.map(logCard).join(',')}`);

		/** @type {FocusPossibility[]} */
		let all_connections = [];

		const looksDirect = focus_thoughts.identity() === undefined && (	// Focused card must be unknown AND
			action.clue.type === CLUE.COLOUR ||											// Colour clue always looks direct
			rankLooksPlayable(game, action.clue.value, giver, target, focused_card.order) ||			// Looks like a play
			focus_possible.some(fp => fp.save && game.players[target].thoughts[focused_card.order].possible.has(fp)));										// Looks like a save

		// We are the clue target, so we need to consider all the (sensible) possibilities of the card
		if (target === state.ourPlayerIndex) {
			for (const fp of matched_inferences) {
				if (!isTrash(state, game.players[giver], fp, focused_card.order, { ignoreCM: true }))
					all_connections.push(fp);
			}

			for (const id of focus_thoughts.inferred) {
				if (isTrash(state, game.players[giver], id, focused_card.order, { ignoreCM: true }))
					continue;

				// Focus possibility, skip
				if (all_connections.some(fp => id.matches(fp)))
					continue;

				try {
					const connections = find_own_finesses(game, action, id, looksDirect);
					logger.info('found connections:', logConnections(connections, id));

					all_connections.push({ connections, suitIndex: id.suitIndex, rank: inference_rank(state, id.suitIndex, connections), interp: CLUE_INTERP.PLAY });
				}
				catch (error) {
					if (error instanceof IllegalInterpretation)
						logger.warn(error.message);
					else if (error instanceof RewindEscape)
						return;
					else
						throw error;
				}
			}

			all_connections = occams_razor(game, all_connections, state.ourPlayerIndex, focused_card.order);
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!state.isBasicTrash(focused_card)) {
			const { suitIndex } = focused_card;
			try {
				const connections = find_own_finesses(game, action, focused_card, looksDirect);
				logger.info('found connections:', logConnections(connections, focused_card));
				all_connections.push({ connections, suitIndex, rank: inference_rank(state, suitIndex, connections), interp: CLUE_INTERP.PLAY });
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					logger.warn(error.message);
				else if (error instanceof RewindEscape)
					return;
				else
					throw error;
			}
		}

		all_connections = finalize_bluff_connections(game, giver, target, all_connections);

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			focus_thoughts.reset = true;
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focus_thoughts.inferred.map(logCard));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focus_thoughts.inferred;
				focus_thoughts.inferred = focus_thoughts.inferred.intersect(focus_possible);

				if (focus_thoughts.inferred.length === 0)
					focus_thoughts.inferred = saved_inferences;

				logger.info('no inference on card (other), looks like', focus_thoughts.inferred.map(logCard).join(','));
			}
			game.interpretMove(CLUE_INTERP.NONE);
		}
		else {
			focus_thoughts.inferred = focus_thoughts.possible;
			logger.info('selecting inferences', all_connections.map(conns => logCard(conns)));

			resolve_clue(game, old_game, action, all_connections, focused_card);
		}
	}
	logger.highlight('blue', 'final inference on focused card', focus_thoughts.inferred.map(logCard).join(','));

	common.refresh_links(state);
	common.update_hypo_stacks(state);

	if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2)
		interpret_tccm(game, oldCommon, target, list, focused_card);

	// Advance connections if a speed-up clue was given
	for (const wc of common.dependentConnections(focused_card.order)) {
		let index = wc.connections.findIndex(conn => conn.card.order === focused_card.order) - 1;
		let modified = false;

		while (wc.connections[index]?.hidden && index >= wc.conn_index) {
			wc.connections.splice(index, 1);
			index--;
			modified = true;
		}

		if (modified)
			logger.info(`advanced waiting connection due to speed-up clue: [${wc.connections.map(logConnection).join(' -> ')}]`);
	}

	try {
		logger.debug('hand state after clue', logHand(state.hands[target]));
	}
	catch (err) {
		logger.info('Failed to debug hand state', state.hands[target].map(c => c.order), game.common.thoughts.map(c => c.order));
	}
	team_elim(game);
}
