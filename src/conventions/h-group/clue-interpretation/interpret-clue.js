import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { interpret_tcm, interpret_5cm, interpret_tccm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus, rankLooksPlayable } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';
import { assign_connections, inference_known, inference_rank, find_symmetric_connections, add_symmetric_connections } from './connection-helper.js';
import { update_hypo_stacks, team_elim, checkFix, reset_superpositions } from '../../../basics/helper.js';
import { isBasicTrash, isTrash, playableAway } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import * as Basics from '../../../basics.js';
import { logCard, logConnections, logHand } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 * @typedef {import('../../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Given a clue, recursively applies good touch principle to the target's hand.
 * @param {State} state
 * @param {ClueAction} action
 * @returns {{fix?: boolean, layered_reveal?: boolean}} Possible results of the clue.
 */
function apply_good_touch(state, action) {
	const { common } = state;
	const { list, target } = action;
	const { thoughts: oldThoughts } = common.clone();		// Keep track of all cards that previously had inferences (i.e. not known trash)

	Basics.onClue(state, action);

	// Check if a layered finesse was revealed on us
	if (target === state.ourPlayerIndex) {
		for (const { order } of state.hands[target]) {
			const card = common.thoughts[order];

			if (card.finessed && oldThoughts[order].inferred.length >= 1 && card.inferred.length === 0) {
				// TODO: Possibly try rewinding older reasoning until rewind works?
				const action_index = list.includes(order) ? card.reasoning.at(-2) : card.reasoning.pop();
				try {
					if (state.rewind(action_index, { type: 'finesse', list, clue: action.clue }))
						return { layered_reveal: true };
				}
				catch (error) {
					// Rewinding the layered finesse doesn't work, just ignore us then.
					logger.warn(error.message);
					if (state.rewind(action_index, { type: 'ignore', playerIndex: target, order, conn_index: 0 }))
						return { layered_reveal: true };
				}
			}
		}
	}

	return { fix: checkFix(state, oldThoughts, action) };
}

/**
 * @param {State} state
 * @param {State} old_state
 * @param {ClueAction} action
 * @param {FocusPossibility[]} inf_possibilities
 * @param {ActualCard} focused_card
 */
function resolve_clue(state, old_state, action, inf_possibilities, focused_card) {
	const { common } = state;
	const { giver, target } = action;
	const focus_thoughts = common.thoughts[focused_card.order];
	const old_inferred = old_state.common.thoughts[focused_card.order].inferred;

	focus_thoughts.intersect('inferred', inf_possibilities);

	for (const { connections, suitIndex, rank, save } of inf_possibilities) {
		if (save)
			continue;

		const inference = { suitIndex, rank };
		assign_connections(state, connections);

		// Multiple possible sets, we need to wait for connections
		if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type)))
			common.waiting_connections.push({ connections, conn_index: 0, focused_card, inference, giver, action_index: state.actionList.length - 1 });
	}

	const correct_match = inf_possibilities.find(p => focused_card.matches(p));

	if (!inference_known(inf_possibilities) && target !== state.ourPlayerIndex && !correct_match.save) {
		const selfRanks = Array.from(new Set(inf_possibilities.flatMap(({ connections }) =>
			connections.filter(conn => conn.type === 'finesse' && conn.reacting === target && conn.identities.length === 1
			).map(conn => conn.identities[0].rank))
		));
		const ownBlindPlays = correct_match.connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length;
		const symmetric_connections = find_symmetric_connections(old_state, action, inf_possibilities.some(fp => fp.save), selfRanks, ownBlindPlays);

		add_symmetric_connections(state, symmetric_connections, inf_possibilities, focused_card, giver);
		for (const { fake, connections } of symmetric_connections)
			assign_connections(state, connections, { symmetric: true, target, fake });

		focus_thoughts.union('inferred', old_inferred.filter(inf => symmetric_connections.some(c => !c.fake && c.suitIndex === inf.suitIndex && c.rank === inf.rank)));
	}
	reset_superpositions(state);
}

/**
 * Interprets the given clue. First tries to look for inferred connecting cards, then attempts to find prompts/finesses.
 * @param {State} state
 * @param {ClueAction} action
 */
