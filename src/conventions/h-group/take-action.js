import { ACTION } from '../../constants.js';
import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { select_play_clue, find_urgent_actions, determine_playable_card, order_1s } from './action-helper.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { find_stall_clue } from './clue-finder/stall-clues.js';
import { find_chop, inEndgame } from './hanabi-logic.js';
import { find_playables, find_known_trash, handLoaded } from '../../basics/helper.js';
import { getPace, visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../logger.js';
import * as Utils from '../../util.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {State} state
 * @return {PerformAction}
 */
export function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues } = find_clues(state);

	// Look for playables, trash and important discards in own hand
	let playable_cards = find_playables(state.play_stacks, hand);
	let trash_cards = find_known_trash(state, state.ourPlayerIndex).filter(c => c.clued);

	const discards = [];
	for (const card of playable_cards) {
		const id = card.identity({ infer: true });

		// Skip non-trash cards and cards we don't know the identity of
		if (!trash_cards.some(c => c.order === card.order) || id === undefined) {
			continue;
		}

		// If there isn't a matching playable card in our hand, we should discard it to sarcastic for someone else
		if (!playable_cards.some(c => c.matches(id.suitIndex, id.rank, { infer: true }) && c.order !== card.order)) {
			discards.push(card);
		}
	}

	// Remove trash cards from playables and discards from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order));

	if (playable_cards.length > 0) {
		logger.info('playable cards', Utils.logHand(playable_cards));
	}
	if (trash_cards.length > 0) {
		logger.info('trash cards', Utils.logHand(trash_cards));
	}
	if (discards.length > 0) {
		logger.info('discards', Utils.logHand(discards));
	}

	const playable_priorities = determine_playable_card(state, playable_cards);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

	if (urgent_actions.some(actions => actions.length > 0)) {
		logger.info('all urgent actions', urgent_actions.map((actions, index) => actions.map(action => { return { [index]: action }; })).flat());
	}

	const priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);

	/** @type {Card} */
	let best_playable_card;
	if (priority !== -1) {
		best_playable_card = playable_priorities[priority][0];

		// Best playable card is an unknown 1, so we should order correctly
		if (best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
			const ordered_1s = order_1s(state, playable_cards);
			if (ordered_1s.length > 0) {
				best_playable_card = ordered_1s[0];
			}
		}

		logger.info(`best playable card is order ${best_playable_card.order}, inferences ${best_playable_card.inferred.map(c => Utils.logCard(c))}`);
	}

	// Playing into finesse/bluff
	if (playable_cards.length > 0 && priority === 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Unlock next player
	if (urgent_actions[0].length > 0) {
		return urgent_actions[0][0];
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < 4; i++) {
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
		const { suitIndex, rank } = discards[0].identity({ infer: true });
		const duplicates = visibleFind(state, state.ourPlayerIndex, suitIndex, rank, { ignore: [state.ourPlayerIndex] }).filter(c => c.clued);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (inEndgame(state) && duplicates.every(c => c.inferred.length === 0 || (c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank)))) {
			return { tableID, type: ACTION.PLAY, target: discards[0].order };
		}

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[4].length > 0) {
		return urgent_actions[4][0];
	}

	// Forced discard if next player is locked without a playable or trash card
	// TODO: Anxiety play
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	if (state.clue_tokens === 0 && state.hands[nextPlayerIndex].isLocked(state) && !handLoaded(state, nextPlayerIndex)) {
		discard_chop(hand, tableID);
	}

	// Playing a connecting card or playing a 5
	if (playable_cards.length > 0 && priority <= 3) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Discard known trash at high pace, low clues
	if (trash_cards.length > 0 && getPace(state) > state.numPlayers * 2 && state.clue_tokens <= 3) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Playable card with any priority
	if (playable_cards.length > 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? 5 : 8) && best_play_clue !== undefined) {
				// -0.5 if 2 players (allows tempo clues to be given)
				// -10 if endgame
				const minimum_clue_value = 1 - (state.numPlayers === 2 ? 0.5 : 0) - (inEndgame(state) ? 10 : 0);

				if (clue_value >= minimum_clue_value) {
					return Utils.clueToAction(best_play_clue, state.tableID);
				}
				else {
					logger.info('clue too low value', Utils.logClue(best_play_clue), clue_value);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== 8 && urgent_actions[i].length > 0) {
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
	if (state.clue_tokens > 0 && urgent_actions[8].length > 0) {
		return urgent_actions[8][0];
	}

	// Stalling situations
	if (state.clue_tokens > 0) {
		// 8 clues
		if (state.clue_tokens === 8) {
			return Utils.clueToAction(find_stall_clue(state, 4, best_play_clue), state.tableID);
		}

		// Locked hand
		if (state.hands[state.ourPlayerIndex].isLocked(state)) {
			return Utils.clueToAction(find_stall_clue(state, 3, best_play_clue), state.tableID);
		}

		// Endgame (and stalling is effective)
		if (inEndgame(state) && state.hypo_stacks.some((stack, index) => stack > state.play_stacks[index])) {
			return Utils.clueToAction(find_stall_clue(state, 2, best_play_clue), state.tableID);
		}

		// Early game
		if (state.early_game) {
			const clue = find_stall_clue(state, 1, best_play_clue);

			if (clue !== undefined) {
				return Utils.clueToAction(clue, state.tableID);
			}
		}
	}

	return discard_chop(hand, tableID);
}

/**
 * Discards the card on chop from the hand.
 * @param {Hand} hand
 * @param {number} tableID
 */
function discard_chop(hand, tableID) {
	// Nothing else to do, so discard chop
	const chopIndex = find_chop(hand);
	const discard = (chopIndex !== -1) ? hand[chopIndex] : hand[Math.floor(Math.random() * hand.length)];

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
