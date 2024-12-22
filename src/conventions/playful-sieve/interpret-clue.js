import { CLUE } from '../../constants.js';
import { IdentitySet } from '../../basics/IdentitySet.js';
import { isTrash, refer_right } from '../../basics/hanabi-util.js';
import { checkFix, team_elim } from '../../basics/helper.js';
import * as Basics from '../../basics.js';
import * as Utils from '../../tools/util.js';

import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';

/**
 * @typedef {import('../playful-sieve.js').default} Game
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../types.js').ClueAction} ClueAction
 * @typedef {import('../../types.js').Connection} Connection
 * @typedef {import('../../types.js').Identity} Identity
 * @typedef {import('../../types.js').FocusPossibility} FocusPossibility
 */

/**
 * Interprets the given clue, as given from a locked player.
 * 
 * Impure!
 * @param  {Game} game
 * @param  {ClueAction} action
 */
function interpret_locked_clue(game, action) {
	const { common, state } = game;
	const { clue, target } = action;

	const hand = state.hands[target];
	const slot1 = common.thoughts[hand[0]];
	const locked_hand_ptd = hand.find(o => !common.thoughts[o].saved);

	const known_trash = common.thinksTrash(state, target);
	const newly_touched = Utils.findIndices(hand, (o) => state.deck[o].newly_clued);

	if (clue.type === CLUE.RANK) {
		// Rank fill-in/trash reveal, no additional meaning
		if (known_trash.length + hand.filter(o => common.thoughts[o].called_to_discard).length > 0)
			return;

		// Referential discard (check not trash push?)
		if (newly_touched.length > 0) {
			const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, (o) => !state.deck[o].clued, index)));
			const target_index = referred.reduce((min, curr) => Math.min(min, curr));

			// Don't call to discard if that's the only card touched
			if (newly_touched.every(index => index === target_index))
				return;

			logger.info('locked ref discard on slot', target_index + 1, logCard(state.deck[hand[0]]));
			common.updateThoughts(hand[target_index], (draft) => { draft.called_to_discard = true; });
		}
		// Fill-in (possibly locked hand ptd)
		else {
			if (locked_hand_ptd)
				common.updateThoughts(locked_hand_ptd, (draft) => { draft.called_to_discard = true; });

			logger.info('rank fill in', locked_hand_ptd ? `while unloaded, giving lh ptd on slot ${hand.findIndex(o => o === locked_hand_ptd) + 1}` : '');
		}
	}
	// Colour clue
	else {
		const suitIndex = clue.value;

		// Slot 1 is playable
		if (slot1.newly_clued) {
			common.updateThoughts(slot1.order, (draft) => { draft.inferred = common.thoughts[slot1.order].inferred.intersect({ suitIndex, rank: common.hypo_stacks[suitIndex] + 1 }); });

			if (locked_hand_ptd) {
				common.updateThoughts(locked_hand_ptd, (draft) => { draft.called_to_discard = true; });
				logger.info('locked hand ptd on slot', hand.findIndex(o => o === locked_hand_ptd) + 1);
			}
		}
		else {
			// Colour fill-in/trash reveal, no additional meaning
			if (known_trash.length + hand.filter(o => common.thoughts[o].called_to_discard).length > 0) {
				const loaded = known_trash.length > 0 ? `kt ${known_trash.map(o => logCard(state.deck[o]))}` : `ptd on slot ${hand.findIndex(o => common.thoughts[o].called_to_discard) + 1}`;
				logger.info('colour fill in while loaded on', loaded);
				return;
			}

			// Fill-in (possibly locked hand ptd)
			if (locked_hand_ptd)
				common.updateThoughts(locked_hand_ptd, (draft) => { draft.called_to_discard = true; });

			logger.info('colour fill in', slot1.saved ? '' : `while unloaded, giving lh ptd on slot ${hand.findIndex(o => o === locked_hand_ptd) + 1}`);
		}
	}
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
	const { clue, giver, list, target } = action;
	const hand = state.hands[target];
	const touch = hand.filter(o => list.includes(o));

	const oldCommon = common.clone();
	const old_playables = oldCommon.thinksPlayables(state, target);
	const old_trash = oldCommon.thinksTrash(state, target);

	const no_info = touch.every(o => state.deck[o].clues.some(c => Utils.objEquals(c, Utils.objPick(clue, ['type', 'value']))));

	Basics.onClue(game, action);

	let { fix } = checkFix(game, oldCommon.thoughts, action);

	for (const order of hand) {
		const card = common.thoughts[order];

		// Revoke ctd if clued
		if (card.called_to_discard && card.clued)
			common.updateThoughts(order, (draft) => { draft.called_to_discard = false; });

		const last_action = game.last_actions[giver];

		// Revoke finesse if newly clued after a possibly matching play
		if (oldCommon.thoughts[order].finessed && card.newly_clued && last_action.type === 'play') {
			const identity = state.deck[last_action.order];

			logger.warn('revoking finesse?', card.possible.map(logCard), logCard(identity));

			if (card.possible.has(identity)) {
				common.updateThoughts(order, (draft) => {
					draft.inferred = IdentitySet.create(state.variant.suits.length, identity);
					draft.finessed = false;
					draft.certain_finessed = true;
					draft.reset = true;
				});
				fix = true;

				// Do not allow this card to regain inferences from false elimination
				for (const [id, orders] of Object.entries(common.elims)) {
					if (orders?.includes(order))
						common.elims[id].splice(orders.indexOf(order), 1);
				}
			}
		}
	}

	const newly_touched = Utils.findIndices(hand, o => state.deck[o].newly_clued);
	const trash_push = !fix && touch.every(o => !state.deck[o].newly_clued ||
		common.thoughts[o].inferred.every(inf => isTrash(state, common, inf, o, { infer: true }))) && touch.some(o => state.deck[o].newly_clued);

	if (trash_push)
		logger.highlight('cyan', 'trash push!');

	if (common.thinksLocked(state, giver)) {
		interpret_locked_clue(game, action);

		common.good_touch_elim(state);
		common.refresh_links(state);
		common.update_hypo_stacks(state);
		team_elim(game);
		return;
	}

	const new_playable = common.thinksPlayables(state, target).some(o => !old_playables.includes(o));
	const new_trash = !trash_push && common.thinksTrash(state, target).some(o => state.deck[o].clued && !old_trash.includes(o));

	// Revealing a playable never is additionally referential, except colour clues where only new cards are touched
	if (!(clue.type === CLUE.COLOUR && touch.every(o => state.deck[o].newly_clued)) && (new_playable || new_trash)) {
		logger.info('new safe action', (new_playable ? 'playable' : (new_trash ? 'trash' : '')) ,'provided, not continuing', );
	}
	else if (fix) {
		logger.info('fix clue, not continuing');
	}
	else if (no_info) {
		logger.highlight('cyan', 'no info clue! trash dump');

		for (const order of hand) {
			const card = common.thoughts[order];

			if (!card.clued && !card.finessed && !card.chop_moved)
				common.updateThoughts(order, (draft) => { draft.called_to_discard = true; });
		}
	}
	else {
		// Referential play (right)
		if (clue.type === CLUE.COLOUR || trash_push) {
			if (newly_touched.length > 0) {
				const referred = newly_touched.map(index => refer_right(hand.map(o => state.deck[o]), index));
				const target_index = referred.reduce((max, curr) => Math.max(max, curr));

				// Telling chop to play while not loaded, lock
				if (target_index === 0 && !common.thinksLoaded(state, target)) {
					for (const order of hand) {
						if (!state.deck[order].clued)
							common.updateThoughts(order, (draft) => { draft.chop_moved = true; });
					}
					logger.highlight('yellow', 'lock!');
					action.lock = true;
				}
				else {
					/** @type {Identity[]} */
					let playable_possibilities;

					if (common.thinksLoaded(state, target)) {
						const unknown_plays = Array.from(common.unknown_plays).filter(order => state.hands[target].includes(order));

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
									order: unk,
									identities: [inf]
								}];

								common.waiting_connections.push({
									connections,
									giver,
									target,
									conn_index: 0,
									turn: state.turn_count,
									focus: state.hands[target][target_index],
									inference: { suitIndex: inf.suitIndex, rank: inf.rank + 1 },
									action_index: state.actionList.length
								});
							}
						}
					}
					else {
						playable_possibilities = state.play_stacks.map((rank, suitIndex) => ({ suitIndex, rank: rank + 1}));
					}

					const { inferred } = common.thoughts[hand[target_index]];
					common.updateThoughts(hand[target_index], (draft) => {
						draft.old_inferred = inferred;
						draft.finessed = true;
						draft.focused = true;
						draft.inferred = inferred.intersect(playable_possibilities);
					});

					logger.info(`ref play on ${state.playerNames[target]}'s slot ${target_index + 1}`);
				}
			}
			else {
				// Fill-in (anti-finesse)
				logger.info('colour fill in, anti-finesse on slot 1', logCard(state.deck[hand[0]]));
				common.updateThoughts(hand[0], (draft) => { draft.called_to_discard = true; });
			}
		}
		// Referential discard (right)
		else {
			if (newly_touched.length > 0) {
				// Directly playable rank, eliminate from focus if a link was formed
				if (common.thoughts[hand[newly_touched[0]]].inferred.every(i => state.isPlayable(i))) {
					common.updateThoughts(hand[newly_touched[0]], (draft) => { draft.focused = true; });
				}
				else {
					const referred = newly_touched.map(index => Math.max(0, Utils.nextIndex(hand, o => !state.deck[o].clued, index)));
					const target_index = referred.reduce((min, curr) => Math.min(min, curr));

					if (state.deck[hand[target_index]].newly_clued) {
						logger.highlight('yellow', 'lock!');
						action.lock = true;
					}
					else {
						common.updateThoughts(hand[target_index], (draft) => { draft.called_to_discard = true; });
						logger.info(`ref discard on ${state.playerNames[target]}'s slot ${target_index + 1}`);
					}
				}
			}
			else {
				// Fill-in (anti-finesse)
				logger.info('rank fill in, anti-finesse on slot 1', logCard(state.deck[hand[0]]));
				common.updateThoughts(hand[0], (draft) => { draft.called_to_discard = true; });
			}
		}
	}

	common.good_touch_elim(state);
	common.refresh_links(state);
	common.update_hypo_stacks(state);
	team_elim(game);
}