export function interpret_clue(state, action) {
	const { common } = state;
	const prev_state = state.minimalCopy();
	const oldCommon = common.clone();

	const { clue, giver, list, target, mistake = false, ignoreStall = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], common, list, { beforeClue: true });

	const focus_thoughts = common.thoughts[focused_card.order];
	focus_thoughts.focused = true;

	const { fix, layered_reveal } = apply_good_touch(state, action);

	// Rewind occurred, this action will be completed as a result of it
	if (layered_reveal)
		return;

	if (chop)
		focus_thoughts.chop_when_first_clued = true;

	if (focus_thoughts.inferred.length === 0) {
		focus_thoughts.inferred = focus_thoughts.possible.slice();
		logger.warn(`focus had no inferences after applying good touch (previously ${oldCommon.thoughts[focused_card.order].inferred.map(logCard).join()})`);

		// There is a waiting connection that depends on this card
		if (focus_thoughts.possible.length === 1 && common.waiting_connections.some(wc =>
			wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === focused_card.order))
		) {
			const { suitIndex, rank } = focus_thoughts.possible[0];
			state.rewind(focused_card.drawn_index, { type: 'identify', order: focused_card.order, playerIndex: target, suitIndex, rank });
			return;
		}
	}

	logger.debug('pre-inferences', focus_thoughts.inferred.map(logCard).join());

	if ((state.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focus_thoughts.inferred.length === 1)
			update_hypo_stacks(state, common);

		// Focus doesn't matter for a fix clue
		focus_thoughts.focused = oldCommon.thoughts[focused_card.order].focused;
		return;
	}

	// Check if the giver was in a stalling situation
	if (!ignoreStall && stalling_situation(state, action, prev_state)) {
		logger.info('stalling situation');
		update_hypo_stacks(state, common);
		return;
	}

	// Check for chop moves at level 4+
	if (state.level >= LEVEL.BASIC_CM) {
		// Trash chop move
		if (focused_card.newly_clued &&
			focus_thoughts.possible.every(c => isTrash(state, state.common, c, focused_card.order)) &&
			!(focus_thoughts.inferred.every(c => playableAway(state, c) === 0))
		) {
			interpret_tcm(state, target);
			return;
		}
		// 5's chop move - for now, 5cm cannot be done in early game.
		else if (clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !state.early_game) {
			if (interpret_5cm(state, target))
				return;
		}
	}

	const focus_possible = find_focus_possible(state, action);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save }) => logCard({suitIndex, rank}) + (save ? ' (save)' : '')));

	const matched_inferences = focus_possible.filter(p => focus_thoughts.inferred.some(c => c.matches(p)));
	const old_state = state.minimalCopy();

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_inferences.find(p => focused_card.matches(p))) {
		focus_thoughts.intersect('inferred', focus_possible);

		resolve_clue(state, old_state, action, matched_inferences, focused_card);
	}
	// Card doesn't match any inferences (or we don't know the card)
	else {
		if (target !== state.ourPlayerIndex || matched_inferences.length === 0)
			logger.info(`card ${logCard(focused_card)} order ${focused_card.order} doesn't match any inferences! currently ${focus_thoughts.inferred.map(logCard).join(',')}`);

		/** @type {FocusPossibility[]} */
		const all_connections = [];

		if (target === state.ourPlayerIndex)
			matched_inferences.forEach(fp => all_connections.push(fp));

		const looksDirect = focus_thoughts.identity() === undefined && (	// Focused card must be unknown AND
			action.clue.type === CLUE.COLOUR ||											// Colour clue always looks direct
			rankLooksPlayable(state, action.clue.value, giver, target, focused_card.order) ||			// Looks like a play
			focus_possible.some(fp => fp.save));										// Looks like a save

		if (target === state.ourPlayerIndex) {
			// We are the clue target, so we need to consider all the possibilities of the card
			let conn_save;
			let min_blind_plays = Math.min(...all_connections.map(fp => fp.connections.filter(conn => conn.type === 'finesse').length),
				state.hands[state.ourPlayerIndex].length + 1);
			let self = all_connections.every(fp => fp.connections[0]?.self);

			for (const id of focus_thoughts.inferred) {
				if (isTrash(state, state.players[giver], id, focused_card.order))
					continue;

				// Focus possibility, skip
				if (all_connections.some(fp => id.matches(fp)))
					continue;

				try {
					const connections = find_own_finesses(state, action, id, looksDirect);
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('found connections:', logConnections(connections, id));

					// Skipping knowns/playables, starts with self-finesse or self-prompt
					if (connections.find(conn => conn.type !== 'known' && conn.type !== 'playable')?.self) {
						// TODO: This interpretation should always exist, but must wait for all players to ignore first
						if (self && blind_plays < min_blind_plays) {
							conn_save = { connections, suitIndex: id.suitIndex, rank: inference_rank(state, id.suitIndex, connections) };
							min_blind_plays = blind_plays;
						}
					}
					// Doesn't start with self
					else {
						// Temp: if a connection with no self-component exists, don't consider any connection with a self-component
						self = false;
						all_connections.push({ connections, suitIndex: id.suitIndex, rank: inference_rank(state, id.suitIndex, connections) });
					}
				}
				catch (error) {
					if (error instanceof IllegalInterpretation)
						logger.warn(error.message);
					else
						throw error;
				}
			}

			if (self && conn_save !== undefined)
				all_connections.push(conn_save);

		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!isBasicTrash(state, focused_card)) {
			const { suitIndex } = focused_card;
			try {
				const connections = find_own_finesses(state, action, focused_card, looksDirect);
				logger.info('found connections:', logConnections(connections, focused_card));
				all_connections.push({ connections, suitIndex, rank: inference_rank(state, suitIndex, connections) });
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
				focus_thoughts.intersect('inferred', focus_possible);

				if (focus_thoughts.inferred.length === 0)
					focus_thoughts.inferred = saved_inferences;

				logger.info('no inference on card (other), looks like', focus_thoughts.inferred.map(logCard).join(','));
			}
		}
		else {
			focus_thoughts.inferred = focus_thoughts.possible.slice();
			logger.info('selecting inferences', all_connections.map(conns => logCard(conns)));

			resolve_clue(state, old_state, action, all_connections, focused_card);
		}
	}
	logger.highlight('blue', 'final inference on focused card', focus_thoughts.inferred.map(logCard).join(','));

	state.common.refresh_links(state);
	update_hypo_stacks(state, common);

	if (state.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2)
		interpret_tccm(state, oldCommon, target, list, focused_card);

	logger.debug('hand state after clue', logHand(state.hands[target]));
	team_elim(state);
}
