import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { interpret_tcm, interpret_5cm, interpret_tccm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus, rankLooksPlayable } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { find_own_finesses } from './connecting-cards.js';
import { assign_connections, inference_known, inference_rank, find_symmetric_connections, add_symmetric_connections } from './connection-helper.js';
import { update_hypo_stacks, team_elim } from '../../../basics/helper.js';
import { isBasicTrash, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import * as Basics from '../../../basics.js';
import { logCard, logConnection, logConnections, logHand } from '../../../tools/log.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../h-player.js').HGroup_Player} Player
 * @typedef {import('../../../basics/Card.js').Card} Card
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
	const { giver, list, target } = action;
	const { thoughts: oldThoughts } = common.clone();		// Keep track of all cards that previously had inferences (i.e. not known trash)

	/** @type {(order: number, options?: { min: number }) => boolean} */
	const hadInferences = (order, { min = 1 }) => oldThoughts[order].inferred.length >= min;

	Basics.onClue(state, action);
	const resets = common.good_touch_elim(state);

	// Check if a layered finesse was revealed on us
	if (target === state.ourPlayerIndex) {
		for (const { order } of state.hands[target]) {
			const card = common.thoughts[order];

			if (card.finessed && hadInferences(order) && card.inferred.length === 0) {
				// TODO: Possibly try rewinding older reasoning until rewind works?
				const action_index = list.includes(order) ? card.reasoning.at(-2) : card.reasoning.pop();
				if (state.rewind(action_index, { type: 'finesse', list, clue: action.clue })) {
					return { layered_reveal: true };
				}
			}
		}
	}

	// One of the clued cards lost all inferences
	const clued_reset = list.some(order => resets.includes(order) && !state.hands[target].findOrder(order).newly_clued);

	const duplicate_reveal = state.hands[target].some(({ order }) => {
		const card = common.thoughts[order];

		// The fix can be in anyone's hand except the giver's
		return state.common.thoughts[order].identity() !== undefined &&
			visibleFind(state, common, card.identity(), { ignore: [giver], infer: true }).some(c => common.thoughts[c.order].touched && c.order !== order);
	});

	return { fix: clued_reset || duplicate_reveal };
}

/**
 * Resets superposition on all cards.
 * @param {State} state
 */
