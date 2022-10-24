const { ACTION } = require('../../constants.js');
const { select_play_clue, find_urgent_actions, determine_playable_card } = require('./action-helper.js');
const { find_clues } = require('./clue-finder/clue-finder.js');
const { find_stall_clue } = require('./clue-finder/stall-clues.js');
const { find_chop, inEndgame } = require('./hanabi-logic.js');
const { find_playables, find_known_trash, handLoaded } = require('../../basics/helper.js');
const { getPace } = require('../../basics/hanabi-util.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues } = find_clues(state);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues);

	logger.info('all urgent actions', urgent_actions);

	// Unlock next player
	if (urgent_actions[0].length > 0) {
		Utils.sendCmd('action', urgent_actions[0][0]);
		return;
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < 4; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0) {
				Utils.sendCmd('action', actions[0]);
				return;
			}
		}
	}

	// Then, look for playables, trash and important discards in own hand
	let playable_cards = find_playables(state.play_stacks, hand);
	const trash_cards = find_known_trash(state, state.ourPlayerIndex);
	const discards = playable_cards.filter(pc => {
		return trash_cards.some(tc => tc.order === pc.order) &&
		!playable_cards.some(pc2 => pc2.matches(pc.suitIndex, pc.rank, { infer: true }));	// Not duplicated in our hand (should play first)
	});

	// Remove trash cards from playables
	playable_cards = playable_cards.filter(pc => !trash_cards.some(sc => sc.order === pc.order));
	logger.info('playable cards', Utils.logHand(playable_cards));
	logger.info('trash cards', Utils.logHand(trash_cards));

	// Playing into finesse/bluff
	let best_playable_card, priority;
	if (playable_cards.length > 0) {
		({ card: best_playable_card, priority } = determine_playable_card(state, playable_cards));

		if (priority === 0) {
			Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: best_playable_card.order });
			return;
		}
	}

	// Get a high value play clue
	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		let all_play_clues = play_clues.flat();
		({ clue: best_play_clue, clue_value } = select_play_clue(all_play_clues));

		if (best_play_clue?.result.finesses > 0) {
			const { type, target, value } = best_play_clue;
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}
	}

	// Sarcastic discard to someone else
	if (discards.length > 0) {
		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discards[0].order });
		return;
	}

	// Unlock other player than next
	if (urgent_actions[4].length > 0) {
		Utils.sendCmd('action', urgent_actions[4][0]);
		return;
	}

	// Forced discard if next player is locked without a playable or trash card
	// TODO: Anxiety play
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	if (state.clue_tokens === 0 && state.hands[nextPlayerIndex].isLocked() && !handLoaded(state, nextPlayerIndex)) {
		discard_chop(hand, tableID);
		return;
	}

	// Playing a connecting card or playing a 5
	if (playable_cards.length > 0 && priority <= 3) {
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: best_playable_card.order });
		return;
	}

	// Discard known trash at high pace
	if (trash_cards.length > 0 && getPace(state) > state.numPlayers * 2) {
		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
		return;
	}

	// Playable card with any priority
	if (playable_cards.length > 0) {
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: best_playable_card.order });
		return;
	}

	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? 5 : 8)) {
				// -0.5 if 2 players (allows tempo clues to be given)
				// -10 if endgame
				const minimum_clue_value = 1 - (state.numPlayers === 2 ? 0.5 : 0) - (inEndgame(state) ? 10 : 0);

				if (clue_value >= minimum_clue_value) {
					const { type, target, value } = best_play_clue;
					Utils.sendCmd('action', { tableID, type, target, value });
					return;
				}
				else {
					logger.info('clue too low value', Utils.logClue(best_play_clue), clue_value);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== 8 && urgent_actions[i].length > 0) {
				Utils.sendCmd('action', urgent_actions[i][0]);
				return;
			}
		}
	}

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	const endgame_stall = inEndgame(state) && state.clue_tokens > 0 &&
		state.hypo_stacks.some((stack, index) => stack > state.play_stacks[index]);

	// 8 clues or endgame
	if (state.clue_tokens === 8 || endgame_stall) {
		const { type, value, target } = find_stall_clue(state, 4, best_play_clue);

		// Should always be able to find a clue, even if it's a hard burn
		Utils.sendCmd('action', { tableID, type, target, value });
		return;
	}

	// Discard known trash (no pace requirement)
	if (trash_cards.length > 0) {
		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
		return;
	}

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[8].length > 0) {
		Utils.sendCmd('action', urgent_actions[8][0]);
		return;
	}

	// Locked hand and no good clues to give
	if (state.hands[state.ourPlayerIndex].isLocked() && state.clue_tokens > 0) {
		const { type, value, target } = find_stall_clue(state, 3, best_play_clue);
		Utils.sendCmd('action', { tableID, type, target, value });
		return;
	}

	// Early game
	if (state.early_game && state.clue_tokens > 0) {
		const clue = find_stall_clue(state, 1, best_play_clue);

		if (clue !== undefined) {
			const { type, value, target } = clue;
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}
	}

	discard_chop(hand, tableID);
}

function discard_chop(hand, tableID) {
	// Nothing else to do, so discard chop
	const chopIndex = find_chop(hand);
	logger.debug('discarding chop index', chopIndex);
	let discard;

	if (chopIndex !== -1) {
		discard = hand[chopIndex];
	}
	else {
		discard = hand[Math.floor(Math.random() * hand.length)];
	}

	Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discard.order });
}

module.exports = { take_action };
