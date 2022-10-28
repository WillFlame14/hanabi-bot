import { ACTION } from '../../constants.js';
import { handLoaded } from '../../basics/helper.js';
import logger from '../../logger.js';
import { playableAway } from '../../basics/hanabi-util.js';
import * as Utils from '../../util.js';

/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').ClueResult} ClueResult
 * @typedef {import('../../types.js').Clue} Clue
 * @typedef {import('../../types.js').FixClue} FixClue
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Returns the "value" of the clue result. A higher number means that it is more valuable.
 * 
 * A clue must have value >= 1 to meet Minimum Clue Value Principle (MCVP).
 * @param {ClueResult} clue_result
 */
function find_clue_value(clue_result) {
	const { finesses, new_touched, playables, bad_touch, elim } = clue_result;
	return finesses + 0.5*((new_touched - bad_touch) + playables.length) + 0.01*elim - 1.5*bad_touch;
}

/**
 * Returns the play clue with the highest value.
 * @param {Clue[]} play_clues
 */
export function select_play_clue(play_clues) {
	let best_clue_value = -99;
	let best_clue;

	for (const clue of play_clues) {
		const clue_value = find_clue_value(clue.result);
		logger.info('clue', Utils.logClue(clue), 'value', clue_value);

		if (clue_value > best_clue_value) {
			best_clue_value = clue_value;
			best_clue = clue;
		}
	}

	return { clue: best_clue, clue_value: best_clue_value };
}

/**
 * Determines whether we can play a connecting card into the target's hand.
 * @param {State} state
 * @param {number} target
 * @returns {PerformAction | undefined}	The action to perform if we can do so, otherwise undefined.
 */
function find_unlock(state, target) {
	for (const card of state.hands[target]) {
		const { suitIndex, rank } = card;

		if (playableAway(state, suitIndex, rank) === 1) {
			// See if we have the connecting card (should be certain)
			const our_connecting = state.hands[state.ourPlayerIndex].find(c => c.matches(suitIndex, rank - 1, { infer: true }));

			if (our_connecting !== undefined) {
				// The card must become playable
				const known = card.inferred.every(c => {
					return playableAway(state, c.suitIndex, c.rank) === 0 || c.matches(suitIndex, rank);
				});

				if (known) {
					return { tableID: state.tableID, type: ACTION.PLAY, target: our_connecting.order };
				}
			}
		}
	}
	return;
}

/**
 * Looks for a play clue that can be given to avoid giving a save clue to the target.
 * @param {State} state
 * @param {number} target 				The index of the player that needs a save clue.
 * @param {Clue[]} all_play_clues 		An array of all valid play clues that can be currently given.
 * @returns {PerformAction & {value: number} | undefined}	The play clue to give if it exists, otherwise undefined.
 */
function find_play_over_save(state, target, all_play_clues, locked = false) {
	logger.debug('looking for play over save for target', state.playerNames[target]);

	/** @type {Clue[]} */
	const play_clues = [];

	for (const clue of all_play_clues) {
		const clue_value = find_clue_value(clue.result);
		if (clue_value < (locked ? 0 : 1)) {
			continue;
		}

		const { playables } = clue.result;
		const target_cards = playables.filter(({ playerIndex }) => playerIndex === target).map(p => p.card);
		const immediately_playable = target_cards.find(card => playableAway(state, card.suitIndex, card.rank) === 0);

		logger.debug('examining clue', Utils.logClue(clue), 'with playables', playables.map(play => {
			return { playerIndex: play.playerIndex, card: Utils.logCard(play.card) };
		}));

		// The card can be played without any additional help
		if (immediately_playable !== undefined) {
			play_clues.push(clue);
			continue;
		}

		// Try to see if any target card can be made playable by players between us and them, including themselves
		for (const target_card of target_cards) {
			const { suitIndex } = target_card;
			let found = false;
			let additional_help = 0;

			for (let i = 1; i <= state.numPlayers; i++) {
				const nextPlayer = (state.ourPlayerIndex + i) % state.numPlayers;
				const nextRank = state.play_stacks[suitIndex] + additional_help + 1;

				if (playables.find(({ playerIndex, card }) => playerIndex === nextPlayer && card.matches(suitIndex, nextRank))) {
					if (nextPlayer === target) {
						found = true;
						break;
					}
					else {
						additional_help++;
						continue;
					}
				}

				// We've reached the target's turn and weren't able to find a playable
				if (nextPlayer === target) {
					break;
				}
			}

			if (found) {
				play_clues.push(clue);
				break;
			}
		}
	}

	if (play_clues.length === 0) {
		return;
	}

	const { clue } = select_play_clue(play_clues);
	return { tableID: state.tableID, type: clue.type, target: clue.target, value: clue.value };
}

/**
 * Returns a 2D array of urgent actions in order of descending priority.
 * @param {State} state
 * @param {Clue[][]} play_clues
 * @param {Clue[]} save_clues
 * @param {FixClue[][]} fix_clues
 */
