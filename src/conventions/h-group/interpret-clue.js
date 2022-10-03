const { CLUE } = require('../../constants.js');
const { find_clues } = require('./clue-finder/clue-finder.js');
const { determine_focus } = require('./hanabi-logic.js');
const { find_focus_possible, find_own_finesses } = require('./interpret-helper.js');
const { Card } = require('../../basics/Card.js');
const { bad_touch_possiblities, update_hypo_stacks, good_touch_elim } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function stalling_situation(state, action) {
	const { clue, giver, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	let severity = 0;

	if (state.clue_tokens === 7) {
		severity = 4;
	}
	else if (state.hands[giver].every(c => c.clued || c.chop_moved)) {
		severity = 3;
	}
	else if (state.early_game) {
		severity = 1;
	}

	// Not a stalling situation
	if (severity === 0) {
		return false;
	}

	logger.info('severity', severity);

	const stall = function () {
		// 5 Stall given
		if (clue.type === CLUE.RANK && clue.value === 5) {
			logger.info('5 stall!');
			return true;
		}

		if (severity >= 2) {
			// 5 Stall was available
			if (state.hands[target].some(c => c.rank === 5 && !c.clued)) {
				logger.info('5 stall was available but not given, so must not be stall');
				return false;
			}

			// Fill-in given
			// Tempo clue given

			if (severity >= 3) {
				// Tempo clue was available
				/*if (play_clues.some(clues => clues.some(clue => clue.bad_touch < 2))) {
					logger.info('tempo was available but not given, so must not be stall');
					return false;
				}*/

				// Locked hand stall given
				if (chop) {
					logger.info('locked hand stall!');
					return true;
				}

				if (severity === 4) {
					// 8 clue save given
					if (!list.includes(state.hands[target][0].order)) {
						logger.info('8 clue stall!');
						return true;
					}
					// 8 clue save was available
				}
				// Locked hand stall was available
			}
			// Fill-in was available

			// Hard burn given
			if (!focused_card.newly_clued) {
				logger.info('hard burn!');
				return true;
			}
		}
	};

	// Check at the very end - only if the conditions are right for a stall, then see if a play/save could have been given
	if (stall()) {
		const { play_clues, save_clues } = find_clues(state, { ignorePlayerIndex: giver, ignoreCM: true });

		// There was a play (no bad touch, not tempo) or save available
		if (play_clues.some(clues => clues.some(clue => clue.bad_touch === 0 && clue.result.new_touched > 0)) ||
			save_clues.some(clue => clue !== undefined)
		) {
			logger.info('play or save available, not interpreting stall');
			return false;
		}
		else {
			return true;
		}
	}
	return false;
}

function interpret_clue(state, action, options = {}) {
	const { clue, giver, list, target, mistake = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	let fix = false;

	// Touched cards should also obey good touch principle
	let bad_touch = bad_touch_possiblities(state, giver, target);
	let bad_touch_len;

	// Recursively deduce information until no new information is learned
	do {
		bad_touch_len = bad_touch.length;
		for (const card of state.hands[target]) {
			if (card.inferred.length > 1 && (card.clued || list.includes(card.order))) {
				card.subtract('inferred', bad_touch);
			}

			// Lost all inferences (fix), revert to good touch principle
			if (list.includes(card.order) && !card.newly_clued && card.inferred.length === 0 && !card.reset) {
				fix = true;
				card.inferred = Utils.objClone(card.possible);
				card.subtract('inferred', bad_touch);
				card.reset = true;
			}
		}
		bad_touch = bad_touch_possiblities(state, giver, target, bad_touch);
	}
	while (bad_touch_len !== bad_touch.length);

	logger.debug('bad touch', bad_touch.map(c => Utils.logCard(c.suitIndex, c.rank)).join(','));
	logger.debug('pre-inferences', focused_card.inferred.map(c => c.toString()).join());

	if (fix || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focused_card.inferred.length === 1) {
			const { suitIndex, rank } = focused_card.inferred[0];
			update_hypo_stacks(state);
			team_elim(state, focused_card, giver, target, suitIndex, rank);
		}
		return;
	}

	if (!options.ignoreStall && state.turn_count !== 0 && stalling_situation(state, action)) {
		return;
	}

	// Trash chop move
	if (focused_card.newly_clued && focused_card.possible.every(c => Utils.isBasicTrash(state, c.suitIndex, c.rank))) {
		let oldest_trash_index;
		// Find the oldest newly clued trash
		for (let i = state.hands[target].length - 1; i >= 0; i--) {
			const card = state.hands[target][i];

			if (card.newly_clued && card.possible.every(c => Utils.isBasicTrash(state, c.suitIndex, c.rank))) {
				oldest_trash_index = i;
				break;
			}
		}

		logger.info(`oldest trash card is ${state.hands[target][oldest_trash_index].toString()}`);

		// Chop move every unclued card to the right of this
		for (let i = oldest_trash_index + 1; i < state.hands[target].length; i++) {
			const card = state.hands[target][i];

			if (!card.clued) {
				card.chop_moved = true;
				logger.info(`trash chop move on ${card.toString()}`);
			}
		}
		return;
	}
	// 5's chop move
	else if (clue.type === CLUE.RANK && clue.value === 5 && !state.early_game) {
		logger.info('interpreting potential 5cm');
		// Find the oldest 5 clued and its distance from chop
		let found_chop = false;
		let chop_card;

		for (let i = state.hands[target].length - 1; i >= 0; i--) {
			const card = state.hands[target][i];

			// Skip finessed and previously clued cards
			if (card.finessed || (card.clued && !card.newly_clued)) {
				logger.info('skipping card', card.toString());
				continue;
			}

			// First unclued or newly clued card is chop
			if (!found_chop) {
				const { suitIndex, rank, order } = card;
				// If we aren't the target, we can see the card being chop moved
				if (target !== state.ourPlayerIndex && Utils.isTrash(state, suitIndex, rank, order)) {
					logger.info(`chop ${card.toString()} is trash, not interpreting 5cm`);
					break;
				}
				found_chop = true;
				chop_card = card;
				continue;
			}

			// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
			if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
				logger.info(`5cm, saving ${chop_card.toString()}`);
				chop_card.chop_moved = true;
				return;
			}

			// We found a 5 that doesn't meet 5cm requirements, so it might be a play
			logger.info(`not 5cm`);
			break;
		}
	}

	const focus_possible = find_focus_possible(state, giver, target, clue, chop, focused_card);
	logger.info('focus possible', focus_possible.map(p => Utils.logCard(p.suitIndex, p.rank)).join(','));
	let matched_inferences;

	if (target === state.ourPlayerIndex) {
		matched_inferences = focus_possible.filter(p => focused_card.inferred.some(c => c.matches(p.suitIndex, p.rank)));
	}
	else {
		matched_inferences = focus_possible.filter(p => focused_card.matches(p.suitIndex, p.rank));
	}

	// Card matches an inference and not a save/stall
	if (matched_inferences.length >= 1) {
		focused_card.intersect('inferred', focus_possible);

		for (const inference of matched_inferences) {
			const { suitIndex, rank, save = false, stall = false, connections } = inference;

			// A play clue interpretation will be blocked by a save/stall clue interpretation
			// if the first connection is a self-prompt/finesse
			const blocking_interpretation = function (inf) {
				return matched_inferences.some(p => p.suitIndex === inf.suitIndex && p.rank === inf.rank
					&& (p.save || p.stall) && inf.connections[0].reacting === target);
			};

			if (!save && !stall && !blocking_interpretation(inference)) {
				let next_rank = state.play_stacks[suitIndex] + 1;
				for (const connection of connections) {
					const { type, reacting } = connection;
					// The connections can be cloned, so need to modify the card directly
					const card = Utils.findOrder(state.hands[reacting], connection.card.order);

					logger.info(`connecting on ${card.toString()} order ${card.order} type ${type}`);
					if (type === 'finesse') {
						card.finessed = true;
						card.inferred = [new Card(suitIndex, next_rank)];
					}
					next_rank++;
				}

				// Only one inference, we can update hypo stacks
				if (matched_inferences.length === 1) {
					logger.debug('updating hypo stack (inference)');
					update_hypo_stacks(state);
					team_elim(state, focused_card, giver, target, suitIndex, rank);
				}
				// Multiple inferences, we need to wait for connections
				else if (connections.length > 0 && !connections[0].self) {
					state.waiting_connections.push({ connections, focused_card, inference });
				}
			}
		}
	}
	// Card doesn't match any inferences
	else {
		logger.info(`card ${focused_card.toString()} order ${focused_card.order} doesn't match any inferences!`);
		let all_connections = [];
		logger.info(`inferences ${focused_card.inferred.map(c => c.toString()).join(',')}`);

		if (target === state.ourPlayerIndex) {
			// Only look for finesses if the card isn't trash
			if (focused_card.inferred.some(c => !Utils.isBasicTrash(state, c.suitIndex, c.rank))) {
				// We are the clue target, so we need to consider all the possibilities of the card
				let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;
				let self = true;

				for (const card of focused_card.inferred) {
					const { feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank);
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('feasible?', feasible, 'blind plays', blind_plays);

					if (feasible) {
						// Starts with self-finesse or self-prompt
						if (connections[0]?.self) {
							// TODO: This interpretation should always exist, but must wait for all players to ignore first
							if (self && blind_plays < min_blind_plays) {
								conn_save = { connections, conn_suit: card.suitIndex };
								min_blind_plays = blind_plays;
							}
						}
						// Doesn't start with self
						else {
							// Temp: if a connection with no self-component exists, don't consider any connection with a self-component
							self = false;
							all_connections.push({ connections, conn_suit: card.suitIndex });
						}
					}
				}

				if (self && conn_save !== undefined) {
					all_connections.push(conn_save);
				}
			}
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!Utils.isBasicTrash(state, focused_card.suitIndex, focused_card.rank)) {
			const { feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank);
			if (feasible) {
				all_connections.push({ connections, conn_suit: focused_card.suitIndex });
			}
		}

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focused_card.inferred.map(c => c.toString()));
				focused_card.reset = true;
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focused_card.inferred;
				focused_card.intersect('inferred', focus_possible);

				if (focused_card.inferred.length === 0) {
					focused_card.inferred = saved_inferences;
				}
				logger.info('no inference on card (other), looks like', focused_card.inferred.map(c => c.toString()).join(','));
			}
		}
		else {
			logger.info('playable!');
			focused_card.inferred = [];

			for (const { connections, conn_suit } of all_connections) {
				let next_rank = state.play_stacks[conn_suit] + 1;
				for (const connection of connections) {
					const { type, reacting } = connection;
					// The connections can be cloned, so need to modify the card directly
					const card = Utils.findOrder(state.hands[reacting], connection.card.order);

					card.inferred = [new Card(conn_suit, next_rank)];
					card.finessed = (type === 'finesse');
					next_rank++;

					// Updating notes not on our turn
					if (connection.self) {
						// There might be multiple possible inferences on the same card from a self component
						if (card.reasoning.at(-1) !== state.actionList.length - 1) {
							card.reasoning.push(state.actionList.length - 1);
							card.reasoning_turn.push(state.turn_count + 1);
						}
					}
				}

				// Add inference to focused card
				focused_card.union('inferred', [new Card(conn_suit, next_rank)]);

				// Only one set of connections, so can elim safely
				if (all_connections.length === 1) {
					update_hypo_stacks(state);
					team_elim(state, focused_card, giver, target, conn_suit, next_rank);
				}
				// Multiple possible sets, we need to wait for connections
				else {
					const inference = { suitIndex: conn_suit, rank: next_rank };
					state.waiting_connections.push({ connections, focused_card, inference });
				}
			}
		}
	}
	logger.info('final inference on focused card', focused_card.inferred.map(c => c.toString()).join(','));
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
}

function team_elim(state, focused_card, giver, target, suitIndex, rank) {
	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		// Giver cannot elim own cards
		if (i === giver) {
			continue;
		}

		// Target can elim only if inference is known, everyone else can elim
		if (i !== target || focused_card.inferred.length === 1) {
			// Don't elim on the focused card
			good_touch_elim(hand, [{ suitIndex, rank }], {ignore: [focused_card.order], hard: true});
		}
	}
}

module.exports = { interpret_clue };
