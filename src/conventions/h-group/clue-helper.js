const { ACTION, CLUE } = require('../../constants.js');
const { find_chop, determine_focus, find_bad_touch } = require('./hanabi-logic.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Basics = require('../../basics.js');
const Utils = require('../../util.js');

function determine_clue(state, target, target_card) {
	logger.info('--------');
	logger.info('determining clue to target card', target_card.toString());
	const { suitIndex, rank } = target_card;
	const hand = state.hands[target];

	const colour_base = {
		name: 'colour',
		clue: { type: CLUE.COLOUR, value: suitIndex, target },
		touch: hand.filter(c => c.suitIndex === suitIndex)
	};

	const rank_base = {
		name: 'rank',
		clue: { type: CLUE.RANK, value: rank, target },
		touch: hand.filter(c => c.rank === rank)
	};

	const [colour_result, rank_result] = [colour_base, rank_base].map(base => {
		const { name, clue, touch } = base;
		const result = Object.assign({}, base);

		const bad_touch_cards = find_bad_touch(state, touch.filter(c => !c.clued));		// Ignore cards that were already clued
		result.bad_touch = bad_touch_cards.length;
		result.focused = determine_focus(hand, touch.map(c => c.order), { beforeClue: true }).focused_card.order === target_card.order;

		if (!result.focused) {
			logger.info(`${name} clue doesn't focus, ignoring`);
			return { correct: false };
		}

		// Simulate clue from receiver's POV to see if they have the right interpretation
		let hypo_state = Utils.objClone(state);
		const action = { giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue, mistake: false };

		// Prevent outputting logs until we know that the result is correct
		logger.collect();

		logger.info('------- ENTERING HYPO --------');

		hypo_state.ourPlayerIndex = target;
		Basics.onClue(hypo_state, action);
		hypo_state.interpret_clue(hypo_state, action);

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
				return bad_touch_cards.some(c => c.order === card.order) ||							// Card is bad touched
					card.possible.every(c => Utils.isBasicTrash(state, c.suitIndex, c.rank)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());										// Card matches interpretation
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
			logger.info(hypo_state.hands[target].map(card => {
				if (card.reset || !card.matches_inferences()) {
					logger.info(`card ${card.toString()} has inferences [${card.inferred.map(c => c.toString()).join(',')}] reset? ${card.reset}`);
				}
				return bad_touch_cards.some(c => c.order === card.order) ||							// Card is bad touched
					card.possible.every(c => Utils.isBasicTrash(state, c.suitIndex, c.rank)) || 	// Card is known trash
					(!card.reset && card.matches_inferences());										// Card matches interpretation
			}));
			return { correct: false };
		}

		// Re-simulate clue, but from our perspective so we can count the playable cards and finesses correctly
		hypo_state = Utils.objClone(state);

		logger.setLevel(logger.LEVELS.ERROR);
		Basics.onClue(hypo_state, action);
		hypo_state.interpret_clue(hypo_state, action);
		logger.setLevel(logger.LEVELS.INFO);

		// Count the number of finesses made
		result.finesses = 0;
		for (let i = 0; i < state.numPlayers; i++) {
			const hand = state.hands[i];
			for (let j = 0; j < hand.length; j++) {
				const old_card = hand[j];
				const hypo_card = hypo_state.hands[i][j];

				if (hypo_card.finessed && !old_card.finessed) {
					result.finesses++;
				}
			}
		}

		// Count the number of newly known playable cards
		result.playables = 0;
		for (let i = 0; i < state.num_suits; i++) {
			result.playables += hypo_state.hypo_stacks[i] - state.hypo_stacks[i];
		}

		return result;
	});

	const logResult = (result) => {
		const { clue, bad_touch, interpret, elim, new_touched, finesses, playables } = result;
		return {
			clue,
			bad_touch,
			interpret: interpret?.map(c => c.toString()),
			elim,
			new_touched,
			finesses,
			playables
		};
	}
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
		compare_result('num', colour_result.playables, rank_result.playables) ||
		compare_result('num', colour_result.new_touched, rank_result.new_touched) ||
		compare_result('num', colour_result.elim, rank_result.elim) ||
		compare_result('num', colour_result.interpret.length, rank_result.interpret.length) || 1;

	if (clue_type === 1) {
		logger.info(`selecting colour clue`);
		return { type: ACTION.COLOUR, value: suitIndex, target, result: colour_result };
	}
	else if (clue_type === 2) {
		logger.info(`selecting rank clue`);
		return { type: ACTION.RANK, value: rank, target, result: rank_result };
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

// Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
function clue_safe(state, clue) {
	const { type, value, target } = clue;
	const hypo_state = Utils.objClone(state);

	let list;
	if (type === CLUE.COLOUR) {
		list = hypo_state.hands[target].filter(c => c.suitIndex === value).map(c => c.order);
	}
	else {
		list = hypo_state.hands[target].filter(c => c.rank === value).map(c => c.order);
	}
	const action = { giver: state.ourPlayerIndex, target, list, clue, mistake: false };

	logger.setLevel(logger.LEVELS.ERROR);
	hypo_state.ourPlayerIndex = target;
	Basics.onClue(hypo_state, action);
	hypo_state.interpret_clue(hypo_state, action);
	logger.setLevel(logger.LEVELS.INFO);

	const hand = hypo_state.hands[target];
	const playable_cards = find_playables(hypo_state.play_stacks, hand);
	const trash_cards = find_known_trash(hypo_state, target);

	// They won't discard next turn
	if (playable_cards.length + trash_cards.length > 0) {
		return true;
	}

	// Note that chop will be undefined if the entire hand is clued
	const chop = hand[find_chop(hand, { includeNew: true })];
	logger.info(`chop after clue is ${chop?.toString()}`);

	let give_clue = true;

	// New chop is critical
	if (chop !== undefined && Utils.isCritical(hypo_state, chop.suitIndex, chop.rank)) {
		logger.error(`Not giving clue ${Utils.logClue(clue)}, as ${chop.toString()} is critical.`);
		give_clue = false;
	}

	// Locked hand and no clues
	if (chop === undefined && hypo_state.clue_tokens === 0) {
		logger.error(`Not giving clue ${Utils.logClue(clue)}, as hand would be locked with no clues.`);
		give_clue = false;
	}

	return give_clue;
}

module.exports = { determine_clue, clue_safe };
