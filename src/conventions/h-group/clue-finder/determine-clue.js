const { CLUE } = require('../../../constants.js');
const { clue_safe } = require('./clue-safe.js');
const { determine_focus, find_bad_touch } = require('../hanabi-logic.js');
const { cardTouched, isCluable } = require('../../../variants.js');
const { isTrash } = require('../../../basics/hanabi-util.js');
const { logger } = require('../../../logger.js');
const Utils = require('../../../util.js');

function direct_clues(state, target, card) {
	const direct_clues = [];

	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		const clue = { type: CLUE.COLOUR, value: suitIndex, target };

		if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue)) {
			direct_clues.push(clue);
		}
	}

	for (let rank = 1; rank <= 5; rank++) {
		const clue = { type: CLUE.RANK, value: rank, target };

		if (isCluable(state.suits, clue) && cardTouched(card, state.suits, clue)) {
			direct_clues.push(clue);
		}
	}

	return direct_clues;
}

function determine_clue(state, target, target_card) {
	logger.info('--------');
	logger.info('determining clue to target card', Utils.logCard(target_card));
	const hand = state.hands[target];

	const possible_clues = direct_clues(state, target, target_card).filter(clue => clue_safe(state, clue));

	const results = possible_clues.map(clue => {
		const result = { clue };

		result.touch = hand.clueTouched(state.suits, clue);
		const list = result.touch.map(c => c.order);

		const bad_touch_cards = find_bad_touch(state, result.touch.filter(c => !c.clued));		// Ignore cards that were already clued
		const { focused_card } = determine_focus(hand, list, { beforeClue: true });
		result.focused = focused_card.order === target_card.order;

		if (!result.focused) {
			logger.info(`${Utils.logClue(clue)} doesn't focus, ignoring`);
			return { correct: false };
		}

		// Simulate clue from receiver's POV to see if they have the right interpretation
		const action = { giver: state.ourPlayerIndex, target, list, clue }; // ignoreStall: true

		// Prevent outputting logs until we know that the result is correct
		logger.collect();

		logger.info('------- ENTERING HYPO --------');

		let hypo_state = state.simulate_clue(state, action, { enableLogs: true });

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
		result.correct = hypo_state.hands[target].every((card, index) => {
			if (!card.reset && card.matches_inferences()) {
				if (card.order === target_card.order) {
					// Focused card must also not be reset
					return !card.reset;
				}
				return true;
			}

			const old_card = state.hands[target][index];

			// Card doesn't match inference, but can still be correct if:
			return ((old_card.reset || !old_card.matches_inferences()) ||	// Didn't match inference even before clue
				bad_touch_cards.some(c => c.order === card.order) ||		// Bad touched
				card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)));	// Known trash
		});
		result.elim = elim_sum;
		result.new_touched = new_touched;

		// Print out logs if the result is correct
		logger.flush(result.correct);

		if (!result.correct) {
			logger.info(`${Utils.logClue(clue)} has incorrect interpretation, ignoring`);
			/*logger.info(hypo_state.hands[target].map(card => {
				if (card.reset || !card.matches_inferences()) {
					logger.info(`card ${Utils.logCard(card)} has inferences [${card.inferred.map(c => Utils.logCard(c)).join(',')}] reset? ${card.reset}`);
					logger.info(Utils.logHand(hypo_state.hands[target]));
				}
				if (!card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order))) {
					logger.info(`${Utils.logCard(card.possible.find(c => !isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)))} possibility is not trash`);
				}
				return bad_touch_cards.some(c => c.order === card.order) ||							// Card is bad touched
					card.possible.every(c => isTrash(hypo_state, target, c.suitIndex, c.rank, card.order)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());										// Card matches interpretation
			}));*/
			return { correct: false };
		}

		result.bad_touch = 0;
		result.trash = 0;
		for (const card of hypo_state.hands[target]) {
			if (bad_touch_cards.some(c => c.order === card.order)) {
				// Known trash
				if (card.possible.every(p => isTrash(hypo_state, target, p.suitIndex, p.rank, card.order))) {
					result.trash++;
				}
				else {
					// Don't double count bad touch when cluing two of the same card
					if (bad_touch_cards.some(c => c.matches(card.suitIndex, card.rank) && c.order > card.order)) {
						continue;
					}
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
	}).filter(result => result.correct);

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

	for (const result of results) {
		if (result.correct) {
			logger.info(Utils.logClue(result.clue) + ' result,', logResult(result));
		}
	}

	if (results.length === 0) {
		return;
	}

	const fields = [
		{ field: 'bad_touch', reverse: true },
		{ field: 'finesses' },
		{ field: 'playables', length: true },
		{ field: 'new_touched' },
		{ field: 'elim' },
		{ field: 'interpret', reverse: true, length: true }
	];

	const best_result = filterMax(results, fields);
	const { clue } = best_result;

	// Change type from CLUE to ACTION
	return { type: clue.type + 2, value: clue.value, target: clue.target, result: best_result };
}

function filterMax(array, fields) {
	let field_index = 0;

	while (array.length > 1 && field_index < fields.length) {
		const { field, reverse, length } = fields[field_index];
		let max = [array[0]];
		// logger.info('comparing field', field);

		for (let i = 1; i < array.length; i++) {
			const item = array[i];
			let arg1 = item[field], arg2 = max[0][field];

			if (length) {
				arg1 = arg1.length;
				arg2 = arg2.length;
			}

			if (reverse) {
				const arg3 = arg1;
				arg1 = arg2;
				arg2 = arg3;
			}

			// logger.info(`comparing ${Utils.logClue(item.clue)} and ${Utils.logClue(max[0].clue)}, vals ${arg1} and ${arg2}`);

			if (arg1 > arg2) {
				max = [item];
			}
			else if (arg1 === arg2) {
				max.push(item);
			}
		}
		array = max;
		field_index++;
	}

	return array[0];
}

module.exports = { determine_clue, direct_clues };
