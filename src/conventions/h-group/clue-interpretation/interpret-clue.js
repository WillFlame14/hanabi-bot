import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { interpret_tcm, interpret_5cm, interpret_tccm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus, rankLooksPlayable } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';
import { assign_connections, inference_known, inference_rank, find_symmetric_connections, generate_symmetric_connections } from './connection-helper.js';
import { team_elim, checkFix, reset_superpositions } from '../../../basics/helper.js';
import { isTrash } from '../../../basics/hanabi-util.js';
import * as Basics from '../../../basics.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnections, logHand } from '../../../tools/log.js';

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
 * @returns {{fix?: boolean, layered_reveal?: boolean}} Possible results of the clue.
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
				try {
					if (game.rewind(action_index, { type: 'finesse', list, clue: action.clue }))
						return { layered_reveal: true };
				}
				catch (error) {
					// Rewinding the layered finesse doesn't work, just ignore us then.
					logger.warn(error.message);
					if (game.rewind(action_index, { type: 'ignore', order, conn_index: 0 }))
						return { layered_reveal: true };
				}
			}
		}
	}

	return { fix: checkFix(game, oldThoughts, action) };
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

		game.interpretMove(interp);

		// Don't assign save connections or known false connections
		if (save || !focused_card.matches(inference, { assume: true }))
			continue;

		assign_connections(game, connections, giver);

		// Multiple possible sets, we need to wait for connections
		if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type)))
			common.waiting_connections.push({ connections, conn_index: 0, focused_card, inference, giver, target, action_index: state.actionList.length - 1 });
	}

	const correct_match = inf_possibilities.find(p => focused_card.matches(p));

	if (!inference_known(inf_possibilities) && target !== state.ourPlayerIndex && !correct_match.save) {
		const selfRanks = Array.from(new Set(inf_possibilities.flatMap(({ connections }) =>
			connections.filter(conn => conn.type === 'finesse' && conn.reacting === target && conn.identities.length === 1
			).map(conn => conn.identities[0].rank))
		));
		const ownBlindPlays = correct_match.connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length;
		const symmetric_fps = find_symmetric_connections(old_game, action, inf_possibilities.some(fp => fp.save), selfRanks, ownBlindPlays);
		const symmetric_connections = generate_symmetric_connections(state, symmetric_fps, inf_possibilities, focused_card, giver, target);

		for (const focus_possibility of symmetric_fps) {
			const { connections } = focus_possibility;

			for (const conn of connections) {
				if (conn.type === 'playable' && conn.linked.length > 1) {
					const orders = Array.from(conn.linked.map(c => c.order));
					const existing_link = common.play_links.find(pl => Utils.setEquals(new Set(pl.orders), new Set(orders)));

					logger.info('adding play link with orders', orders, 'prereq', logCard(conn.identities[0]), 'connected', logCard(focused_card));

					if (existing_link !== undefined)
						existing_link.prereqs.push(conn.identities[0]);
					else
						common.play_links.push({ orders, prereqs: [conn.identities[0]], connected: focused_card.order });
				}
			}
		}

		common.waiting_connections = common.waiting_connections.concat(symmetric_connections);
		focus_thoughts.inferred = focus_thoughts.inferred.union(old_inferred.filter(inf => symmetric_fps.some(c => inf.matches(c))));
	}
	reset_superpositions(game);
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

	const { clue, giver, list, target, mistake = false, ignoreStall = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list, { beforeClue: true });

	const focus_thoughts = game.players[target].thoughts[focused_card.order];
	focus_thoughts.focused = true;

	const { fix, layered_reveal } = apply_good_touch(game, action);

	// Rewind occurred, this action will be completed as a result of it
	if (layered_reveal)
		return;

	if (chop)
		focus_thoughts.chop_when_first_clued = true;

	if (focus_thoughts.inferred.length === 0 && oldCommon.thoughts[focused_card.order].possible.length > 1) {
		focus_thoughts.inferred = focus_thoughts.possible;
		logger.warn(`focus had no inferences after applying good touch (previously ${oldCommon.thoughts[focused_card.order].inferred.map(logCard).join()})`);

		// There is a waiting connection that depends on this card
		if (focus_thoughts.possible.length === 1 && common.waiting_connections.some(wc =>
			wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === focused_card.order))
		) {
			const { suitIndex, rank } = focus_thoughts.possible.array[0];
			game.rewind(focused_card.drawn_index, { type: 'identify', order: focused_card.order, playerIndex: target, suitIndex, rank });
			return;
		}
	}

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
	if (!ignoreStall) {
		const stall = stalling_situation(game, action, prev_game);

		if (stall !== undefined) {
			logger.info('stalling situation', stall);

			common.update_hypo_stacks(state);
			game.moveHistory.push({ turn: state.turn_count, move: stall });
			return;
		}
	}

	// Check for chop moves at level 4+
	if (game.level >= LEVEL.BASIC_CM) {
		// Trash chop move
		if (interpret_tcm(game, target, focused_card.order)) {
			game.interpretMove(CLUE_INTERP.CM_TRASH);
			return;
		}

		// 5's chop move
		if (interpret_5cm(game, target, focused_card.order, clue)) {
			game.interpretMove(CLUE_INTERP.CM_5);
			return;
		}
	}

	const focus_possible = find_focus_possible(game, action);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save }) => logCard({suitIndex, rank}) + (save ? ' (save)' : '')));

	const matched_inferences = focus_possible.filter(p => focus_thoughts.inferred.has(p));
	const old_game = game.minimalCopy();

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_inferences.find(p => focused_card.matches(p))) {
		focus_thoughts.inferred = focus_thoughts.inferred.intersect(focus_possible);

		resolve_clue(game, old_game, action, matched_inferences, focused_card);
	}
	// Card doesn't match any inferences (or we don't know the card)
	else {
		if (target !== state.ourPlayerIndex || matched_inferences.length === 0)
			logger.info(`card ${logCard(focused_card)} order ${focused_card.order} doesn't match any inferences! currently ${focus_thoughts.inferred.map(logCard).join(',')}`);

		/** @type {FocusPossibility[]} */
		const all_connections = [];

		const looksDirect = focus_thoughts.identity() === undefined && (	// Focused card must be unknown AND
			action.clue.type === CLUE.COLOUR ||											// Colour clue always looks direct
			rankLooksPlayable(game, action.clue.value, giver, target, focused_card.order) ||			// Looks like a play
			focus_possible.some(fp => fp.save));										// Looks like a save

		// We are the clue target, so we need to consider all the (sensible) possibilities of the card
		if (target === state.ourPlayerIndex) {
			for (const fp of matched_inferences) {
				if (!isTrash(state, game.players[giver], fp, focused_card.order, { ignoreCM: true }))
					all_connections.push(fp);
			}

			/** @type {FocusPossibility[]} */
			let self_connections = [];
			let min_blind_plays = Math.min(...all_connections.map(fp => fp.connections.filter(conn => conn.type === 'finesse').length),
				state.hands[state.ourPlayerIndex].length + 1);
			let self = all_connections.every(fp => fp.connections[0]?.self);

			for (const id of focus_thoughts.inferred) {
				if (isTrash(state, game.players[giver], id, focused_card.order, { ignoreCM: true }))
					continue;

				// Focus possibility, skip
				if (all_connections.some(fp => id.matches(fp)))
					continue;

				try {
					const connections = find_own_finesses(game, action, id, looksDirect);
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('found connections:', logConnections(connections, id));

					const focus_poss = { connections, suitIndex: id.suitIndex, rank: inference_rank(state, id.suitIndex, connections), interp: CLUE_INTERP.PLAY };

					// Skipping knowns/playables, starts with self-finesse or self-prompt
					if (connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.self) {
						// If a connection with no self-component exists, don't consider any connection with a self-component
						if (!self)
							continue;

						if (blind_plays < min_blind_plays) {
							self_connections = [];
							min_blind_plays = blind_plays;
						}

						self_connections.push(focus_poss);
					}
					// Doesn't start with self
					else {
						self = false;
						all_connections.push(focus_poss);
					}
				}
				catch (error) {
					if (error instanceof IllegalInterpretation)
						logger.warn(error.message);
					else
						throw error;
				}
			}

			if (self && self_connections.length > 0) {
				for (const connection of self_connections)
					all_connections.push(connection);
			}
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
				else
					throw error;
			}
		}

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

	try {
		logger.debug('hand state after clue', logHand(state.hands[target]));
	}
	catch (err) {
		logger.info('Failed to debug hand state', state.hands[target].map(c => c.order), game.common.thoughts.map(c => c.order));
	}
	team_elim(game);
}
