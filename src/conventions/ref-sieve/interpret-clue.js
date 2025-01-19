import { CLUE } from '../../constants.js';
import { CLUE_INTERP } from './rs-constants.js';
import { connect, find_own_finesses } from './connecting-cards.js';
import { checkFix, distribution_clue } from '../../basics/helper.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';
import { applyPatches, produce } from '../../StateProxy.js';


/**
 * @typedef {import('../ref-sieve.js').default} Game
 * @typedef {import('../rs-player.js').RS_Player} Player
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 */

/**
 * Finds the focus of a clue.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {{ push: boolean, right?: boolean}} options
 */
function determine_focus(game, action, options) {
	const { state } = game;
	const { list, target } = action;
	const newly_touched = list.filter(o => state.deck[o].newly_clued);

	if (options.push) {
		const hand = state.hands[target];
		const least_priority = options.right ? hand.findLast(o => state.deck[o].clued && !state.deck[o].newly_clued) : hand[0];

		return newly_touched.sort((a, b) => {
			if (a === least_priority)
				return 1;
			else if (b === least_priority)
				return -1;
			else
				return options.right ? a - b : b - a;
		})[0];
	}

	return Math.max(...newly_touched);
}

/**
 * Interprets a referential play clue.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {boolean} right
 */
function ref_play(game, action, right = false) {
	const { common, state } = game;
	const { list, target: clue_target } = action;
	const hand = state.hands[clue_target];
	const newly_touched = list.filter(o => state.deck[o].newly_clued);

	const focus = determine_focus(game, action, { push: true, right });
	const target = right ?
		Math.min(...newly_touched.map(o => common.refer('right', hand, o))) :
		Math.max(...newly_touched.map(o => common.refer('left', hand, o)));

	const FAILURE = { new_common: common, patches: [], interp: CLUE_INTERP.NONE };

	if (common.thoughts[target].finessed) {
		logger.info('targeting an already known playable!');
		return FAILURE;
	}

	if (common.thoughts[target].called_to_discard) {
		logger.info('targeting a card called to discard!');
		return FAILURE;
	}

	const { success, new_common, patches } = target_play(game, action, target);

	if (!success)
		return FAILURE;

	logger.info(`ref play on ${state.playerNames[clue_target]}'s slot ${hand.indexOf(target) + 1} (focus ${focus}) inferences ${new_common.thoughts[target].inferred.map(logCard).join()}`);

	return { new_common, patches, interp: CLUE_INTERP.REF_PLAY };
}

/**
 * Interprets a referential discard clue.
 * @param {Game} game
 * @param {ClueAction} action
 */
function ref_discard(game, action) {
	const { common, state } = game;
	const { target: clue_target } = action;
	const hand = state.hands[clue_target];

	const focus = determine_focus(game, action, { push: false });
	const target_index = hand.findIndex((o, i) => i > hand.indexOf(focus) && !state.deck[o].clued);

	let patches = [];

	if (target_index === -1) {
		logger.highlight('yellow', 'lock!');

		// Chop move all unsaved cards
		const new_common = produce(common, (draft) => {
			for (const o of hand) {
				if (!common.thoughts[o].saved)
					draft.thoughts[o].chop_moved = true;
			}

			draft.thoughts[focus].focused = true;
		}, (p) => { patches = patches.concat(p); });

		return { new_common, patches, interp: CLUE_INTERP.LOCK };
	}

	const target = hand[target_index];
	logger.info(`ref discard on ${state.playerNames[clue_target]}'s slot ${target_index + 1} (focus ${focus})`);

	const new_common = produce(common, (draft) => {
		draft.thoughts[target].called_to_discard = true;
		draft.thoughts[focus].focused = true;
	}, (p) => { patches = patches.concat(p); });

	return { new_common, patches, interp: CLUE_INTERP.REF_DC };
}

/**
 * Returns a new common player that attempts to make the target card playable.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {number} target
 */
