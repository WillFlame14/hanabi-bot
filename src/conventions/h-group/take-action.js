import { ACTION, CLUE } from '../../constants.js';
import { ACTION_PRIORITY, LEVEL } from './h-constants.js';
import { HGroup_Hand as Hand } from '../h-hand.js';
import { select_play_clue, determine_playable_card, order_1s, find_clue_value } from './action-helper.js';
import { find_urgent_actions } from './urgent-actions.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { inEndgame, minimum_clue_value, stall_severity } from './hanabi-logic.js';
import { cardValue, getPace, isTrash, visibleFind } from '../../basics/hanabi-util.js';

import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {State} state
 * @returns {PerformAction}
 */
export function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);

	// Look for playables, trash and important discards in own hand
	let playable_cards = Hand.find_playables(state, state.ourPlayerIndex);
	let trash_cards = Hand.find_known_trash(state, state.ourPlayerIndex).filter(c => c.clued);

	// Discards must be inferred, playable, trash and not duplicated in our hand
	const discards = playable_cards.filter(card => {
		const id = card.identity({ infer: true });

		return id !== undefined &&
			trash_cards.some(c => c.order === card.order) &&
			!playable_cards.some(c => c.matches(id, { infer: true }) && c.order !== card.order);
	});

	// Pick the leftmost of all playable trash cards
	const playable_trash = playable_cards.filter(card => {
		const id = card.identity({ infer: true });
		return id !== undefined && playable_cards.some(c => c.matches(id, { infer: true }) && c.order < card.order);
	});

	// Remove trash from playables (but not playable trash) and discards and playable trash from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order) || playable_trash.some(pt => pt.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order) && !playable_trash.some(pt => pt.order === tc.order));

	if (playable_cards.length > 0) {
		logger.info('playable cards', logHand(playable_cards));
	}
	if (trash_cards.length > 0) {
		logger.info('trash cards', logHand(trash_cards));
	}
	if (discards.length > 0) {
		logger.info('discards', logHand(discards));
	}

	const playable_priorities = determine_playable_card(state, playable_cards);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, stall_clues, playable_priorities);

	if (urgent_actions.some(actions => actions.length > 0)) {
		logger.info('all urgent actions', urgent_actions.map((actions, index) => actions.map(action => { return { [index]: logPerformAction(action) }; })).flat());
	}

	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
	const actionPrioritySize = Object.keys(ACTION_PRIORITY).length;

	/** @type {Card} */
	let best_playable_card;
	if (priority !== -1) {
		best_playable_card = playable_priorities[priority][0];

		// Best playable card is an unknown 1, so we should order correctly
		if (best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
			const ordered_1s = order_1s(state, playable_cards);
			if (ordered_1s.length > 0) {
				let best_ocm_index = 0, best_ocm_value = -0.1;

				if (state.level >= LEVEL.BASIC_CM) {
					// Try to find a non-negative value OCM
					for (let i = 1; i < ordered_1s.length; i++) {
						const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

						if (playerIndex === state.ourPlayerIndex) {
							break;
						}

						const old_chop = state.hands[playerIndex].chop();
						// Player is locked, OCM is meaningless
						if (old_chop === undefined) {
							continue;
						}
						const old_chop_value = cardValue(state, old_chop);

						const newHand = state.hands[playerIndex].clone();
						newHand.chop().chop_moved = true;

						const new_chop = newHand.chop();
						const new_chop_value = new_chop ? cardValue(state, new_chop) : Hand.isLoaded(state, playerIndex) ? 0 : 4;

						const ocm_value = old_chop_value - new_chop_value;

						if (!isTrash(state, state.ourPlayerIndex, old_chop, old_chop.order) && ocm_value > best_ocm_value) {
							best_ocm_index = i;
							best_ocm_value = ocm_value;
						}
					}
				}

				if (best_ocm_index !== 0) {
					logger.highlight('yellow', `performing ocm by playing ${best_ocm_index + 1}'th 1`);
				}

				best_playable_card = ordered_1s[best_ocm_index];
			}
		}

		if (state.level >= LEVEL.INTERMEDIATE_FINESSES) {
			while (priority === 0) {
				const older_finesse = hand.find(c => c.finessed && c.finesse_index < best_playable_card.finesse_index);

				if (older_finesse === undefined) {
					break;
				}

				logger.warn('older finesse', logCard(older_finesse), 'could be layered, unable to play newer finesse', logCard(best_playable_card));

				// Remove from playable cards
				playable_priorities[priority].splice(playable_priorities[priority].findIndex(c => c.order === best_playable_card.order), 1);
				playable_cards.splice(playable_cards.findIndex(c => c.order === best_playable_card.order), 1);

				// Find new best playable card
				priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
				if (priority !== -1) {
					best_playable_card = playable_priorities[priority][0];
				}
				else {
					best_playable_card = undefined;
				}
			}
		}

		if (priority !== -1) {
			logger.info(`best playable card is order ${best_playable_card.order}, inferences ${best_playable_card.inferred.map(c => logCard(c))}`);
		}
	}

	// Playing into finesse/bluff
	if (playable_cards.length > 0 && priority === 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Unlock next player
	if (urgent_actions[ACTION_PRIORITY.UNLOCK].length > 0) {
		return urgent_actions[ACTION_PRIORITY.UNLOCK][0];
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < actionPrioritySize; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0) {
				return actions[0];
			}
		}
	}

	// Get a high value play clue
	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		const all_play_clues = play_clues.flat();
		({ clue: best_play_clue, clue_value } = select_play_clue(all_play_clues));

		if (best_play_clue?.result.finesses > 0) {
			return Utils.clueToAction(best_play_clue, tableID);
		}
	}

	// Sarcastic discard to someone else
	if (state.level >= LEVEL.SARCASTIC && discards.length > 0) {
		const identity = discards[0].identity({ infer: true });
		const duplicates = visibleFind(state, state.ourPlayerIndex, identity, { ignore: [state.ourPlayerIndex] }).filter(c => c.clued);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (inEndgame(state) && duplicates.every(c => c.inferred.length === 0 || (c.inferred.length === 1 && c.inferred[0].matches(identity)))) {
			return { tableID, type: ACTION.PLAY, target: discards[0].order };
		}

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize].length > 0) {
		return urgent_actions[ACTION_PRIORITY.UNLOCK + actionPrioritySize][0];
	}

	// Forced discard if next player is locked
	// TODO: Anxiety play
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	if (state.clue_tokens === 0 && Hand.isLocked(state, nextPlayerIndex)) {
		discard_chop(state, state.ourPlayerIndex, tableID);
	}

	// Playing a connecting card or playing a 5
	if (best_playable_card !== undefined && priority <= 3) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Discard known trash at high pace, low clues
	if (trash_cards.length > 0 && getPace(state) > state.numPlayers * 2 && state.clue_tokens <= 2) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Give TCCM on a valuable card that moves chop to trash
	if (state.level >= LEVEL.TEMPO_CLUES && state.numPlayers > 2 && state.clue_tokens > 0) {
		for (const clue of stall_clues[1]) {
			const { target } = clue;

			// Chop doesn't exist or is trash, ignore
			if (state.hands[target].chop() === undefined || Hand.chopValue(state, target) === 0) {
				continue;
			}

			const hypo_state = state.minimalCopy();
			hypo_state.hands[target].chop().chop_moved = true;

			if (Hand.chopValue(hypo_state, target) === 0) {
				logger.highlight('yellow', `performing tccm on ${logCard(state.hands[target].chop())}`);
				return Utils.clueToAction(clue, tableID);
			}
		}
	}

	// Any play clue in 2 players
	if (state.numPlayers === 2 && state.clue_tokens > 0 && (best_play_clue || stall_clues[1].length > 0)) {
		return Utils.clueToAction(best_play_clue ?? Utils.maxOn(stall_clues[1], clue => find_clue_value(clue.result)), tableID);
	}

	// Playable card with any priority
	if (best_playable_card !== undefined) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? actionPrioritySize + 1 : actionPrioritySize * 2) && best_play_clue !== undefined) {
				if (clue_value >= minimum_clue_value(state)) {
					return Utils.clueToAction(best_play_clue, tableID);
				}
				else {
					logger.info('clue too low value', logClue(best_play_clue), clue_value);
					stall_clues[1].push(best_play_clue);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== actionPrioritySize * 2 && urgent_actions[i].length > 0) {
				return urgent_actions[i][0];
			}
		}
	}

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	// Discard known trash (no pace requirement)
	if (trash_cards.length > 0 && !inEndgame(state) && state.clue_tokens < 8) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[actionPrioritySize * 2].length > 0) {
		return urgent_actions[actionPrioritySize * 2][0];
	}

	const severity = stall_severity(state, state.ourPlayerIndex);
	const endgame_stall = inEndgame(state) && state.hypo_stacks[state.ourPlayerIndex].some((stack, index) => stack > state.play_stacks[index]);

	// Stalling situations
	if (state.clue_tokens > 0 && (severity > 0 || endgame_stall)) {
		const validStall = stall_clues.find((clues, index) => (index <= severity && clues.length > 0))?.[0];

		// 8 clues, must stall
		if (state.clue_tokens === 8) {
			return validStall ? Utils.clueToAction(validStall, tableID) :
				{ type: ACTION.RANK, value: state.hands[nextPlayerIndex].at(-1).rank, target: nextPlayerIndex, tableID };
		}

		if (validStall) {
			return Utils.clueToAction(validStall, tableID);
		}
	}

	// Discarding known trash is still preferable to chop
	if (trash_cards.length > 0) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	return discard_chop(state, state.ourPlayerIndex, tableID);
}

/**
 * Discards the card on chop for the given playerIndex.
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} tableID
 */
function discard_chop(state, playerIndex, tableID) {
	// Nothing else to do, so discard chop
	const discard = state.hands[playerIndex].chop() ?? Hand.locked_discard(state, playerIndex);

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
