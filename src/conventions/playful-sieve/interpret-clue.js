import { CLUE } from '../../constants.js';
import { isTrash, refer_right } from '../../basics/hanabi-util.js';
import { team_elim, update_hypo_stacks } from '../../basics/helper.js';
import * as Basics from '../../basics.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';


/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Interprets the given clue.
 * @param  {State} state
 * @param  {ClueAction} action
 */
export function interpret_clue(state, action) {
	const { common } = state;
	const { clue, giver, list, target } = action;
	const hand = state.hands[target];
	const touch = Array.from(hand.filter(c => list.includes(c.order)));

	const oldCommon = state.common.clone();
	const old_playables = oldCommon.thinksPlayables(state, target).map(c => c.order);
	const old_trash = oldCommon.thinksTrash(state, target).map(c => c.order);

	const no_info = touch.every(card => card.clues.some(c => Utils.objEquals(c, clue)));

	Basics.onClue(state, action);

	const clue_resets = new Set();
	for (const { order } of state.hands[target]) {
		if (oldCommon.thoughts[order].inferred.length > 0 && common.thoughts[order].inferred.length === 0) {
			common.reset_card(order);
			clue_resets.add(order);
		}
	}

	const resets = common.good_touch_elim(state);

	// Includes resets from negative information
	/** @type {Set<number>} */
	const all_resets = new Set([...clue_resets, ...resets]);

	if (all_resets.size > 0) {
		// TODO: Support undoing recursive eliminations by keeping track of which elims triggered which other elims
		const infs_to_recheck = Array.from(all_resets).map(order => oldCommon.thoughts[order].identity({ infer: true })).filter(id => id !== undefined);

		for (const inf of infs_to_recheck) {
			common.restore_elim(inf);
		}
	}

	let fix = list.some(order => all_resets.has(order) && !state.hands[target].findOrder(order).newly_clued);

	for (const { order } of hand) {
		const card = common.thoughts[order];

		// Revoke ctd if clued
		if (card.called_to_discard && card.clued) {
			card.called_to_discard = false;
		}

		const last_action = state.last_actions[giver];

		// Revoke finesse if newly clued after a possibly matching play
		if (card.finessed && card.newly_clued && last_action.type === 'play') {
			const identity = state.last_actions[giver].card;

			logger.warn('revoking finesse?', card.possible.map(logCard), logCard(identity));

			if (card.possible.some(c => c.matches(identity))) {
				card.assign('inferred', [identity]);
				card.finessed = false;
				fix = true;

				// Do not allow this card to regain inferences from false elimination
				for (const [id, orders] of Object.entries(common.elims)) {
					if (orders.includes(order)) {
						common.elims[id].splice(orders.indexOf(order), 1);
					}
				}
			}
		}
	}

	update_hypo_stacks(state, common);

	const newly_touched = Utils.findIndices(hand, (card) => card.newly_clued);
	const trash_push = !fix && touch.every(card => (card.newly_clued &&
		common.thoughts[card.order].inferred.every(inf => isTrash(state, common, inf, card.order))));

	if (trash_push) {
		logger.highlight('cyan', 'trash push!');
	}

	const known_trash = common.thinksTrash(state, target);

	if (state.common.thinksLocked(state, giver)) {
		if (clue.type === CLUE.RANK) {
			// Rank fill-in/trash reveal, no additional meaning
			if (known_trash.length + hand.filter(c => common.thoughts[c.order].called_to_discard).length > 0) {
				return;
			}

			// Referential discard
			if (newly_touched.length > 0 && !trash_push) {
				const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (card) => !card.clued, index)));
				const target_index = referred.reduce((min, curr) => Math.min(min, curr));

				// Don't call to discard if that's the only card touched
				if (!newly_touched.every(index => index === target_index)) {
					logger.info('locked ref discard on slot', target_index + 1, logCard(hand[0]));
					common.thoughts[hand[target_index].order].called_to_discard = true;
				}
			}
			else {
				// Fill-in (locked hand ptd on slot 1)
				logger.info('rank fill in while unloaded, giving locked hand ptd on slot 1', logCard(hand[0]));
				common.thoughts[hand[0].order].called_to_discard = true;
			}
		}
		// Colour clue
		else {
			const suitIndex = clue.value;

			// Slot 1 is playable
			if (hand[0].newly_clued) {
				common.thoughts[hand[0].order].intersect('inferred', [{ suitIndex, rank: common.hypo_stacks[suitIndex] + 1 }]);
				const locked_hand_ptd = hand.find(c => !c.clued);

				if (locked_hand_ptd) {
					common.thoughts[locked_hand_ptd.order].called_to_discard = true;
					logger.info('locked hand ptd on', logCard(locked_hand_ptd));
				}
			}
			else {
				// Colour fill-in/trash reveal, no additional meaning
				if (known_trash.length + hand.filter(c => common.thoughts[c.order].called_to_discard).length > 0) {
					logger.info('colour fill in while loaded on', (known_trash.length > 0 ? `kt ${known_trash.map(logCard)}` : `ptd on slot ${hand.findIndex(card => common.thoughts[card.order].called_to_discard) + 1}`));
					return;
				}

				// Fill-in (locked hand ptd on slot 1)
				logger.info('colour fill in while unloaded, giving locked hand ptd on slot 1', logCard(hand[0]));
				common.thoughts[hand[0].order].called_to_discard = true;
			}
		}
		return;
	}

	if (!trash_push && (common.thinksPlayables(state, target).length > old_playables.length || common.thinksTrash(state, target).length > old_trash.length)) {
		logger.info('new safe action provided, not continuing');
	}
	else if (fix) {
		logger.info('fix clue, not continuing');
	}
	else if (no_info) {
		logger.highlight('cyan', 'no info clue! trash dump');

		for (const { order } of hand) {
			const card = common.thoughts[order];

			if (!card.clued && !card.finessed && !card.chop_moved) {
				card.called_to_discard = true;
			}
		}
	}
	else {
		// Referential play (right)
		if (clue.type === CLUE.COLOUR || trash_push) {
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(hand, index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Telling chop to play while not loaded, lock
				if (target_index === 0 && !common.thinksLoaded(state, target)) {
					for (const card of hand) {
						if (!card.clued) {
							common.thoughts[card.order].chop_moved = true;
						}
					}
					logger.highlight('yellow', 'lock!');
					action.lock = true;
				}
				else {
					const unknown_plays = common.unknown_plays.filter(order => state.hands[target].findOrder(order));

					// The playable card could connect to any unknown plays
					const known_playables = common.hypo_stacks.map((rank, suitIndex) => {
						return { suitIndex, rank: rank + 1 };
					});

					const unknown_playables = unknown_plays.flatMap(order =>
						common.thoughts[order].inferred.map(inf => { return { suitIndex: inf.suitIndex, rank: inf.rank + 1 }; }));

					const target_card = common.thoughts[hand[target_index].order];
					target_card.old_inferred = target_card.inferred.slice();
					target_card.finessed = true;
					target_card.intersect('inferred', known_playables.concat(unknown_playables));

					// TODO: connect properly if there is more than 1 unknown play, starting from oldest finesse index
					for (const unk of unknown_plays) {
						for (const inf of common.thoughts[unk].inferred) {
							const connections = [{ type: /** @type {const} */ ('finesse'), reacting: target, card: state.hands[target].findOrder(unk), identities: [inf] }];

							common.waiting_connections.push({
								connections,
								giver,
								conn_index: 0,
								focused_card: state.hands[target][target_index],
								inference: { suitIndex: inf.suitIndex, rank: inf.rank + 1 },
								action_index: state.actionList.length });
						}
					}

					logger.info(`ref play on ${state.playerNames[target]}'s slot ${target_index + 1}`);
				}
			}
			else {
				// Fill-in (anti-finesse)
				logger.info('colour fill in, anti-finesse on slot 1', logCard(hand[0]));
				common.thoughts[hand[0].order].called_to_discard = true;
			}
		}
		// Referential discard (right)
		else {
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (card) => !card.clued, index)));
				const target_index = referred.reduce((min, curr) => Math.min(min, curr));

				if (hand[target_index].newly_clued) {
					logger.highlight('yellow', 'lock!');
					action.lock = true;
				}
				else {
					common.thoughts[hand[target_index].order].called_to_discard = true;
					logger.info(`ref discard on ${state.playerNames[target]}'s slot ${target_index + 1}`);
				}
			}
			else {
				// Fill-in (anti-finesse)
				logger.info('rank fill in, anti-finesse on slot 1', logCard(hand[0]));
				common.thoughts[hand[0].order].called_to_discard = true;
				return;
			}
		}
	}

	common.refresh_links(state);
	team_elim(state);
}
