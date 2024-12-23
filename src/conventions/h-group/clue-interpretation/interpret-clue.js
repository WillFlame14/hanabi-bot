import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { IdentitySet } from '../../../basics/IdentitySet.js';
import { interpret_tcm, interpret_5cm, interpret_tccm, perform_cm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus, getRealConnects, rankLooksPlayable, unknown_1 } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { IllegalInterpretation, find_own_finesses } from './own-finesses.js';
import { assign_all_connections, inference_rank, find_symmetric_connections, generate_symmetric_connections, occams_razor, connection_score } from './connection-helper.js';
import { variantRegexes } from '../../../variants.js';
import { remove_finesse } from '../update-wcs.js';
import { order_1s } from '../action-helper.js';
import { find_impossible_conn } from '../update-turn.js';
import { team_elim, checkFix, reset_superpositions } from '../../../basics/helper.js';
import { early_game_clue } from '../urgent-actions.js';
import { isTrash, knownAs } from '../../../basics/hanabi-util.js';
import * as Basics from '../../../basics.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection, logConnections, logHand } from '../../../tools/log.js';
import { produce } from '../../../StateProxy.js';

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
 * @typedef {import('../../../types.js').FocusResult} FocusResult
 */

/**
 * Given a clue, recursively applies good touch principle to the target's hand.
 * 
 * Impure!
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Card[]} oldThoughts
 * @returns {{fix?: boolean, rewinded?: boolean}} Possible results of the clue.
 */
function apply_good_touch(game, action, oldThoughts) {
	const { common, state } = game;
	const { list, target } = action;

	Basics.onClue(game, action);

	if (target === state.ourPlayerIndex) {
		for (const order of state.hands[target]) {
			const card = common.thoughts[order];

			// Check if a layered finesse was revealed on us
			if (card.finessed && oldThoughts[order].inferred.length >= 1 && card.inferred.length === 0) {
				// TODO: Possibly try rewinding older reasoning until rewind works?
				const action_index = card.reasoning.at(list.includes(order) ? -2 : -1);
				const new_game = game.rewind(action_index, [{ type: 'finesse', list, clue: action.clue }]) ??
					game.rewind(action_index, [{ type: 'ignore', order, conn_index: 0 }]);		// Rewinding the layered finesse doesn't work, just ignore us then.

				if (new_game) {
					new_game.updateNotes();
					Object.assign(game, new_game);
					return { rewinded: true };
				}
			}

			// Fix incorrect trash labels
			if (card.trash && card.possible.every(p => state.isCritical(p)))
				common.updateThoughts(order, (draft) => { draft.trash = false; });
		}
	}

	return checkFix(game, oldThoughts, action);
}

/**
 * Determines whether a clue was important (by causing a finesse).
 * @param {State} state
 * @param {ClueAction} action
 * @param {FocusPossibility[]} inf_possibilities
 */
function important_finesse(state, action, inf_possibilities) {
	const { giver, target } = action;

	for (const { connections, suitIndex, rank } of inf_possibilities) {
		const inference = { suitIndex, rank };

		// A finesse is considered important if it could only have been given by this player.
		// A finesse must be given before the first finessed player (card indices would shift after)
		// and only by someone who knows or can see all of the cards in the connections.
		if (!connections.some(connection => connection.type == 'finesse'))
			continue;

		for (let i = state.nextPlayerIndex(giver); i != giver; i = state.nextPlayerIndex(i)) {
			if (connections.some(connection => connection.type == 'finesse' && connection.reacting == i)) {
				// The clue must be given before the first finessed player,
				// as otherwise the finesse position may change.
				return true;
			}
			// The target cannot clue themselves.
			if (i == target)
				continue;

			// A player can't give a finesse if they didn't know some card in the finesse.
			if (connections.some(connection => connection.reacting == i && connection.type != 'known'))
				continue;

			// This player could give the finesse, don't mark the action as important.
			logger.info(`${state.playerNames[i]} could give finesse for id ${logCard(inference)}, not important`);
			break;
		}
	}
	return false;
}