function reset_superpositions(state) {
	state.hands.forEach(hand => hand.forEach(({ order }) => state.common.thoughts[order].superposition = false));
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
	if (layered_reveal) {
		return;
	}

	if (chop) {
		focus_thoughts.chop_when_first_clued = true;
	}

	if (focus_thoughts.inferred.length === 0) {
		focus_thoughts.inferred = focus_thoughts.possible.slice();
		logger.warn(`focused card had no inferences after applying good touch (previously ${oldCommon.thoughts[focused_card.order].inferred.map(c => logCard(c)).join()})`);

		// There is a waiting connection that depends on this card
		if (focus_thoughts.possible.length === 1 && common.waiting_connections.some(wc =>
			wc.connections.some((conn, index) => index >= wc.conn_index && conn.card.order === focused_card.order))
		) {
			const { suitIndex, rank } = focus_thoughts.possible[0];
			state.rewind(focused_card.drawn_index, { type: 'identify', order: focused_card.order, playerIndex: target, suitIndex, rank });
			return;
		}
	}

	logger.debug('pre-inferences', focus_thoughts.inferred.map(c => logCard(c)).join());

	if ((state.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focus_thoughts.inferred.length === 1) {
			update_hypo_stacks(state, common);
		}

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
			if (interpret_5cm(state, target)) {
				return;
			}
		}
	}

	const focus_possible = find_focus_possible(state, action);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save }) => logCard({suitIndex, rank}) + (save ? ' (save)' : '')));

	const matched_inferences = focus_possible.filter(p => focus_thoughts.inferred.some(c => c.matches(p)));
	const correct_match = matched_inferences.find(p => focused_card.matches(p));
	const matched_correct = target === state.ourPlayerIndex || correct_match !== undefined;

	const old_state = state.minimalCopy();
	const old_inferred = focus_thoughts.inferred.slice();

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_correct) {
		focus_thoughts.intersect('inferred', focus_possible);

		for (const inference of matched_inferences) {
			const { suitIndex, rank, connections, save = false } = inference;

			if (!save) {
				if ((target === state.ourPlayerIndex || focused_card.matches(inference))) {
					logger.info('assigning connections', connections.map(c => logConnection(c)));
					assign_connections(state, connections);
				}

				// Multiple inferences, we need to wait for connections
				if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
					common.waiting_connections.push({ connections, conn_index: 0, focused_card, inference: { suitIndex, rank }, giver, action_index: state.actionList.length - 1 });
				}
			}
		}

		// We can update hypo stacks
		if (inference_known(matched_inferences)) {
			team_elim(state);
		}
		else if (target !== state.ourPlayerIndex && !correct_match.save) {
			const selfRanks = Array.from(new Set(matched_inferences.flatMap(({ connections }) =>
				connections.filter(conn =>
					conn.type === 'finesse' && conn.reacting === target && conn.identities.length === 1
				).map(conn => conn.identities[0].rank))
			));
			const ownBlindPlays = correct_match.connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length;
			const symmetric_connections = find_symmetric_connections(old_state, action, focus_possible.some(fp => fp.save), selfRanks, ownBlindPlays);

			add_symmetric_connections(state, symmetric_connections, matched_inferences, focused_card, giver);
			for (const { fake, connections } of symmetric_connections) {
				assign_connections(state, connections, { symmetric: true, target, fake });
			}
			focus_thoughts.union('inferred', old_inferred.filter(inf => symmetric_connections.some(c => !c.fake && c.suitIndex === inf.suitIndex && c.rank === inf.rank)));
		}
		reset_superpositions(state);
	}
	// Card doesn't match any inferences
	else {
		logger.info(`card ${logCard(focused_card)} order ${focused_card.order} doesn't match any inferences! currently ${focus_thoughts.inferred.map(c => logCard(c)).join(',')}`);

		/** @type {FocusPossibility[]} */
		const all_connections = [];

		const looksDirect = focus_thoughts.identity() === undefined && (	// Focused card must be unknown AND
			action.clue.type === CLUE.COLOUR ||											// Colour clue always looks direct
			rankLooksPlayable(state, action.clue.value, focused_card.order) ||			// Looks like a play
			focus_possible.some(fp => fp.save));										// Looks like a save

		if (target === state.ourPlayerIndex) {
			// We are the clue target, so we need to consider all the possibilities of the card
			let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;
			let self = true;

			for (const id of focus_thoughts.inferred) {
				if (isBasicTrash(state, id)) {
					continue;
				}

				const { feasible, connections } = find_own_finesses(state, giver, target, id, looksDirect);
				const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
				logger.info('found connections:', logConnections(connections, id));

				if (feasible) {
					// Starts with self-finesse or self-prompt
					if (connections[0]?.self) {
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
			}

			if (self && conn_save !== undefined) {
				all_connections.push(conn_save);
			}
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!isBasicTrash(state, focused_card)) {
			const { suitIndex } = focused_card;
			const { feasible, connections } = find_own_finesses(state, giver, target, focused_card, looksDirect);

			logger.info('found connections:', logConnections(connections, focused_card));

			if (feasible) {
				all_connections.push({ connections, suitIndex, rank: inference_rank(state, suitIndex, connections) });
			}
		}

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			focus_thoughts.reset = true;
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focus_thoughts.inferred.map(c => logCard(c)));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focus_thoughts.inferred;
				focus_thoughts.intersect('inferred', focus_possible);

				if (focus_thoughts.inferred.length === 0) {
					focus_thoughts.inferred = saved_inferences;
				}
				logger.info('no inference on card (other), looks like', focus_thoughts.inferred.map(c => logCard(c)).join(','));
			}
		}
		else {
			focus_thoughts.inferred = [];
			logger.info('selecting inferences', all_connections.map(conns => logCard(conns)));

			for (const { connections, suitIndex, rank } of all_connections) {
				const inference = { suitIndex, rank };
				assign_connections(state, connections);

				// Add inference to focused card
				focus_thoughts.union('inferred', [inference]);

				// Multiple possible sets, we need to wait for connections
				if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
					common.waiting_connections.push({ connections, conn_index: 0, focused_card, inference, giver, action_index: state.actionList.length - 1 });
				}
			}

			const correct_match2 = all_connections.find(p => focused_card.matches(p));

			// Only one set of connections (and without prompt/finesse), so can elim safely
			if (inference_known(all_connections)) {
				team_elim(state);
			}
			else if (target !== state.ourPlayerIndex && !correct_match2.save) {
				const selfRanks = Array.from(new Set(all_connections.flatMap(({ connections }) =>
					connections.filter(conn =>
						conn.type === 'finesse' && conn.reacting === target && conn.identities.length === 1
					).map(conn => conn.identities[0].rank))
				));
				const ownBlindPlays = correct_match2.connections.filter(conn => conn.type === 'finesse' && conn.reacting === state.ourPlayerIndex).length;
				const symmetric_connections = find_symmetric_connections(old_state, action, focus_possible.some(fp => fp.save), selfRanks, ownBlindPlays);

				add_symmetric_connections(state, symmetric_connections, all_connections, focused_card, giver);
				for (const { fake, connections } of symmetric_connections) {
					assign_connections(state, connections, { symmetric: true, target, fake });
				}
				focus_thoughts.union('inferred', old_inferred.filter(inf => symmetric_connections.some(c => !c.fake && c.suitIndex === inf.suitIndex && c.rank === inf.rank)));
			}

			reset_superpositions(state);
		}
	}
	logger.highlight('blue', 'final inference on focused card', focus_thoughts.inferred.map(c => logCard(c)).join(','));

	state.common.refresh_links(state);
	update_hypo_stacks(state, common);

	if (state.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2) {
		interpret_tccm(state, oldCommon, target, list, focused_card);
	}

	logger.debug('hand state after clue', logHand(state.hands[target]));

	for (const player of state.players) {
		for (const { order } of state.hands.flat()) {
			player.thoughts[order].intersect('inferred', state.common.thoughts[order].inferred);
		}

		player.good_touch_elim(state);
	}
}
