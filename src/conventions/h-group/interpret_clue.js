const { determine_focus } = require('./hanabi-logic.js');
const { find_connecting, find_own_finesses } = require('./interpret_helper.js');
const { Card } = require('../../basics/Card.js')
const { CLUE, find_bad_touch, update_hypo_stacks, good_touch_elim } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function interpret_clue(state, action) {
	const { clue, giver, list, target, mistake } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	// Touched cards should also obey good touch principle
	// FIX: Need to do this in a loop to recursively deduce information
	const bad_touch = find_bad_touch(state, giver, target);
	for (const card of state.hands[target]) {
		if (card.inferred.length > 1 && (card.clued || list.includes(card.order))) {
			card.subtract('inferred', bad_touch);
		}
	}
	logger.debug('bad touch', bad_touch.map(c => c.toString()).join(','));

	let found_connecting = false;
	let save = false;

	// Try to determine all the possible inferences of the card
	if (focused_card.inferred.length > 1) {
		const focus_possible = [];
		logger.info('play/hypo/max stacks in clue interpretation:', state.play_stacks, state.hypo_stacks, state.max_ranks);

		if (clue.type === CLUE.COLOUR) {
			const suitIndex = clue.value;
			let next_playable_rank = state.hypo_stacks[suitIndex] + 1;

			// Play clue
			focus_possible.push({ suitIndex, rank: next_playable_rank });

			// Try looking for a connecting card
			let connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);

			while (connecting !== undefined) {
				found_connecting = true;
				// TODO: Use the reacting person to see if they do something urgent instead of playing into finesse
				const { type, reacting, card } = connecting;

				if (type === 'prompt' || type === 'known') {
					state.hypo_stacks[suitIndex]++;
				}
				else if (type === 'finesse') {
					focused_card.waiting_finesse_players.push(reacting);
					card.finessed = true;

					// Even if a finesse is possible, it might not be a finesse
					focus_possible.push({ suitIndex, rank: next_playable_rank });
				}

				next_playable_rank++;
				connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);
			}

			// Our card could be the final rank that we can't find
			if (found_connecting) {
				focus_possible.push({ suitIndex, rank: next_playable_rank });
			}

			// Save clue on chop (5 save cannot be done with number)
			if (chop) {
				for (let rank = next_playable_rank + 1; rank < 5; rank++) {
					// Check if card is critical and not visible in anyone's hand
					if (Utils.isCritical(state, suitIndex, rank)) {
						focus_possible.push({ suitIndex, rank });
						save = true;
					}
				}
			}
		}
		else {
			const rank = clue.value;

			// Play clue
			for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
				let stack_rank = state.hypo_stacks[suitIndex] + 1;

				// TODO: look for 1-away finesse
				if (rank === stack_rank) {
					focus_possible.push({ suitIndex, rank });
				}
				else if (rank > stack_rank) {
					// Try looking for all connecting cards
					let connecting = find_connecting(state, giver, target, suitIndex, stack_rank);
					const connections = [];

					while (connecting !== undefined) {
						connections.push(connecting);
						stack_rank++;
						connecting = find_connecting(state, giver, target, suitIndex, stack_rank);
					}

					// Connected cards can stack up to this rank
					if (rank === stack_rank) {
						for (const connection of connections) {
							// TODO: Use the reacting person to see if they do something urgent instead of playing into finesse
							const { type, reacting, card } = connection;

							if (type === 'prompt' || type === 'known') {
								state.hypo_stacks[suitIndex]++;
							}
							else if (type === 'finesse') {
								focused_card.waiting_finesse_players.push(reacting);
								card.finessed = true;
							}
						}
						focus_possible.push({ suitIndex, rank });
						found_connecting = true;
					}
				}
			}

			// Save clue on chop
			if (chop) {
				for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
					let save2 = false;

					// Determine if it's a 2 save
					if (rank === 2 && state.play_stacks[suitIndex] + 1 !== rank) {
						const duplicates = Utils.visibleFind(state, target, suitIndex, rank);

						// No duplicates found, so can be a 2 save
						if (duplicates.length === 0) {
							save2 = true;
						}
						// Both duplicates found, so can't be a 2 save
						else if (duplicates.length === 2) {
							continue;
						}
						else {
							// Can be a 2 save if the other 2 is in the giver's hand
							save2 = state.hands[giver].some(c => c.order === duplicates[0].order);
						}
					}

					if ((Utils.isCritical(state, suitIndex, rank) && state.play_stacks[suitIndex] + 1 !== rank) || save2) {
						focus_possible.push({ suitIndex, rank });
						save = true;
					}
				}
			}
		}
		focused_card.intersect('inferred', focus_possible);
	}
	logger.info('final inference on focused card', focused_card.inferred.map(c => c.toString()).join(','), 'order', focused_card.order);

	// Not a save, so might be a finesse
	logger.info('save?', save, 'mistake?', mistake);
	if (!save && !mistake) {
		let feasible = false, connections, conn_suit;

		// No idea what the card could be
		if (focused_card.inferred.length === 0) {
			// First, reset inference
			focused_card.inferred = Utils.objClone(focused_card.possible);

			if (target === state.ourPlayerIndex) {
				let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;

				for (const card of focused_card.possible) {
					({ feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank));
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('feasible?', feasible, 'blind plays', blind_plays);

					if (feasible && blind_plays < min_blind_plays) {
						conn_save = connections;
						conn_suit = card.suitIndex;
						min_blind_plays = blind_plays;
					}
				}

				if (conn_save !== undefined) {
					connections = conn_save;
					feasible = true;
				}
			}
			else {
				({ feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank));
				conn_suit = focused_card.suitIndex;
			}

			// No inference, but a finesse isn't possible - default to good touch principle
			if (!feasible) {
				focused_card.inferred = Utils.objClone(focused_card.possible);
				focused_card.subtract('inferred', bad_touch);
				logger.info('no inference on card, defaulting to gtp - ', focused_card.inferred.map(c => c.toString()));
			}
		}
		// We know exactly what card it is
		else if (focused_card.suitIndex !== -1 || focused_card.possible.length === 1) {
			const { suitIndex, rank } = focused_card.suitIndex !== -1 ? focused_card : focused_card.possible[0];

			// Card doesn't match inference, or card isn't playable (and isn't trash)
			if (!focused_card.inferred.some(c => c.matches(suitIndex, rank)) ||
				(!found_connecting && rank > state.hypo_stacks[suitIndex] + 1 && rank <= state.max_ranks[suitIndex])) {
				// Reset inference
				focused_card.inferred = Utils.objClone(focused_card.possible);
				({ feasible, connections } = find_own_finesses(state, giver, target, suitIndex, rank));
				conn_suit = suitIndex;
			}
		}
		// Card clued in our hand and we have exactly one inference
		else if (focused_card.inferred.length === 1) {
			const { suitIndex, rank } = focused_card.inferred[0];

			// Card isn't playable
			if (rank > state.hypo_stacks[suitIndex] + 1 && !found_connecting) {
				// Reset inference
				focused_card.inferred = Utils.objClone(focused_card.possible);
				({ feasible, connections } = find_own_finesses(state, giver, target, suitIndex, rank));
				conn_suit = suitIndex;
			}
		}

		if (feasible) {
			logger.info('finesse possible! suit', conn_suit);
			let next_rank = state.hypo_stacks[conn_suit] + 1;
			for (const connection of connections) {
				const { type, card } = connection;

				card.inferred = [new Card(conn_suit, next_rank)];
				card.finessed = (type === 'finesse');
				next_rank++;

				// Updating notes not on our turn
				if (target !== state.ourPlayerIndex && connection.self) {
					card.reasoning.push(state.actionList.length - 1);
					card.reasoning_turn.push(state.turn_count + 1);
				}
			}
			// Set correct inference on focused card
			focused_card.inferred = [new Card(conn_suit, next_rank)];
		}
	}

	// Focused card only has one possible inference, so remove that possibility from other clued cards via good touch principle
	if (focused_card.inferred.length === 1 && !mistake) {
		// Don't elim on the focused card
		good_touch_elim(state.hands[target], focused_card.inferred, {ignore: [focused_card.order]});

		// Update hypo stacks (need to check if was save?)
		if (!save && found_connecting) {
			const { suitIndex, rank } = focused_card.inferred[0];
			logger.debug('updating hypo stack (inference)');
			update_hypo_stacks(state, target, suitIndex, rank);
		}
	}
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
}

module.exports = { interpret_clue };