/**
 * Updates thoughts after a clue, given the possible interpretations.
 * 
 * Impure!
 * @param {Game} game
 * @param {Game} old_game
 * @param {ClueAction} action
 * @param {FocusResult} focusResult
 * @param {FocusPossibility[]} inf_possibilities
 * @param {ActualCard} focused_card
 */
function resolve_clue(game, old_game, action, focusResult, inf_possibilities, focused_card) {
	const { common, state } = game;
	const { giver, target } = action;
	const focus = focused_card.order;
	const old_inferred = old_game.common.thoughts[focus].inferred;

	common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].inferred.intersect(inf_possibilities); });

	if (important_finesse(state, action, inf_possibilities)) {
		logger.highlight('yellow', 'action is important!');
		action.important = true;
	}

	assign_all_connections(game, inf_possibilities, action, focused_card);

	for (const { connections, suitIndex, rank } of inf_possibilities) {
		const inference = { suitIndex, rank };
		const matches = focused_card.matches(inference, { assume: true }) && game.players[target].thoughts[focus].possible.has(inference);

		// Multiple possible sets, we need to wait for connections
		if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
			common.waiting_connections.push({
				connections,
				conn_index: 0,
				focus,
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
		const symmetric_fps = find_symmetric_connections(old_game, action, focusResult, inf_possibilities, selfRanks, ownBlindPlays);
		const symmetric_connections = generate_symmetric_connections(state, symmetric_fps, inf_possibilities, focus, giver, target);

		if (correct_match?.connections[0]?.bluff) {
			const { reacting } = correct_match.connections[0];
			const delay_needed = symmetric_fps.filter(fp =>
				fp.connections.length > 0 &&
				(fp.connections[0]?.reacting !== reacting || fp.connections[0].type === 'known' || fp.connections[0].type == 'playable') &&
				connection_score(fp, reacting) <= connection_score(correct_match, reacting));

			if (giver === state.ourPlayerIndex && delay_needed.length > 0) {
				logger.warn('invalid bluff, symmetrically needs to delay for potential', delay_needed.map(logCard).join());
				game.interpretMove(CLUE_INTERP.NONE);
				return;
			}
		}

		const simplest_symmetric_connections = occams_razor(game, symmetric_fps.filter(fp => !fp.fake).concat(inf_possibilities), target, focus);
		if (giver === state.ourPlayerIndex && !simplest_symmetric_connections.some(fp => focused_card.matches(fp))) {
			logger.warn(`invalid clue, simplest symmetric connections are ${simplest_symmetric_connections.map(logCard).join()}`);
			game.interpretMove(CLUE_INTERP.NONE);
			return;
		}

		for (const conn of symmetric_fps.concat(inf_possibilities).flatMap(fp => fp.connections)) {
			if (conn.type === 'playable') {
				const existing_link = common.play_links.find(pl => Utils.setEquals(new Set(pl.orders), new Set(conn.linked)) && pl.connected === focus);

				logger.info('adding play link with orders', conn.linked, 'prereq', logCard(conn.identities[0]), 'connected', logCard(focused_card));

				if (existing_link !== undefined)
					existing_link.prereqs.push(conn.identities[0]);
				else
					common.play_links.push({ orders: conn.linked, prereqs: [conn.identities[0]], connected: focus });
			}
		}

		common.waiting_connections = common.waiting_connections.concat(symmetric_connections);
		const new_inferences = common.thoughts[focus].inferred
			.union(old_inferred.filter(inf => symmetric_fps.some(fp => !fp.fake && inf.matches(fp))))
			.intersect(common.thoughts[focus].possible);

		common.updateThoughts(focus, (draft) => { draft.inferred = new_inferences; });
	}

	const interp = inf_possibilities.some(p => p.save) ? CLUE_INTERP.SAVE : CLUE_INTERP.PLAY;
	game.interpretMove(interp);

	// If a save clue was given to the next player after a scream, then the discard was actually for generation.
	if (interp === CLUE_INTERP.SAVE && giver !== state.ourPlayerIndex && target === state.nextPlayerIndex(giver) && state.screamed_at && state.numPlayers > 2) {
		const old_chop = state.hands[giver].find(o => common.thoughts[o].chop_moved);
		common.thoughts.splice(old_chop, 1, produce(common.thoughts[old_chop], (draft) => { draft.chop_moved = false; }));

		logger.highlight('yellow', `undoing scream discard chop move on ${old_chop} due to generation!`);
	}

	common.updateThoughts(focus, (draft) => { draft.info_lock = draft.inferred.clone(); });

	reset_superpositions(game);
}

/**
 * Finalizes the bluff connections.
 * @param {FocusPossibility[]} focus_possibilities
 */
export function finalize_connections(focus_possibilities) {
	const bluff_orders = focus_possibilities.filter(fp => fp.connections[0]?.bluff).flatMap(fp => fp.connections[0].order);

	if (bluff_orders.length === 0)
		return focus_possibilities;

	return focus_possibilities.filter(({ connections }) => {
		const first_conn = connections[0];
		// A non-bluff connection is invalid if it requires a self finesse after a potential bluff play.
		// E.g. if we could be bluffed for a 3 in one suit, we can't assume we have the connecting 2 in another suit.
		const invalid = connections.length >= 2 &&
			first_conn.type === 'finesse' &&
			!first_conn.bluff &&
			bluff_orders.includes(first_conn.order) &&
			connections[1].self;

		if (invalid)
			logger.highlight('green', `removing ${connections.map(logConnection).join(' -> ')} self finesse due to possible bluff interpretation`);

		return !invalid;
	});
}

/**
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} focus
 * @param {Player} oldCommon
 * @param {Game} old_game
 */
function urgent_save(game, action, focus, oldCommon, old_game) {
	const { common, state } = game;
	const { giver, target } = action;
	const old_focus_thoughts = oldCommon.thoughts[focus];
	const focus_thoughts = common.thoughts[focus];

	if (old_focus_thoughts.saved || !focus_thoughts.saved ||
		common.thinksLoaded(state, target, { assume: false }) ||
		(state.early_game && early_game_clue(old_game, target, giver)))
		return false;

	const play_stacks = state.play_stacks.slice();
	let played = new IdentitySet(state.variant.suits.length, 0);

	/**
	 * @param {number} index
	 * @param {boolean} includeHidden
	 */
	const get_finessed_order = (index, includeHidden) =>
		Utils.maxOn(state.hands[index], order => {
			const card = common.thoughts[order];

			if (card.finessed && (includeHidden || !card.hidden) && card.inferred.every(id => played.has(id) || play_stacks[id.suitIndex] + 1 === id.rank))
				return -card.finesse_index;

			return -10000;
		}, -9999);

	// If there is at least one player without a finessed play between the giver and target, the save was not urgent.
	let urgent = true;
	let playerIndex = giver;

	while (playerIndex !== target) {
		const finessed_play = get_finessed_order(playerIndex, false);
		if (!finessed_play) {
			urgent = false;
			break;
		}

		// If we know what the card is, update the play stacks. If we don't, then
		// we can't know if playing it would make someone else's cards playable.
		const card = common.thoughts[get_finessed_order(playerIndex, true)].identity({ infer: true });
		if (card !== undefined) {
			played = played.union(card);
			play_stacks[card.suitIndex]++;
		}
		playerIndex = state.nextPlayerIndex(playerIndex);
	}
	return urgent;
}

/**
 * Returns whether a clue was a distribution clue.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} focus
 */
function distribution_clue(game, action, focus) {
	const { common, state } = game;
	const { list, target } = action;
	const focus_thoughts = common.thoughts[focus];

	if (state.maxScore - state.score > state.variant.suits.length || !state.hands[target].some(o => state.deck[o].newly_clued && list.includes(o)))
		return false;

	const id = focus_thoughts.identity({ infer: true });
	if (id !== undefined && state.isBasicTrash(id))
		return false;

	return focus_thoughts.possible.some(p => !state.isBasicTrash(p) && state.hands.some(hand => {
		let duplicated = false, other_useful = false;
		for (const o of hand) {
			const id = common.thoughts[o].identity({ infer: true });
			if (id === undefined)
				continue;

			if (id.matches(p))
				duplicated = true;
			else if (!state.isBasicTrash(id))
				other_useful = true;
		}
		return duplicated && other_useful;
	}));
}

/**
 * Interprets the given clue. First tries to look for inferred connecting cards, then attempts to find prompts/finesses.
 * 
 * Impure!
 * @param {Game} game
 * @param {ClueAction} action
 */
export function interpret_clue(game, action) {
	const { common, state } = game;
	const prev_game = game.minimalCopy();
	const oldCommon = common.clone();

	const { clue, giver, list, target, mistake = false } = action;

	// Empty clue
	if (list.length === 0) {
		logger.highlight('yellow', 'empty clue!');
		apply_good_touch(game, action, oldCommon.thoughts);

		const to_remove = new Set();

		for (const [i, waiting_connection] of common.waiting_connections.entries()) {
			const { connections, conn_index, focus: wc_focus, inference, target: wc_target, } = waiting_connection;

			// The target of the waiting connection cannot eliminate their own identities
			if (wc_target === giver)
				continue;

			const impossible_conn = find_impossible_conn(game, connections.slice(conn_index));
			if (impossible_conn !== undefined)
				logger.warn(`connection [${connections.map(logConnection)}] depends on revealed card having identities ${impossible_conn.identities.map(logCard)}`);

			else if (!common.thoughts[wc_focus].possible.has(inference))
				logger.warn(`connection [${connections.map(logConnection)}] depends on originally focused card having identity ${logCard(inference)}`);

			else
				continue;

			const rewind_order = impossible_conn?.order ?? wc_focus;
			const rewind_identity = common.thoughts[rewind_order]?.identity();

			if (rewind_identity !== undefined && !common.thoughts[rewind_order].rewinded && wc_target === state.ourPlayerIndex && state.ourHand.includes(rewind_order)) {
				const new_game = game.rewind(state.deck[rewind_order].drawn_index, [{ type: 'identify', order: rewind_order, playerIndex: state.ourPlayerIndex, identities: [rewind_identity.raw()] }]);
				if (new_game) {
					Object.assign(game, new_game);
					return;
				}
			}

			to_remove.add(i);
			remove_finesse(game, waiting_connection);
		}

		common.waiting_connections = common.waiting_connections.filter((_, i) => !to_remove.has(i));
		team_elim(game);
		return;
	}

	const focusResult = determine_focus(game, state.hands[target], common, list, clue);
	const { focus, chop, positional } = focusResult;
	const focused_card = state.deck[focus];

	common.updateThoughts(focus, (draft) => { draft.focused = true; });
	const { fix, rewinded } = apply_good_touch(game, action, oldCommon.thoughts);

	// Rewind occurred, this action will be completed as a result of it
	if (rewinded)
		return;

	if (chop && !action.noRecurse) {
		common.updateThoughts(focus, (draft) => { draft.chop_when_first_clued = true; });
		action.important = urgent_save(game, action, focus, oldCommon, prev_game);
		if (action.important)
			logger.highlight('yellow', 'important save!');
	}

	if (common.thoughts[focus].inferred.length === 0 && oldCommon.thoughts[focus].possible.length > 1) {
		common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].possible; });
		logger.warn(`focus had no inferences after applying good touch (previously ${oldCommon.thoughts[focus].inferred.map(logCard).join()})`);

		// There is a waiting connection that depends on this card
		if (common.thoughts[focus].possible.length === 1 && common.dependentConnections(focus).length > 0) {
			const new_game = game.rewind(state.deck[focus].drawn_index, [{ type: 'identify', order: focus, playerIndex: target, identities: [common.thoughts[focus].possible.array[0].raw()] }]);
			if (new_game) {
				new_game.updateNotes();
				Object.assign(game, new_game);
				return;
			}
		}
	}

	const to_remove = new Set();

	for (const [i, waiting_connection] of common.waiting_connections.entries()) {
		const { connections, conn_index, action_index, focus: wc_focus, inference, target: wc_target, symmetric } = waiting_connection;
		const focus_id = state.deck[focus].identity();

		// The target of the waiting connection cannot eliminate their own identities
		if (wc_target === giver)
			continue;

		if (focus_id !== undefined) {
			const stomped_conn_index = connections.findIndex((conn, index) =>
				index >= conn_index &&
				!(conn.hidden && conn.reacting === giver) &&		// Allow a hidden player to stomp, since they don't know
				conn.identities.every(i => focus_id.suitIndex === i.suitIndex && focus_id.rank === i.rank));
			const stomped_conn = connections[stomped_conn_index];

			if (stomped_conn) {
				logger.warn(`connection [${connections.map(logConnection)}] had connection clued directly, cancelling`);

				if (symmetric) {
					to_remove.add(i);
					continue;
				}

				const real_connects = getRealConnects(connections, stomped_conn_index);
				const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: real_connects, order: stomped_conn.order, inference }]);
				if (new_game) {
					new_game.updateNotes();
					Object.assign(game, new_game);
					return;
				}
			}
		}

		const impossible_conn = find_impossible_conn(game, connections.slice(conn_index));
		if (impossible_conn !== undefined)
			logger.warn(`connection [${connections.map(logConnection)}] depends on revealed card having identities ${impossible_conn.identities.map(logCard)}`);

		else if (!common.thoughts[wc_focus].possible.has(inference))
			logger.warn(`connection [${connections.map(logConnection)}] depends on focused card having identity ${logCard(inference)}`);

		else
			continue;

		const rewind_order = impossible_conn?.order ?? wc_focus;
		const rewind_identity = common.thoughts[rewind_order]?.identity();

		if (rewind_identity !== undefined && !common.thoughts[rewind_order].rewinded && wc_target === state.ourPlayerIndex && state.ourHand.includes(rewind_order)) {
			const new_game = game.rewind(state.deck[rewind_order].drawn_index, [{ type: 'identify', order: rewind_order, playerIndex: state.ourPlayerIndex, identities: [rewind_identity.raw()] }]);
			if (new_game) {
				new_game.updateNotes();
				Object.assign(game, new_game);
				return;
			}
		}

		to_remove.add(i);
		remove_finesse(game, waiting_connection);
	}

	common.waiting_connections = common.waiting_connections.filter((_, i) => !to_remove.has(i));
	team_elim(game);

	logger.debug('pre-inferences', common.thoughts[focus].inferred.map(logCard).join());

	if ((game.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (common.thoughts[focus].inferred.length === 1)
			common.update_hypo_stacks(state);

		// Pink fix clue on 1s
		if (fix && state.includesVariant(variantRegexes.pinkish) && clue.type === CLUE.RANK && clue.value !== 1) {
			const old_1s = list.filter(o => ((c = state.deck[o]) =>
				c.clues.length > 1 && c.clues.slice(0, -1).every(clue => clue.type === CLUE.RANK && clue.value === 1))());
			const old_ordered_1s = order_1s(state, common, old_1s, { no_filter: true });

			// Pink fix promise
			if (old_ordered_1s.length > 0) {
				const order = old_ordered_1s[0];
				const { inferred, possible } = common.thoughts[order];
				if (!(chop && (clue.value === 2 || clue.value === 5))) {
					common.updateThoughts(order, (draft) => { draft.inferred = inferred.intersect(inferred.filter(i => i.rank === clue.value)); });
					logger.info('pink fix promise!', common.thoughts[order].inferred.map(logCard), order);
				}
				else {
					common.updateThoughts(order, (draft) => { draft.inferred = possible.subtract(inferred.filter(i => state.isPlayable(i))); });
					logger.info('pink fix!', common.thoughts[order].inferred.map(logCard), order);
				}
			}
		}

		common.good_touch_elim(state);

		// Focus doesn't matter for a fix clue
		common.updateThoughts(focus, (draft) => { draft.focused = oldCommon.thoughts[focus].focused; });
		game.interpretMove(mistake ? CLUE_INTERP.MISTAKE : CLUE_INTERP.FIX);
		return;
	}

	// Check if the giver was in a stalling situation
	const { stall, thinks_stall } = stalling_situation(game, action, focusResult, prev_game);

	if (thinks_stall.size === state.numPlayers) {
		logger.info('stalling situation', stall);

		if (stall === CLUE_INTERP.STALL_5 && state.early_game)
			game.stalled_5 = true;

		// Pink promise on stalls
		if (state.includesVariant(variantRegexes.pinkish) && clue.type === CLUE.RANK) {
			const { inferred } = common.thoughts[focus];
			common.updateThoughts(focus, (draft) => { draft.inferred = inferred.intersect(inferred.filter(i => i.rank === clue.value)); });
		}

		common.update_hypo_stacks(state);
		team_elim(game);
		game.interpretMove(stall);
		return;
	}
	else if (thinks_stall.size > 0 && giver === state.ourPlayerIndex) {
		// Asymmetric move: prefer not to give such a clue
		game.interpretMove(CLUE_INTERP.NONE);
		return;
	}

	if (distribution_clue(game, action, common.thoughts[focus].order)) {
		const { inferred } = common.thoughts[focus];
		common.updateThoughts(focus, (draft) => {
			draft.inferred = inferred.intersect(inferred.filter(i => !state.isBasicTrash(i)));
			draft.certain_finessed = true;
			draft.reset = false;
		});

		logger.info('distribution clue!');
		game.interpretMove(CLUE_INTERP.DISTRIBUTION);
		team_elim(game);
		return;
	}

	// Check for chop moves at level 4+
	if (game.level >= LEVEL.BASIC_CM && !state.inEndgame()) {
		// Trash chop move
		const tcm_orders = interpret_tcm(game, action, focus);

		if (tcm_orders.length > 0) {
			perform_cm(state, common, tcm_orders);
			common.updateThoughts(focus, (draft) => { draft.trash = true; });

			game.interpretMove(CLUE_INTERP.CM_TRASH);
			team_elim(game);
			return;
		}

		const cm5_orders = interpret_5cm(game, target, focus, clue);

		// 5's chop move
		if (cm5_orders.length > 0) {
			perform_cm(state, common, cm5_orders);
			game.interpretMove(CLUE_INTERP.CM_5);
			team_elim(game);
			return;
		}
	}

	const pink_trash_fix = state.includesVariant(variantRegexes.pinkish) &&
		!positional && clue.type === CLUE.RANK &&
		list.every(o => !state.deck[o].newly_clued && knownAs(game, o, variantRegexes.pinkish)) &&
		state.variant.suits.every((suit, i) =>
			!suit.match(variantRegexes.pinkish) || state.isBasicTrash({ suitIndex: i, rank: clue.value }));

	if (pink_trash_fix) {
		logger.info('pink trash fix!');
		common.updateThoughts(focus, (draft) => {
			draft.inferred = draft.possible.intersect(state.variant.suits.map((_, i) => ({ suitIndex: i, rank: clue.value })));
			draft.trash = true;
		});

		game.interpretMove(CLUE_INTERP.FIX);
		team_elim(game);
		return;
	}

	const focus_possible = find_focus_possible(game, action, focusResult, thinks_stall);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save, illegal }) => logCard({suitIndex, rank}) + (save ? ' (save)' : ''  + (illegal ? ' (illegal)' : ''))));

	const matched_inferences = focus_possible.filter(p => !p.illegal && common.thoughts[focus].inferred.has(p));
	const old_game = game.minimalCopy();

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_inferences.find(p => focused_card.matches(p))) {
		if (giver === state.ourPlayerIndex) {
			const simplest_symmetric_connections = occams_razor(game, focus_possible.filter(p => !p.illegal), target, focus);

			common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].inferred.intersect(simplest_symmetric_connections); });

			if (!simplest_symmetric_connections.some(fp => focused_card.matches(fp)))
				game.interpretMove(CLUE_INTERP.NONE);
			else
				resolve_clue(game, old_game, action, focusResult, matched_inferences, focused_card);
		}
		else {
			common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].inferred.intersect(focus_possible.filter(p => !p.illegal)); });
			resolve_clue(game, old_game, action, focusResult, matched_inferences, focused_card);
		}
	}
	else if (action.hypothetical) {
		game.interpretMove(CLUE_INTERP.NONE);
	}
	// Card doesn't match any inferences (or we don't know the card)
	else {
		if (target !== state.ourPlayerIndex || matched_inferences.length === 0)
			logger.info(`card ${logCard(focused_card)} order ${focus} doesn't match any inferences! currently ${common.thoughts[focus].inferred.map(logCard).join(',')}`);

		/** @type {FocusPossibility[]} */
		let all_connections = [];

		const looksDirect = common.thoughts[focus].identity() === undefined && (					// Focused card must be unknown AND
			rankLooksPlayable(game, clue.value, giver, target, focus) ||		// Looks like a play
			focus_possible.some(fp => !fp.illegal && game.players[target].thoughts[focus].possible.has(fp) &&
				fp.connections.every(conn => conn.type === 'known' || (conn.type === 'playable' && conn.reacting !== state.ourPlayerIndex))));	// Looks like an existing possibility

		// We are the clue target, so we need to consider all the (sensible) possibilities of the card
		if (target === state.ourPlayerIndex) {
			all_connections = all_connections.concat(focus_possible.filter(fp => !isTrash(state, game.players[giver], fp, focus, { infer: true, ignoreCM: true })));

			for (const id of common.thoughts[focus].inferred) {
				if (isTrash(state, game.players[giver], id, focus, { infer: true, ignoreCM: true }) ||
					(clue.type === CLUE.RANK && state.includesVariant(variantRegexes.pinkish) && id.rank !== clue.value) ||		// Pink promise
					all_connections.some(fp => id.matches(fp)))					// Focus possibility, skip
					continue;

				try {
					const connections = find_own_finesses(game, action, focus, id, looksDirect);
					logger.info('found connections:', logConnections(connections, id));

					const rank = inference_rank(state, id.suitIndex, connections);

					let same_match = false;

					for (const fp of all_connections) {
						for (const conn of connections) {
							if (conn.type !== 'known' || conn.reacting !== giver || !conn.identities.every(i => i.rank === fp.rank && i.suitIndex === fp.suitIndex))
								continue;

							same_match = true;

							// Valid asymmetric clue (or we at least have to entertain it)
							if (game.players[giver].thoughts[conn.order].inferred.every(i =>
								i.matches(fp) || (state.isCritical(i) && i.matches({ suitIndex: id.suitIndex, rank })))) {
								same_match = false;
								conn.asymmetric = false;
								break;
							}
						}
					}

					if (same_match) {
						logger.warn(`attempted to use giver's known connecting when focus could be it!`);
						continue;
					}

					all_connections.push({ connections, suitIndex: id.suitIndex, rank, interp: CLUE_INTERP.PLAY });
				}
				catch (error) {
					if (error instanceof IllegalInterpretation)
						logger.warn(error.message);
					else
						throw error;
				}
			}

			all_connections = occams_razor(game, all_connections, state.ourPlayerIndex, focus);
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!state.isBasicTrash(focused_card)) {
			const illegal_fp = focus_possible.find(fp => focused_card.matches(fp) && fp.illegal);

			if (illegal_fp) {
				// Force ignoring the self component
				game.next_ignore[0] ??= [];
				game.next_ignore[0].push({ order: illegal_fp.connections[0].order, inference: focused_card.identity() });
			}

			const { suitIndex } = focused_card;
			try {
				const connections = find_own_finesses(game, action, focus, focused_card, looksDirect);
				logger.info('found connections:', logConnections(connections, focused_card));

				// Add in all the potential non-finesse possibilities
				for (let i = 0; i < connections.length; i++) {
					if (connections[i].type === 'finesse') {
						const next_rank = state.play_stacks[suitIndex] + 1 + i;
						all_connections.push({ connections: connections.slice(0, i), suitIndex, rank: next_rank, interp: CLUE_INTERP.PLAY });
					}
				}
				all_connections.push({ connections, suitIndex, rank: inference_rank(state, suitIndex, connections), interp: CLUE_INTERP.PLAY });
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					logger.warn(error.message);
				else
					throw error;
			}
		}

		const finalized_connections = finalize_connections(all_connections);

		// No inference, but a finesse isn't possible
		if (finalized_connections.length === 0) {
			common.updateThoughts(focus, (draft) => { draft.reset = true; });
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', common.thoughts[focus].inferred.map(logCard));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			else {
				const saved_inferences = common.thoughts[focus].inferred;
				let new_inferred = common.thoughts[focus].inferred.intersect(focus_possible);

				if (new_inferred.length === 0)
					new_inferred = saved_inferences;

				common.updateThoughts(focus, (draft) => { draft.inferred = saved_inferences; });

				logger.info('no inference on card (other), looks like', common.thoughts[focus].inferred.map(logCard).join(','));
			}
			game.interpretMove(CLUE_INTERP.NONE);
		}
		else {
			common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].possible; });
			logger.info('selecting inferences', finalized_connections.map(conns => logCard(conns)));

			resolve_clue(game, old_game, action, focusResult, finalized_connections, focused_card);
		}
	}
	logger.highlight('blue', `final inference on focused card ${common.thoughts[focus].inferred.map(logCard).join(',')} (${game.lastMove}), order ${focus}`);

	// Pink 1's Assumption
	if (state.includesVariant(variantRegexes.pinkish) && clue.type === CLUE.RANK && clue.value === 1) {
		const clued_1s = state.hands[target].filter(o => unknown_1(state.deck[o]));
		const ordered_1s = order_1s(state, common, clued_1s, { no_filter: true });

		if (ordered_1s.length > 0) {
			const missing_1s = Utils.range(0, state.variant.suits.length)
				.map(suitIndex => ({ suitIndex, rank: 1 }))
				.filter(i => !isTrash(state, common, i, ordered_1s[0], { infer: true }));

			if (missing_1s.length > 0) {
				for (const order of ordered_1s.slice(0, missing_1s.length))
					common.updateThoughts(order, (draft) => { draft.inferred = common.thoughts[order].inferred.intersect(missing_1s); });
			}
		}
	}

	common.good_touch_elim(state);
	common.refresh_links(state);
	common.update_hypo_stacks(state);

	if (positional) {
		game.moveHistory.pop();
		game.interpretMove(CLUE_INTERP.POSITIONAL);
	}
	else if (game.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2) {
		const cm_orders = interpret_tccm(game, oldCommon, target, list, focused_card);

		if (cm_orders.length > 0) {
			perform_cm(state, common, cm_orders);
			game.moveHistory.pop();
			game.interpretMove(CLUE_INTERP.CM_TEMPO);
		}
	}

	// Advance connections if a speed-up clue was given
	for (const wc of common.dependentConnections(focus)) {
		let index = wc.connections.findIndex(conn => conn.order === focus) - 1;
		let modified = false;

		while (wc.connections[index]?.hidden && index >= wc.conn_index) {
			wc.connections.splice(index, 1);
			index--;
			modified = true;
		}

		if (modified)
			logger.info(`advanced waiting connection due to speed-up clue: [${wc.connections.map(logConnection).join(' -> ')}]`);
	}

	// Remove chop move on clued cards
	for (const player of game.allPlayers) {
		for (const order of list) {
			if (player.thoughts[order].chop_moved)
				player.updateThoughts(order, (draft) => { draft.chop_moved = false; });
		}
	}

	try {
		logger.debug('hand state after clue', logHand(state.hands[target]));
	}
	catch (err) {
		logger.info('Failed to debug hand state', err, state.hands[target], Utils.globals.game.common.thoughts.map(c => c.order));
	}
	team_elim(game);
}
