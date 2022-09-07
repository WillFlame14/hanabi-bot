const { determine_focus } = require('./hanabi-logic.js');
const { find_focus_possible, find_own_finesses } = require('./interpret_helper.js');
const { Card } = require('../../basics/Card.js');
const { find_bad_touch, update_hypo_stacks, good_touch_elim } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function interpret_clue(state, action) {
	const { clue, giver, list, target, mistake = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	let fix = false;

	// Touched cards should also obey good touch principle
	let bad_touch = find_bad_touch(state, giver, target);
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
		bad_touch = find_bad_touch(state, giver, target);
	}
	while (bad_touch_len !== bad_touch.length);

	logger.debug('bad touch', bad_touch.map(c => Utils.logCard(c.suitIndex, c.rank)).join(','));
	logger.debug('pre-inferences', focused_card.inferred.map(c => c.toString()).join());

	if (fix || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		return;
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

			if (!save && !stall) {
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
					update_hypo_stacks(state, suitIndex, rank);

					// Inference is known
					if (focused_card.inferred.length === 1) {
						// Don't elim on the focused card
						good_touch_elim(state.hands[target], [{ suitIndex, rank }], {ignore: [focused_card.order], hard: true});
					}
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
		// Check for 8 clue stall
		if (state.clue_tokens === 7 && !list.includes(state.hands[target][0].order) && state.turn_count !== 0) {
			logger.info('8 clue stall!');
		}
		else {
			logger.info(`card ${focused_card.toString()} order ${focused_card.order} doesn't match any inferences!`);
			let feasible = false, connections, conn_suit;

			const trash = (suitIndex, rank) => rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex];

			// Only look for finesses if the card isn't trash
			if (focused_card.inferred.some(c => !trash(c.suitIndex, c.rank))) {
				if (target === state.ourPlayerIndex) {
					let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;

					for (const card of focused_card.inferred) {
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
			}

			// No inference, but a finesse isn't possible - default to good touch principle
			if (!feasible) {
				logger.info('no inference on card, defaulting to gtp - ', focused_card.inferred.map(c => c.toString()));
				focused_card.reset = true;
			}
			else {
				logger.info('playable!');
				let next_rank = state.hypo_stacks[conn_suit] + 1;
				for (const connection of connections) {
					const { type, reacting } = connection;
					// The connections can be cloned, so need to modify the card directly
					const card = Utils.findOrder(state.hands[reacting], connection.card.order);

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

				// Don't elim on the focused card
				good_touch_elim(state.hands[target], [{ conn_suit, next_rank }], {ignore: [focused_card.order], hard: true});
			}
		}
	}
	logger.info('final inference on focused card', focused_card.inferred.map(c => c.toString()).join(','));
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
}

module.exports = { interpret_clue };