function target_play(game, action, target) {
	const { common, state } = game;
	const { giver, list, target: clue_target } = action;
	let new_common = common, patches = [];

	const unknown = common.thoughts[target].identity({ infer: true, symmetric: true }) === undefined;

	/** @type {FocusPossibility[]} */
	const focus_poss = [];

	for (const inf of common.thoughts[target].inferred) {
		const { success, connections } = connect(game, inf, giver, clue_target, unknown);
		const { suitIndex, rank } = inf;

		if (success)
			focus_poss.push({ suitIndex, rank, connections, interp: CLUE_INTERP.PLAY });
	}

	const possibilities = focus_poss.map(wc => ({ suitIndex: wc.suitIndex, rank: wc.rank }));

	logger.info(`focus possibilities [${possibilities.map(logCard).join()}]`);

	const target_id = common.thoughts[target].identity() ?? state.deck[target].identity();
	const action_index = state.actionList.length;

	if (target_id !== undefined && !focus_poss.some(i => target_id.matches(i))) {
		if (giver === state.ourPlayerIndex)
			return { success: false };

		const { success, connections } = find_own_finesses(game, target_id, giver, clue_target, unknown);
		const { suitIndex, rank } = target_id;

		if (success) {
			focus_poss.push({ suitIndex, rank, connections, interp: CLUE_INTERP.PLAY });
			possibilities.push(target_id.raw());
		}
		else {
			logger.info('targeting an unplayable card!');
			return { success: false };
		}
	}

	new_common = produce(new_common, (draft) => {
		const matched_fps = target_id !== undefined ? focus_poss.filter(i => target_id.matches(i)) : focus_poss;

		for (const fp of matched_fps) {
			const { connections } = fp;
			// const urgent = connections.some(conn => conn.type === 'finesse') || unknown;

			for (const { type, order, identities } of connections) {
				const { inferred } = new_common.thoughts[order];

				const card = draft.thoughts[order];

				card.inferred = inferred[card.superposition ? 'union' : 'intersect'](identities);
				card.superposition = true;

				if (type === 'finesse') {
					card.finessed = true;
					card.possibly_finessed = true;
					card.firstTouch = { giver, turn: state.turn_count };
					card.old_inferred = inferred;
				}

				// if (urgent)
				// 	card.finesse_index = card.finesse_index === -1 ? action_index : card.finesse_index;
			}
		}

		for (const { suitIndex, rank, connections } of focus_poss) {
			if (connections.length > 0) {
				const inference = { suitIndex, rank };
				const symmetric = target_id !== undefined && !target_id.matches(inference);
				const new_wc = { connections, giver, target, conn_index: 0, turn: state.turn_count, focus: target, inference, action_index, symmetric };
				draft.waiting_connections.push(new_wc);
			}
		}

		const target_card = draft.thoughts[target];
		target_card.inferred = common.thoughts[target].inferred[target_card.superposition ? 'union' : 'intersect'](possibilities);
		target_card.called_to_play = true;
		target_card.info_lock = common.thoughts[target].possible.intersect(possibilities);

		if (!common.thoughts[target].clued)
			target_card.firstTouch = { giver, turn: state.turn_count };

		target_card.superposition = true;

		if (list.includes(target))
			draft.thoughts[target].focused = true;

	}, (p) => { patches = patches.concat(p); });

	return { success: true, new_common, patches };
}

/**
 * Interprets the given clue.
 * 
 * Impure!
 * @param  {Game} game
 * @param  {ClueAction} action
 */