export function find_urgent_actions(state, play_clues, save_clues, fix_clues) {
	const urgent_actions = [[], [], [], [], [], [], [], [], []];

	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;

		// They require a save clue or are locked
		// Urgency: [next, unlock] [next, save only] [next, play/trash fix over save] [next, urgent fix] [other, unlock]
		// (play) (give play if 2+ clues)
		// [other, save only] [other, play/trash fix over save] [all other fixes]
		// (give play if < 2 clues) [early saves]
		if (save_clues[target] !== undefined || state.hands[target].isLocked()) {
			// They already have a playable or trash (i.e. early save)
			if (handLoaded(state, target)) {
				if (save_clues[target] !== undefined) {
					const { type, value } = save_clues[target];
					urgent_actions[8].push({ tableID: state.tableID, type, target, value });
					continue;
				}
			}

			// Try to see if they have a playable card that connects directly through our hand
			// Although this is only optimal for the next player, it is often a "good enough" action for future players.
			const unlock_action = find_unlock(state, target);
			if (unlock_action !== undefined) {
				urgent_actions[i === 1 ? 0 : 4].push(unlock_action);
				continue;
			}

			// Try to give a play clue involving them
			if (state.clue_tokens > 1) {
				const play_over_save = find_play_over_save(state, target, play_clues.flat(), state.hands[target].isLocked());
				if (play_over_save !== undefined) {
					logger.debug('found play over save', Utils.logClue(play_over_save));
					urgent_actions[i === 1 ? 2 : 6].push(play_over_save);
					continue;
				}
			}

			// Give them an urgent fix clue with known trash if possible
			const trash_fix = fix_clues[target].find(clue => clue.urgent && clue.trash);
			if (trash_fix !== undefined) {
				const { type, value } = trash_fix;
				urgent_actions[i === 1 ? 2 : 6].push({ tableID: state.tableID, type, target, value });
				continue;
			}

			// No alternative, have to give save
			if (save_clues[target] !== undefined) {
				const { type, value } = save_clues[target];
				urgent_actions[i === 1 ? 1 : 5].push({ tableID: state.tableID, type, target, value });
			}
		}

		// They require a fix clue
		if (fix_clues[target].length > 0) {
			const urgent_fix = fix_clues[target].find(clue => clue.urgent);

			if (urgent_fix !== undefined) {
				const { type, value } = urgent_fix;

				// Urgent fix on the next player is particularly urgent, but should prioritize urgent fixes for others too
				urgent_actions[i === 1 ? 3 : 7].push({ tableID: state.tableID, type, target, value });
				continue;
			}

			// No urgent fixes required
			const { type, value } = fix_clues[target][0];
			urgent_actions[7].push({ tableID: state.tableID, type, target, value });
		}
	}
	return urgent_actions;
}

/**
 * Returns the playable card with the highest priority, along with its priority.
 * @param {State} state
 * @param {Card[]} playable_cards
 */
export function determine_playable_card(state, playable_cards) {
	/** @type {Card[][]} */
	const priorities = [[], [], [], [], [], []];

	let min_rank = 5;
	for (const card of playable_cards) {
		const possibilities = card.inferred.length > 0 ? card.inferred : card.possible;
		logger.debug(`examining card with possibilities ${possibilities.map(p => Utils.logCard(p)).join(',')}`);

		// Blind play
		if (card.finessed) {
			logger.debug(`adding ${Utils.logCard(card)} to blind play priority`);
			priorities[0].push(card);
			continue;
		}

		let priority = 1;
		for (const inference of possibilities) {
			const { suitIndex, rank } = inference;

			let connected = false;

			// Start at next player so that connecting in our hand has lowest priority
			for (let i = 1; i < state.numPlayers + 1; i++) {
				const target = (state.ourPlayerIndex + i) % state.numPlayers;
				if (state.hands[target].findCards(suitIndex, rank + 1).length > 0) {
					connected = true;

					// Connecting in own hand, demote priority to 2
					if (target === state.ourPlayerIndex) {
						logger.debug(`inference ${Utils.logCard(inference)} connects to own hand`);
						priority = 2;
					}
					else {
						logger.debug(`inference ${Utils.logCard(inference)} connects to other hand`);
					}
					break;
				}
				else {
					logger.debug(`inference ${Utils.logCard(inference)} doesn't connect to ${state.playerNames[target]}`);
				}
			}

			if (!connected) {
				logger.debug(`inference ${Utils.logCard(inference)} doesn't connect`);
				priority = 3;
				break;
			}
		}

		if (priority < 3) {
			priorities[priority].push(card);
			logger.debug(`connecting in ${priority === 1 ? 'other' : 'own'} hand!`);
			continue;
		}

		// Find the lowest possible rank for the card
		const rank = possibilities.reduce((lowest_rank, card) => card.rank < lowest_rank ? card.rank : lowest_rank, 5);

		// Playing a 5
		if (rank === 5) {
			priorities[3].push(card);
			continue;
		}

		// Unknown card
		if (possibilities.length > 1) {
			priorities[4].push(card);
			continue;
		}

		// Other
		if (rank <= min_rank) {
			priorities[5].unshift(card);
			min_rank = rank;
		}
	}

	for (let priority = 0; priority < 6; priority++) {
		const cards = priorities[priority];
		if (cards.length > 0) {
			return { card: cards[0], priority };
		}
	}
}
