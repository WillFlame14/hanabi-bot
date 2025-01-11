import { ACTION } from '../../constants.js';
import { predict_value } from './action-helper.js';
import { find_fix_clue } from './fix-clues.js';

import logger from '../../tools/logger.js';
import { logHand } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';
import { find_sarcastics } from '../shared/sarcastic.js';

import { Worker } from 'worker_threads';
import * as path from 'path';
import { shortForms } from '../../variants.js';

/**
 * @typedef {import('../ref-sieve.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').Action} Action
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * @param {Game} game
 * @param {number} giver
 * @returns {Clue[]}
 */
export function find_all_clues(game, giver) {
	const { state } = game;

	return state.clue_tokens === 0 ? [] : Array.from(Utils.rangeI(0, state.numPlayers)
		.filter(i => i !== giver)
		.flatMap(i => state.allValidClues(i)));
}

/**
 * @param {Game} game
 * @param {number} playerIndex
 */
export function find_all_discards(game, playerIndex) {
	const { common, state } = game;

	const trash = common.thinksTrash(state, playerIndex).filter(o => common.thoughts[o].saved);

	if (trash.length > 0)
		return trash.map(o => ({ order: o }));

	const discardable = state.hands[playerIndex].find(o => common.thoughts[o].called_to_discard) ??
		state.hands[playerIndex][0];

	return [{ order: discardable }];
}

/**
 * Performs the most appropriate action given the current state.
 * @param {Game} game
 * @returns {Promise<PerformAction>}
 */
export async function take_action(game) {
	const { common, me, state, tableID } = game;

	// Look for playables, trash and important discards in own hand
	let playable_orders = me.thinksPlayables(state, state.ourPlayerIndex);
	let trash_orders = me.thinksTrash(state, state.ourPlayerIndex).filter(o => common.thoughts[o].saved);

	// Add cards called to discard
	for (const order of state.ourHand) {
		const card = me.thoughts[order];
		if (!trash_orders.includes(order) && card.called_to_discard && card.possible.some(p => !state.isCritical(p)))
			trash_orders.push(order);
	}

	// Discards must be inferred, playable, trash and not duplicated in our hand
	const discards = playable_orders.filter(order => {
		const id = me.thoughts[order].identity({ infer: true });

		if (id === undefined || !trash_orders.includes(order) || playable_orders.some(o => me.thoughts[o].matches(id, { infer: true }) && o !== order))
			return false;

		return state.hands.some((hand, i) => {
			if (i === state.ourPlayerIndex)
				return false;

			const dupe = hand.find(o => state.deck[o].matches(id) && state.deck[o].clued);
			if (dupe === undefined)
				return false;

			const sarcastics = find_sarcastics(state, i, common, id);
			return sarcastics.length > 0 && Math.min(...sarcastics) === dupe;
		});
	});

	// Pick the leftmost of all playable trash cards
	const playable_trash = playable_orders.filter(order => {
		const id = me.thoughts[order].identity({ infer: true });
		return id !== undefined && trash_orders.includes(order) && !playable_orders.some(o => me.thoughts[o].matches(id, { infer: true }) && o > order);
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

	if (state.clue_tokens > 0) {
		const fix_clue = find_fix_clue(game);

		if (fix_clue !== undefined)
			return Utils.clueToAction(fix_clue, tableID);
	}

	const all_clues = state.clue_tokens === 0 ? [] : Array.from(Utils.rangeI(0, state.numPlayers)
		.filter(i => i !== state.ourPlayerIndex)
		.flatMap(i => state.allValidClues(i))
		.map(clue => {
			const perform = Utils.clueToAction(clue, tableID);
			return { perform, action: Utils.performToAction(state, perform, state.ourPlayerIndex, state.deck) };
		}));

	/** @type {{ perform: PerformAction, action: Action }[]} */
	const all_plays = playable_orders.map(order => {
		const { suitIndex = -1, rank = -1 } = me.thoughts[order].identity({ infer: true }) ?? {};
		return {
			perform: { type: ACTION.PLAY, target: order, tableID },
			action: { type: 'play', suitIndex, rank, order, playerIndex: state.ourPlayerIndex }
		};
	});

	const cant_discard = state.clue_tokens === 8 || (state.pace === 0 && (all_clues.length > 0 || all_plays.length > 0));

	/** @type {{ perform: PerformAction, action: Action }[]} */
	const all_discards = cant_discard ? [] : trash_orders.concat(discards).map(order => {
		const { suitIndex = -1, rank = -1 } = me.thoughts[order].identity({ infer: true }) ?? {};
		return {
			perform: { type: ACTION.DISCARD, target: order, tableID },
			action: { type: 'discard', suitIndex, rank, order, playerIndex: state.ourPlayerIndex, intentional: discards.includes(order), failed: false }
		};
	});

	const all_actions = all_clues.concat(all_plays).concat(all_discards);

	if (!cant_discard && all_plays.length === 0 && all_discards.length === 0 && !me.thinksLocked(state, state.ourPlayerIndex) && state.clue_tokens < 8) {
		const chop = state.ourHand[0];

		all_actions.push({
			perform: { type: ACTION.DISCARD, target: chop, tableID },
			action: { type: 'discard', suitIndex: -1, rank: -1, order: chop, playerIndex: state.ourPlayerIndex, failed: false }
		});
	}

	if (all_actions.length === 0) {
		return { type: ACTION.DISCARD, target: me.lockedDiscard(state, state.ourHand), tableID };
	}
	else if (state.inEndgame()) {
		logger.highlight('purple', 'Attempting to solve endgame...');

		const workerData = { game: Utils.toJSON(game), playerTurn: state.ourPlayerIndex, conv: 'RefSieve', logLevel: logger.level, shortForms };
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
				console.log('worker threw an error while solving endgame!');
				reject(msg);
			});
		});

		if (result !== undefined) {
			const { action } = result;

			if (action.type === ACTION.COLOUR || action.type === ACTION.RANK) {
				if (action.target === -1) {
					const { perform: stall_clue } = Utils.maxOn(all_clues, ({ action }) => predict_value(game, action));
					return stall_clue;
				}
			}
			return { ...action, tableID };
		}
	}

	const { perform: best_action } = Utils.maxOn(all_actions, ({ action }) => predict_value(game, action));

	return best_action;
}
