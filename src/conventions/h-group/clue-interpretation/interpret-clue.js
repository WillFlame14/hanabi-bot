const { CLUE } = require('../../../constants.js');
const { interpret_tcm, interpret_5cm } = require('./interpret-cm.js');
const { stalling_situation } = require('./interpret-stall.js');
const { determine_focus } = require('../hanabi-logic.js');
const { find_focus_possible } = require('./focus-possible.js');
const { find_own_finesses } = require('./connecting-cards.js');
const { Card } = require('../../../basics/Card.js');
const { bad_touch_possiblities, update_hypo_stacks, good_touch_elim } = require('../../../basics/helper.js');
const { isBasicTrash, isTrash } = require('../../../basics/hanabi-util.js');
const { logger } = require('../../../logger.js');
const Basics = require('../../../basics.js');
const Utils = require('../../../util.js');

function apply_good_touch(state, action) {
	const { giver, list, target } = action;
	let fix = false;

	const had_inferences = [];

	for (const card of state.hands[target]) {
		if (card.inferred.length > 0) {
			had_inferences.push(card.order);
		}
	}

	Basics.onClue(state, action);

	// Touched cards should also obey good touch principle
	let bad_touch = bad_touch_possiblities(state, giver, target);
	let bad_touch_len;

	// Recursively deduce information until no new information is learned
	do {
		bad_touch_len = bad_touch.length;
		for (const card of state.hands[target]) {
			if (card.inferred.length > 1 && (card.clued || card.chop_moved)) {
				card.subtract('inferred', bad_touch);
			}

			// Lost all inferences (fix), revert to good touch principle (must not have been known trash)
			if (card.inferred.length === 0 && had_inferences.includes(card.order) && list.includes(card.order) &&
				!card.newly_clued && !card.reset
			) {
				fix = true;
				card.inferred = Utils.objClone(card.possible);
				card.subtract('inferred', bad_touch);
				card.reset = true;
			}

			// Directly fixing duplicates (if we're using an inference, the card must match the inference, unless it's unknown)
			// (card.inferred.length === 1 && (target === state.ourPlayerIndex || card.matches_inferences()))
			if (!fix && list.includes(card.order) && card.possible.length === 1) {
				const { suitIndex, rank } = card.possible[0];

				// The fix can be in anyone's hand
				for (const hand of state.hands) {
					for (const c of hand) {
						if ((c.clued || c.finessed) && c.matches(suitIndex, rank, { infer: true }) && c.order !== card.order) {
							fix = true;
							break;
						}
					}
					if (fix) {
						break;
					}
				}
			}
		}
		bad_touch = bad_touch_possiblities(state, giver, target, bad_touch);
	}
	while (bad_touch_len !== bad_touch.length);

	logger.debug('bad touch', bad_touch.map(c => Utils.logCard(c)).join(','));
	return fix;
}

function interpret_clue(state, action) {
	const { clue, giver, list, target, mistake = false, ignoreStall = false } = action;
	const fix = apply_good_touch(state, action);

	const { focused_card } = determine_focus(state.hands[target], list);

	if (focused_card.inferred.length === 0) {
		focused_card.inferred = Utils.objClone(focused_card.possible);
		logger.error('focused card had no inferences after applying good touch');
	}

	logger.debug('pre-inferences', focused_card.inferred.map(c => Utils.logCard(c)).join());

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

	// Check if the giver was in a stalling situation
	if (!ignoreStall && stalling_situation(state, action)) {
		logger.info('stalling situation');
		update_hypo_stacks(state);
		return;
	}

	// Trash chop move
	if (focused_card.newly_clued && focused_card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank, focused_card.order, { infer: false }))) {
		interpret_tcm(state, target);
		return;
	}
	// 5's chop move
	else if (clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued) {
		if (interpret_5cm(state, giver, target)) {
			return;
		}
	}

	const focus_possible = find_focus_possible(state, action);
	logger.info('focus possible', focus_possible.map(p => Utils.logCard(p)).join(','));
	const matched_inferences = focus_possible.filter(p => {
		if (target === state.ourPlayerIndex) {
			return focused_card.inferred.some(c => c.matches(p.suitIndex, p.rank));
		}
		else {
			return focused_card.matches(p.suitIndex, p.rank);
		}
	});

	// Card matches an inference and not a save/stall
	if (matched_inferences.length >= 1) {
		focused_card.intersect('inferred', focus_possible);

		for (const inference of matched_inferences) {
			const { suitIndex, rank, save = false, stall = false, connections } = inference;

			if (!save && !stall) {
				assign_connections(state, connections, suitIndex);

				// Only one inference, we can update hypo stacks
				if (matched_inferences.length === 1) {
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
		logger.info(`card ${Utils.logCard(focused_card)} order ${focused_card.order} doesn't match any inferences!`);
		let all_connections = [];
		logger.info(`inferences ${focused_card.inferred.map(c => Utils.logCard(c)).join(',')}`);

		if (target === state.ourPlayerIndex) {
			// Only look for finesses if the card isn't trash
			if (focused_card.inferred.some(c => !isBasicTrash(state, c.suitIndex, c.rank))) {
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
		else if (!isBasicTrash(state, focused_card.suitIndex, focused_card.rank)) {
			const { feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank);
			if (feasible) {
				all_connections.push({ connections, conn_suit: focused_card.suitIndex });
			}
		}

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			focused_card.reset = true;
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focused_card.inferred.map(c => Utils.logCard(c)));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focused_card.inferred;
				focused_card.intersect('inferred', focus_possible);

				if (focused_card.inferred.length === 0) {
					focused_card.inferred = saved_inferences;
				}
				logger.info('no inference on card (other), looks like', focused_card.inferred.map(c => Utils.logCard(c)).join(','));
			}
		}
		else {
			logger.info('playable!');
			focused_card.inferred = [];

			for (const { connections, conn_suit } of all_connections) {
				assign_connections(state, connections, conn_suit);
				const inference_rank = state.play_stacks[conn_suit] + 1 + connections.length;

				// Add inference to focused card
				focused_card.union('inferred', [new Card(conn_suit, inference_rank)]);

				// Only one set of connections, so can elim safely
				if (all_connections.length === 1) {
					team_elim(state, focused_card, giver, target, conn_suit, inference_rank);
				}
				// Multiple possible sets, we need to wait for connections
				else {
					const inference = { suitIndex: conn_suit, rank: inference_rank };
					state.waiting_connections.push({ connections, focused_card, inference });
				}
			}
		}
	}
	logger.info('final inference on focused card', focused_card.inferred.map(c => Utils.logCard(c)).join(','));
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
	update_hypo_stacks(state);
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

function assign_connections(state, connections, suitIndex) {
	let next_rank = state.play_stacks[suitIndex] + 1;
	for (const connection of connections) {
		const { type, reacting, self } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = state.hands[reacting].findOrder(connection.card.order);

		logger.info(`connecting on ${Utils.logCard(card)} order ${card.order} type ${type}`);

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		card.old_inferred = Utils.objClone(card.inferred);
		card.inferred = [new Card(suitIndex, next_rank)];

		if (type === 'finesse') {
			card.finessed = true;
		}

		next_rank++;

		// Updating notes not on our turn
		if (self) {
			// There might be multiple possible inferences on the same card from a self component
			if (card.reasoning.at(-1) !== state.actionList.length - 1) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count + 1);
			}
		}
	}
}

module.exports = { interpret_clue };
