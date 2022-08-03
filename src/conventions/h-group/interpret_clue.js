const { determine_focus } = require('./hanabi-logic.js');
const { find_focus_possible, find_own_finesses } = require('./interpret_helper.js');
const { Card } = require('../../basics/Card.js')
const { find_bad_touch, update_hypo_stacks, good_touch_elim } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function interpret_clue(state, action) {
	const { clue, giver, list, target, mistake = false } = action;
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

	let save = false;
	let focus_possible = focused_card.inferred;

	// Try to determine all the possible inferences of the card
	if (focus_possible.length > 1) {
		focus_possible = find_focus_possible(state, giver, target, clue, chop);
		focused_card.intersect('inferred', focus_possible);
		save = focused_card.newly_clued && focused_card.inferred.some(card => focus_possible.some(p => card.matches(p.suitIndex, p.rank) && p.save));
	}
	else if (focus_possible.length === 1) {
		const { suitIndex, rank } = focused_card.inferred[0];
		save = focused_card.newly_clued && (Utils.isCritical(state, suitIndex, rank) || (rank === 2 && chop)) && state.hypo_stacks[suitIndex] + 1 !== rank;
	}
	logger.info('final inference on focused card', focused_card.inferred.map(c => c.toString()).join(','), 'order', focused_card.order, 'save?', save, 'mistake?', mistake);

	// Not a save, so might be a finesse
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
			const card = focused_card.suitIndex !== -1 ? focused_card : focused_card.possible[0];
			const { suitIndex, rank } = card;

			const matches_inference = focused_card.inferred.some(c => c.matches(suitIndex, rank));
			const inferred = focus_possible.find(p => card.matches(p.suitIndex, p.rank));
			const playable = state.hypo_stacks[suitIndex] + (inferred?.connections || []).length === rank;
			const not_trash = rank > state.hypo_stacks[suitIndex] + 1 && rank <= state.max_ranks[suitIndex];

			// Card doesn't match inference, or card isn't playable (and isn't trash)
			if (!matches_inference || (!playable && not_trash)) {
				// Reset inference
				focused_card.inferred = Utils.objClone(focused_card.possible);
				({ feasible, connections } = find_own_finesses(state, giver, target, suitIndex, rank));
				conn_suit = suitIndex;
			}
		}
		// Card clued in our hand and we have exactly one inference
		else if (focused_card.inferred.length === 1) {
			const card = focused_card.inferred[0];
			const { suitIndex, rank } = card;

			const inferred = focus_possible.find(p => card.matches(p.suitIndex, p.rank));
			const playable = state.hypo_stacks[suitIndex] + (inferred?.connections || []).length === rank;
			const not_trash = rank > state.hypo_stacks[suitIndex] + 1 && rank <= state.max_ranks[suitIndex];

			// Card isn't playable
			if (!playable && not_trash) {
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
		const inference = focused_card.inferred[0];
		// Don't elim on the focused card
		good_touch_elim(state.hands[target], focused_card.inferred, {ignore: [focused_card.order], hard: true});

		const focus_result = focus_possible.find(p => inference.matches(p.suitIndex, p.rank));

		// Valid focus and not save
		if (focus_result !== undefined && !save) {
			for (const { type, card } of focus_result.connections || []) {
				if (type === 'finesse') {
					card.finessed = true;
					// focused_card.waiting_finesse_players.push(reacting);
				}
			}

			// Update hypo stacks
			const { suitIndex, rank } = inference;
			logger.debug('updating hypo stack (inference)');
			update_hypo_stacks(state, target, suitIndex, rank);
		}
	}
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
}

module.exports = { interpret_clue };