export function interpret_clue(game, action) {
	const { common, state } = game;
	const { clue, list, target } = action;

	const hand = state.hands[target];
	const newly_touched = list.filter(o => !state.deck[o].clued);
	const { common: prev_common, state: prev_state } = game.minimalCopy();

	Basics.onClue(game, action);

	const { clued_resets, duplicate_reveal, rewinded } = checkFix(game, prev_common.thoughts, action);
	if (rewinded)
		return;

	const fixed = new Set(clued_resets.concat(duplicate_reveal));
	const fix = fixed.size > 0;
	const trash_push = !fix && newly_touched.every(o => common.thoughts[o].possible.every(p => state.isBasicTrash(p)));

	const { new_common, patches, interp } = (() => {
		if (!fix && !trash_push) {
			const intent = clue.type === CLUE.COLOUR ?
				Math.max(...newly_touched.map(o => common.refer('left', hand, o))) :
				determine_focus(game, action, { push: false });

			if (distribution_clue(game, action, common.thoughts[intent].order)) {
				const { inferred } = common.thoughts[intent];

				let patches;
				const new_common = produce(common, (draft) => {
					draft.thoughts[intent].inferred = inferred.intersect(inferred.filter(i => !state.isBasicTrash(i)));
					draft.thoughts[intent].certain_finessed = true;
					draft.thoughts[intent].reset = false;
				}, (p) => { patches = p; });

				return { new_common, patches, interp: CLUE_INTERP.REVEAL };
			}
		}

		const FAILURE = { new_common: common, patches: [], interp: CLUE_INTERP.NONE };

		const prev_playables = prev_common.thinksPlayables(prev_state, target, { symmetric: true });
		const prev_trash = prev_common.thinksTrash(prev_state, target);
		const prev_loaded = prev_trash.length > 0 ||
			prev_state.hands[target].some(o => prev_common.thoughts[o].called_to_discard) ||
			prev_playables.some(o => !fixed.has(o));

		logger.info('prev loaded?', prev_loaded , logClue({ ...clue, target }));

		if (!fix && prev_loaded) {
			if (newly_touched.length > 0)
				return ref_play(game, action, clue.type === CLUE.RANK && !trash_push);

			const { success, new_common, patches } = target_play(game, action, Math.max(...list));
			return success ? { new_common, patches, interp: CLUE_INTERP.RECLUE } : FAILURE;
		}

		const new_playables = common.thinksPlayables(state, target).filter(p => !prev_playables.includes(p));
		const loaded = common.thinksLoaded(state, target);

		if (newly_touched.length === 0) {
			if (loaded) {
				logger.info('revealed a safe action, not continuing');
				return { new_common: common, patches: [], interp: CLUE_INTERP.REVEAL };
			}

			const { success, new_common, patches } = target_play(game, action, Math.max(...list));
			return success ? { new_common, patches, interp: CLUE_INTERP.RECLUE } : FAILURE;
		}

		if (trash_push) {
			logger.info('trash push');
			return ref_play(game, action);
		}

		if (fix || (loaded && !(clue.type === CLUE.COLOUR && new_playables.every(p => newly_touched.includes(p))))) {
			logger.info(`revealed a safe action${fix ? ' (fix)': ''}, not continuing ${new_playables}`);

			let new_common = common, patches = [];

			if (!fix && clue.type === CLUE.RANK && new_playables.every(p => newly_touched.includes(p))) {
				const focus = Math.max(...newly_touched);

				new_common = produce(common, (draft) => {
					draft.thoughts[focus].focused = true;
				}, (p) => { patches = patches.concat(p); });
			}

			return { new_common, patches, interp: CLUE_INTERP.REVEAL };
		}

		if (clue.type === CLUE.COLOUR)
			return ref_play(game, action);
		else
			return ref_discard(game, action);
	})();

	game.interpretMove(interp);

	if (interp === CLUE_INTERP.NONE)
		return;

	game.common = new_common;

	game.common.good_touch_elim(state);
	game.common.refresh_links(state);
	game.common.update_hypo_stacks(state);

	for (const player of game.players) {
		for (const [order, patches] of game.common.patches) {
			const { possible, inferred } = game.common.thoughts[order];
			const { possible: player_possible } = player.thoughts[order];

			player.updateThoughts(order, (draft) => {
				applyPatches(draft, patches.filter(p => p.path[0] !== 'possible' && p.path[0] !== 'inferred'));
				draft.possible = possible.intersect(player_possible);
				draft.inferred = inferred.intersect(player_possible);
			}, false);
		}
		player.waiting_connections = game.common.waiting_connections.slice();
	}

	game.common.patches = new Map();

	game.players = game.players.map(player => {
		const new_player = patches.length  === 0 ? player : produce(player, (draft) => {
			for (const patch of patches) {
				if (patch.path[2] === 'possible' || patch.path[2] === 'inferred') {
					const order = Number(patch.path[1]);

					const { possible, inferred } = game.common.thoughts[order];
					const { possible: player_possible } = player.thoughts[order];

					draft.thoughts[order].possible = possible.intersect(player_possible);
					draft.thoughts[order].inferred = inferred.intersect(player_possible);
				}
			}
			applyPatches(draft, patches.filter(p => p.path[2] !== 'possible' && p.path[2] !== 'inferred'));
		});

		new_player.good_touch_elim(state, state.numPlayers === 2);
		new_player.refresh_links(state);
		new_player.update_hypo_stacks(state);
		return new_player;
	});
}
