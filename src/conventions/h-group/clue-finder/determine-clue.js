const { ACTION, CLUE } = require('../../../constants.js');
const { clue_safe } = require('./clue-safe.js');
const { determine_focus, find_bad_touch } = require('../hanabi-logic.js');
const { isTrash } = require('../../../basics/hanabi-util.js');
const { logger } = require('../../../logger.js');
const Utils = require('../../../util.js');

function determine_clue(state, target, target_card) {
	logger.info('--------');
	logger.info('determining clue to target card', Utils.logCard(target_card));
	const hand = state.hands[target];

	const colour_base = {
		name: 'colour',
		clue: { type: CLUE.COLOUR, value: target_card.suitIndex, target },
		touch: hand.filter(c => c.suitIndex === target_card.suitIndex)
	};

	const rank_base = {
		name: 'rank',
		clue: { type: CLUE.RANK, value: target_card.rank, target },
		touch: hand.filter(c => c.rank === target_card.rank)
	};

	const [colour_result, rank_result] = [colour_base, rank_base].map(base => {
		const { name, clue, touch } = base;
		const result = Object.assign({}, base);

		const bad_touch_cards = find_bad_touch(state, touch.filter(c => !c.clued));		// Ignore cards that were already clued
		result.focused = determine_focus(hand, touch.map(c => c.order), { beforeClue: true }).focused_card.order === target_card.order;

		if (!result.focused) {
			logger.info(`${name} clue doesn't focus, ignoring`);
			return { correct: false };
		}

		// Simulate clue from receiver's POV to see if they have the right interpretation
		const action = { giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue, ignoreStall: true };

		// Prevent outputting logs until we know that the result is correct
		logger.collect();

		logger.info('------- ENTERING HYPO --------');

		let hypo_state = state.simulate_clue(state, action, { simulatePlayerIndex: target, enableLogs: true });

		logger.info('------- EXITING HYPO --------');

		const card_after_cluing = hypo_state.hands[target].find(c => c.order === target_card.order);
		const { inferred: inferred_after_cluing } = card_after_cluing;
		let elim_sum = 0;
		let new_touched = 0;

		// Count the number of cards that have increased elimination (i.e. cards that were "filled in")
		for (let i = 0; i < state.hands[target].length; i++) {
			const old_card = state.hands[target][i];
			const hypo_card = hypo_state.hands[target][i];

			if (hypo_card.clued && hypo_card.inferred.length < old_card.inferred.length && hypo_card.matches_inferences()) {
				if (hypo_card.newly_clued) {
					new_touched++;
				}
				elim_sum++;
			}
		}

		result.interpret = inferred_after_cluing;
		result.correct = hypo_state.hands[target].every(card => {
			// Focused card must match inference
			if (card.order === target_card.order) {
				return !card.reset && card.matches_inferences();
			}

			// Other touched cards can be bad touched/trash or match inference
			if (card.newly_clued) {
				return bad_touch_cards.some(c => c.order === card.order) ||								// Card is bad touched
					card.possible.every(c => isTrash(hypo_state, c.suitIndex, c.rank, card.order)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());											// Card matches interpretation
			}

			if (card.finessed) {
				return card.matches_inferences();
			}

			return true;
		});
		result.elim = elim_sum;
		result.new_touched = new_touched;

		// Print out logs if the result is correct
		logger.flush(result.correct);

		if (!result.correct) {
			logger.info(`${name} clue has incorrect interpretation, ignoring`);
			/*logger.info(hypo_state.hands[target].map(card => {
				if (card.reset || !card.matches_inferences()) {
					logger.info(`card ${Utils.logCard(card)} has inferences [${card.inferred.map(c => Utils.logCard(c)).join(',')}] reset? ${card.reset}`);
					logger.info(Utils.logHand(hypo_state.hands[target]));
				}
				if (!card.possible.every(c => isTrash(hypo_state, c.suitIndex, c.rank, card.order))) {
					logger.info(`${Utils.logCard(card.possible.find(c => !isTrash(hypo_state, c.suitIndex, c.rank, card.order)))} possibility is not trash`);
				}
				return bad_touch_cards.some(c => c.order === card.order) ||							// Card is bad touched
					card.possible.every(c => isTrash(hypo_state, c.suitIndex, c.rank, card.order)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());										// Card matches interpretation
			}));*/
			return { correct: false };
		}

		result.bad_touch = 0;
		result.trash = 0;
		for (const card of hypo_state.hands[target]) {
			if (bad_touch_cards.some(c => c.order === card.order)) {
				// Known trash
				if (card.possible.every(p => isTrash(hypo_state, p.suitIndex, p.rank, card.order))) {
					result.trash++;
				}
				else {
					logger.info(`${Utils.logCard(card)} is bad touch`);
					logger.info(card.possible.map(c => Utils.logCard(c)));
					logger.info(card.possible.find(p => !isTrash(hypo_state, p.suitIndex, p.rank, Utils.logCard(card.order))));
					result.bad_touch++;
				}
			}
		}

		// Re-simulate clue, but from our perspective so we can count the playable cards and finesses correctly
		hypo_state = state.simulate_clue(state, action);

		result.finesses = 0;
		result.playables = [];

		// Count the number of finesses and newly known playable cards
		logger.info(`hypo stacks before clue: ${state.hypo_stacks}`);
		logger.info(`hypo stacks after clue:  ${hypo_state.hypo_stacks}`);
		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			for (let rank = state.hypo_stacks[suitIndex] + 1; rank <= hypo_state.hypo_stacks[suitIndex]; rank++) {
				// Find the card
				let found = false;
				for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
					const hand = state.hands[playerIndex];

					for (let j = 0; j < hand.length; j++) {
						const old_card = hand[j];
						const hypo_card = hypo_state.hands[playerIndex][j];

						// TODO: This might not find the right card if it was duplicated...
						if ((hypo_card.clued || hypo_card.finessed || hypo_card.chop_moved) &&
							hypo_card.matches(suitIndex, rank, { infer: true })
						) {
							if (hypo_card.finessed && !old_card.finessed) {
								result.finesses++;
							}
							result.playables.push({ playerIndex, card: old_card });
							found = true;
							break;
						}
					}

					if (found) {
						break;
					}
				}
			}
		}

		return result;
	});

	const logResult = (result) => {
		const { clue, bad_touch, trash, interpret, elim, new_touched, finesses, playables } = result;
		return {
			clue,
			bad_touch,
			trash,
			interpret: interpret?.map(c => Utils.logCard(c)),
			elim,
			new_touched,
			finesses,
			playables: playables.map(({ playerIndex, card }) => {
				return { player: state.playerNames[playerIndex], card: Utils.logCard(card) };
			})
		};
	};
	if (colour_result.correct) {
		logger.info('colour result', logResult(colour_result));
	}

	if (rank_result.correct) {
		logger.info('rank result', logResult(rank_result));
	}

	let clue_type =
		compare_result('bool', colour_result.correct, rank_result.correct) ||
		compare_result('bool', clue_safe(state, colour_result.clue), clue_safe(state, rank_result.clue)) ||
		compare_result('num', rank_result.bad_touch, colour_result.bad_touch) ||	// Bad touch is bad, so the options are reversed
		compare_result('num', colour_result.finesses, rank_result.finesses) ||
		compare_result('num', colour_result.playables.length, rank_result.playables.length) ||
		compare_result('num', colour_result.new_touched, rank_result.new_touched) ||
		compare_result('num', colour_result.elim, rank_result.elim) ||
		compare_result('num', rank_result.interpret.length, colour_result.interpret.length) || 1;

	if (clue_type === 1) {
		logger.info(`selecting colour clue`);
		return { type: ACTION.COLOUR, value: target_card.suitIndex, target, result: colour_result };
	}
	else if (clue_type === 2) {
		logger.info(`selecting rank clue`);
		return { type: ACTION.RANK, value: target_card.rank, target, result: rank_result };
	}
	else {
		// Clue doesn't work
		return;
	}
}

function compare_result(type, arg1, arg2, fail = false) {
	if (fail) {
		return -1;
	}

	if (type === 'bool') {
		if (arg1 && !arg2) {
			return 1;
		}
		else if (arg2 && !arg1) {
			return 2;
		}
		else if (!arg2 && !arg1) {
			return -1;
		}
	}
	else if (type === 'num') {
		if (arg1 > arg2) {
			return 1;
		}
		else if (arg2 > arg1) {
			return 2;
		}
	}
	return;
}

module.exports = { determine_clue, clue_safe };
