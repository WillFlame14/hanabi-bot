import { CLUE } from '../../constants.js';
import { checkFix } from '../../basics/helper.js';
import * as Basics from '../../basics.js';

import logger from '../../tools/logger.js';
import { logCard, logClue } from '../../tools/log.js';
import { applyPatches, produce } from '../../StateProxy.js';
import { CLUE_INTERP } from './rs-constants.js';

/**
 * @typedef {import('../ref-sieve.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Interprets a referential play clue.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {boolean} right
 */
function ref_play(game, action, right = false) {
	const { common, state } = game;
	const { giver, list, target: clue_target } = action;
	const hand = state.hands[clue_target];
	const newly_touched = list.filter(o => state.deck[o].newly_clued);

	const focus = newly_touched.sort((a, b) => {
		if (a === hand[0])
			return 1;
		else if (b === hand[0])
			return -1;
		else
			return b - a;
	})[0];
	const target = right ?
		Math.min(...newly_touched.map(o => common.refer('right', hand, o))) :
		Math.max(...newly_touched.map(o => common.refer('left', hand, o)));

	if (common.thoughts[target].finessed) {
		logger.info('targeting an already known playable!');
		return { new_common: common, patches: [], interp: CLUE_INTERP.NONE };
	}

	if (common.thoughts[target].called_to_discard) {
		logger.info('targeting a card called to discard!');
		return { new_common: common, patches: [], interp: CLUE_INTERP.NONE };
	}

	const [playable_possibilities, new_wcs] = (() => {
		if (!common.thinksLoaded(state, clue_target))
			return [state.play_stacks.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1})), []];

		const unknown_plays = Array.from(common.unknown_plays).filter(order => state.hands[clue_target].includes(order));

		// The playable card could connect to any unknown plays
		const unknown_playables = unknown_plays.flatMap(order =>
			common.thoughts[order].inferred.map(inf => ({ suitIndex: inf.suitIndex, rank: inf.rank + 1 })));

		const hypo_playables = common.hypo_stacks.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }));

		const new_wcs = unknown_plays.flatMap(unk => common.thoughts[unk].inferred.map(inf => {
			// TODO: connect properly if there is more than 1 unknown play, starting from oldest finesse index
			const connections = [{
				type: /** @type {const} */ ('finesse'),
				reacting: clue_target,
				order: unk,
				identities: [inf]
			}];

			return {
				connections,
				giver,
				target: clue_target,
				conn_index: 0,
				turn: state.turn_count,
				focus: target,
				inference: { suitIndex: inf.suitIndex, rank: inf.rank + 1 },
				action_index: state.actionList.length
			};
		}));

		return [hypo_playables.concat(unknown_playables), new_wcs];
	})();

	const { inferred } = common.thoughts[target];
	const final_inferences = inferred.intersect(playable_possibilities);

	if (final_inferences.length === 0)
		return { new_common: common, patches: [], interp: CLUE_INTERP.NONE };

	logger.info(`ref play on ${state.playerNames[clue_target]}'s slot ${hand.indexOf(target) + 1} (focus ${focus}) inferences ${final_inferences.map(logCard).join()}`);

	let patches = [];
	const new_common = produce(common, (draft) => {
		const target_card = draft.thoughts[target];
		target_card.old_inferred = inferred;
		target_card.finessed = !list.includes(target);
		target_card.inferred = inferred.intersect(playable_possibilities);

		if (list.includes(target))
			draft.thoughts[target].focused = true;

		for (const wc of new_wcs)
			draft.waiting_connections.push(wc);
	}, (p) => { patches = patches.concat(p); });

	return { new_common, patches, interp: CLUE_INTERP.REF_PLAY };
}

/**
 * Interprets a referential discard clue.
 * @param {Game} game
 * @param {ClueAction} action
 */
function ref_discard(game, action) {
	const { common, state } = game;
	const { list, target: clue_target } = action;
	const hand = state.hands[clue_target];
	const newly_touched = list.filter(o => state.deck[o].newly_clued);

	const focus = Math.max(...newly_touched);
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
 * Interprets the given clue.
 * 
 * Impure!
 * @param  {Game} game
 * @param  {ClueAction} action
 */
export function interpret_clue(game, action) {
	const { common, state } = game;
	const { clue, list, target } = action;

	const newly_touched = list.filter(o => !state.deck[o].clued);
	const { common: prev_common, state: prev_state } = game.minimalCopy();

	Basics.onClue(game, action);

	const { clued_resets, duplicate_reveal, rewinded } = checkFix(game, prev_common.thoughts, action);
	if (rewinded)
		return;

	const fixed = new Set(clued_resets.concat(duplicate_reveal));
	const fix = fixed.size > 0;
	const trash_push = newly_touched.every(o => common.thoughts[o].possible.every(p => state.isBasicTrash(p)));

	const { new_common, patches, interp } = (() => {
		const prev_playables = prev_common.thinksPlayables(prev_state, target, { symmetric: true });
		const prev_trash = prev_common.thinksTrash(prev_state, target);
		const prev_loaded = prev_trash.length > 0 ||
			prev_state.hands[target].some(o => prev_common.thoughts[o].called_to_discard) ||
			prev_playables.some(o => !fixed.has(o));

		logger.info('prev loaded?', prev_loaded , logClue({ ...clue, target }));

		if (prev_loaded) {
			if (newly_touched.length > 0)
				return ref_play(game, action, clue.type === CLUE.RANK && !trash_push);

			// attempt finesse
			return { new_common: common, patches: [], interp: CLUE_INTERP.NONE };
		}

		const old_playables = prev_common.thinksPlayables(prev_state, target);
		const new_playables = common.thinksPlayables(state, target).filter(p => !old_playables.includes(p));
		const loaded = common.thinksLoaded(state, target);

		if (newly_touched.length === 0) {
			if (loaded) {
				logger.info('revealed a safe action, not continuing');
				return { new_common: common, patches: [], interp: CLUE_INTERP.REVEAL };
			}
			return { new_common: common, patches: [], interp: CLUE_INTERP.NONE };
		}

		if (trash_push) {
			logger.info('trash push');
			return ref_play(game, action);
		}

		if (fix || (loaded && !(clue.type === CLUE.COLOUR && new_playables.every(p => newly_touched.includes(p))))) {
			logger.info('revealed a safe action, not continuing', new_playables);

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
