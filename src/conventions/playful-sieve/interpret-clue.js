import { CLUE } from '../../constants.js';
import { isTrash, playableAway, refer_right } from '../../basics/hanabi-util.js';
import { checkFix, team_elim, update_hypo_stacks } from '../../basics/helper.js';
import * as Basics from '../../basics.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';


/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').BasicCard} BasicCard
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Interprets the given clue, as given from a locked player.
 * @param  {State} state
 * @param  {ClueAction} action
 */
function interpret_locked_clue(state, action) {
	const { common } = state;
	const { clue, target } = action;

	const hand = state.hands[target];
	const slot1 = common.thoughts[hand[0].order];
	const locked_hand_ptd = hand.find(c => !common.thoughts[c.order].saved);

	const known_trash = common.thinksTrash(state, target);
	const newly_touched = Utils.findIndices(hand, (card) => card.newly_clued);

	if (clue.type === CLUE.RANK) {
		// Rank fill-in/trash reveal, no additional meaning
		if (known_trash.length + hand.filter(c => common.thoughts[c.order].called_to_discard).length > 0)
			return;

		// Referential discard (check not trash push?)
		if (newly_touched.length > 0) {
			const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (card) => !card.clued, index)));
			const target_index = referred.reduce((min, curr) => Math.min(min, curr));

			// Don't call to discard if that's the only card touched
			if (newly_touched.every(index => index === target_index))
				return;

			logger.info('locked ref discard on slot', target_index + 1, logCard(hand[0]));
			common.thoughts[hand[target_index].order].called_to_discard = true;
		}
		// Fill-in (possibly locked hand ptd)
		else {
			if (locked_hand_ptd)
				common.thoughts[locked_hand_ptd.order].called_to_discard = true;

			logger.info('rank fill in', locked_hand_ptd ? '' : `while unloaded, giving lh ptd on slot ${hand.findIndex(c => c.order === locked_hand_ptd.order) + 1}`);
		}
	}
	// Colour clue
	else {
		const suitIndex = clue.value;

		// Slot 1 is playable
		if (slot1.newly_clued) {
			slot1.intersect('inferred', [{ suitIndex, rank: common.hypo_stacks[suitIndex] + 1 }]);

			if (locked_hand_ptd) {
				common.thoughts[locked_hand_ptd.order].called_to_discard = true;
				logger.info('locked hand ptd on slot', hand.findIndex(c => c.order === locked_hand_ptd.order) + 1);
			}
		}
		else {
			// Colour fill-in/trash reveal, no additional meaning
			if (known_trash.length + hand.filter(c => common.thoughts[c.order].called_to_discard).length > 0) {
				logger.info('colour fill in while loaded on', (known_trash.length > 0 ? `kt ${known_trash.map(logCard)}` : `ptd on slot ${hand.findIndex(card => common.thoughts[card.order].called_to_discard) + 1}`));
				return;
			}

			// Fill-in (possibly locked hand ptd)
			if (locked_hand_ptd)
				common.thoughts[locked_hand_ptd.order].called_to_discard = true;

			logger.info('colour fill in', slot1.saved ? '' : `while unloaded, giving lh ptd on slot ${hand.findIndex(c => c.order === locked_hand_ptd.order) + 1}`);
		}
	}
}

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

	const no_info = touch.every(card => card.clues.some(c => Utils.objEquals(c, Utils.objPick(clue, ['type', 'value']))));

	Basics.onClue(state, action);

	let fix = checkFix(state, oldCommon.thoughts, action);

	for (const { order } of hand) {
		const card = common.thoughts[order];

		// Revoke ctd if clued
		if (card.called_to_discard && card.clued)
			card.called_to_discard = false;

		const last_action = state.last_actions[giver];

		// Revoke finesse if newly clued after a possibly matching play
		if (oldCommon.thoughts[order].finessed && card.newly_clued && last_action.type === 'play') {
			const identity = state.last_actions[giver].card;

			logger.warn('revoking finesse?', card.possible.map(logCard), logCard(identity));

			if (card.possible.some(c => c.matches(identity))) {
				card.assign('inferred', [identity]);
				card.finessed = false;
				card.reset = true;
				fix = true;

				// Do not allow this card to regain inferences from false elimination
				for (const [id, orders] of Object.entries(common.elims)) {
					if (orders?.includes(order))
						common.elims[id].splice(orders.indexOf(order), 1);
				}
			}
		}
	}

	const newly_touched = Utils.findIndices(hand, (card) => card.newly_clued);
	const trash_push = !fix && touch.every(card => !card.newly_clued ||
		common.thoughts[card.order].inferred.every(inf => isTrash(state, common, inf, card.order))) && touch.some(card => card.newly_clued);

	if (trash_push)
		logger.highlight('cyan', 'trash push!');

	if (state.common.thinksLocked(state, giver)) {
		interpret_locked_clue(state, action);

		common.good_touch_elim(state);
		common.refresh_links(state);
		update_hypo_stacks(state, common);
		team_elim(state);
		return;
	}

	const new_playable = common.thinksPlayables(state, target).some(c => !old_playables.some(o => o === c.order));
	const new_trash = !trash_push && common.thinksTrash(state, target).some(c => c.clued && !old_trash.some(o => o === c.order));

	// Revealing a playable never is additionally referential, except colour clues where only new cards are touched
	if (!(clue.type === CLUE.COLOUR && touch.every(c => c.newly_clued)) && (new_playable || new_trash)) {
		logger.info('new safe action', (new_playable ? 'playable' : (new_trash ? 'trash' : '')) ,'provided, not continuing', );
	}
	else if (fix) {
		logger.info('fix clue, not continuing');
	}
	else if (no_info) {
		logger.highlight('cyan', 'no info clue! trash dump');

		for (const { order } of hand) {
			const card = common.thoughts[order];

			if (!card.clued && !card.finessed && !card.chop_moved)
				card.called_to_discard = true;
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
						if (!card.clued)
							common.thoughts[card.order].chop_moved = true;
					}
					logger.highlight('yellow', 'lock!');
					action.lock = true;
				}
				else {
					/** @type {Identity[]} */
					let playable_possibilities;

					if (common.thinksLoaded(state, target)) {
						const unknown_plays = Array.from(common.unknown_plays).filter(order => state.hands[target].findOrder(order));

						// The playable card could connect to any unknown plays
						const unknown_playables = unknown_plays.flatMap(order =>
							common.thoughts[order].inferred.map(inf => ({ suitIndex: inf.suitIndex, rank: inf.rank + 1 })));

						const hypo_playables = common.hypo_stacks.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1 }));

						playable_possibilities = hypo_playables.concat(unknown_playables);

						// TODO: connect properly if there is more than 1 unknown play, starting from oldest finesse index
						for (const unk of unknown_plays) {
							for (const inf of common.thoughts[unk].inferred) {
								const connections = [{
									type: /** @type {const} */ ('finesse'),
									reacting: target,
									card: state.hands[target].findOrder(unk),
									identities: [inf]
								}];

								common.waiting_connections.push({
									connections,
									giver,
									conn_index: 0,
									focused_card: state.hands[target][target_index],
									inference: { suitIndex: inf.suitIndex, rank: inf.rank + 1 },
									action_index: state.actionList.length
								});
							}
						}
					}
					else {
						playable_possibilities = state.play_stacks.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1}));
					}

					const target_card = common.thoughts[hand[target_index].order];
					target_card.old_inferred = target_card.inferred.slice();
					target_card.finessed = true;
					target_card.focused = true;
					target_card.intersect('inferred', playable_possibilities);

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
				// Directly playable rank, eliminate from focus if a link was formed
				if (common.thoughts[hand[newly_touched[0]].order].inferred.every(inf => playableAway(state, inf) === 0)) {
					common.thoughts[hand[newly_touched[0]].order].focused = true;
				}
				else {
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
			}
			else {
				// Fill-in (anti-finesse)
				logger.info('rank fill in, anti-finesse on slot 1', logCard(hand[0]));
				common.thoughts[hand[0].order].called_to_discard = true;
			}
		}
	}

	common.good_touch_elim(state);
	common.refresh_links(state);
	update_hypo_stacks(state, common);
	team_elim(state);
}
