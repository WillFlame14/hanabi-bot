const { find_chop, determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const { ACTION, CLUE, find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Basics = require('../../basics.js');
const Utils = require('../../util.js');

function determine_clue(state, target, card) {
	logger.info('determining clue to target card', card.toString());
	const { suitIndex, rank } = card;
	const hand = state.hands[target];

	const colour_touch = hand.filter(c => c.suitIndex === suitIndex);
	const rank_touch = hand.filter(c => c.rank === rank);
	// Ignore cards that are already clued when determining bad touch
	const [colour_bad_touch, rank_bad_touch] = [colour_touch, rank_touch].map(cards => bad_touch_num(state, target, cards.filter(c => !c.clued)));
	const [colour_focused, rank_focused] = [colour_touch, rank_touch].map(cards => {
		return determine_focus(hand, cards.map(c => c.order), { beforeClue: true }).focused_card.order === card.order;
	});

	let colour_interpret, rank_interpret, colour_correct, rank_correct, colour_elim, rank_elim, colour_new_touched, rank_new_touched;

	const colour_clue = {type: CLUE.COLOUR, value: suitIndex};
	const rank_clue = {type: CLUE.RANK, value: rank};

	[colour_clue, rank_clue].forEach(clue => {
		const hypo_state = Utils.objClone(state);
		const touched = clue.type === CLUE.COLOUR ? colour_touch : rank_touch;
		const action = { giver: state.ourPlayerIndex, target, list: touched.map(c => c.order), clue, mistake: false };

		//logger.setLevel(logger.LEVELS.ERROR);
		console.log('------- ENTERING HYPO --------');

		hypo_state.ourPlayerIndex = target;
		Basics.onClue(hypo_state, action);
		hypo_state.interpret_clue(hypo_state, action);

		//logger.setLevel(logger.LEVELS.INFO);
		console.log('------- EXITING HYPO --------');

		const card_after_cluing = hypo_state.hands[target].find(c => c.order === card.order);
		const { inferred: inferred_after_cluing, reset } = card_after_cluing;
		let elim_sum = 0;
		let new_touched = 0;

		// Count the number of cards that have increased elimination (i.e. cards that were "filled in")
		for (let i = 0; i < state.hands[target].length; i++) {
			const old_card = state.hands[target][i];
			const hypo_card = hypo_state.hands[target][i];

			if (hypo_card.clued && hypo_card.inferred.length < old_card.inferred.length) {
				if (hypo_card.newly_clued) {
					new_touched++;
				}
				elim_sum++;
			}
		}

		const matches_interpretation = (interpretations, card) => interpretations.some(p => card.matches(p.suitIndex, p.rank));

		if (clue.type === CLUE.COLOUR) {
			colour_interpret = inferred_after_cluing;
			colour_correct = colour_focused && !reset && matches_interpretation(colour_interpret, card);
			colour_elim = elim_sum;
			colour_new_touched = new_touched;
			logger.info(`colour_focused: ${colour_focused}, reset: ${reset}, matches: ${matches_interpretation(colour_interpret, card)}`);
		}
		else {
			rank_interpret = inferred_after_cluing;
			rank_correct = rank_focused && !reset && matches_interpretation(rank_interpret, card);
			rank_elim = elim_sum;
			rank_new_touched = new_touched;
			logger.info(`rank_focused: ${rank_focused}, reset: ${reset}, matches: ${matches_interpretation(rank_interpret, card)}`);
		}
	});

	let clue_type;
	logger.debug(`colour_focused ${colour_focused} rank_focused ${rank_focused}`);
	logger.info('colour_interpret', colour_interpret.map(c => c.toString()), 'rank_interpret', rank_interpret.map(c => c.toString()));

	// Number clue doesn't work
	if (colour_correct && !rank_correct) {
		clue_type = ACTION.COLOUR;
	}
	// Colour clue doesn't work
	else if (!colour_correct && rank_correct) {
		clue_type = ACTION.RANK;
	}
	// Both clues work, determine more
	else if (colour_correct && rank_correct) {
		logger.info(`colour_bad_touch ${colour_bad_touch} rank_bad_touch ${rank_bad_touch}`);
		// Figure out which clue has less bad touch
		if (colour_bad_touch < rank_bad_touch) {
			clue_type = ACTION.COLOUR;
		}
		else if (rank_bad_touch < colour_bad_touch) {
			clue_type = ACTION.RANK;
		}
		else {
			let [colour_play, rank_play] = [colour_interpret, rank_interpret].map(ps => ps.every(p => {
				return p.rank === state.hypo_stacks[p.suitIndex] + 1;
				//Utils.isCritical(state, p.suitIndex, p.rank) && state.hypo_stacks[p.suitIndex] + 1 !== p.rank;
			}));
			logger.info(`colour_play ${colour_play} rank_play ${rank_play}`);
			// Figure out which clue doesn't look like a save clue
			if (colour_play && !rank_play) {
				clue_type = ACTION.COLOUR;
			}
			else if (rank_play && !colour_play) {
				clue_type = ACTION.RANK;
			}
			else {
				logger.info(`colour_new_touched ${colour_new_touched} rank_new_touched ${rank_new_touched}`);
				// Figure out which clue touches more new cards
				if (colour_new_touched > rank_new_touched) {
					clue_type = ACTION.COLOUR;
				}
				else if (rank_new_touched > colour_new_touched) {
					clue_type = ACTION.RANK;
				}
				else {
					logger.info(`colour_elim ${colour_elim} rank_elim ${rank_elim}`);
					// Figure out which clue "fills in" more cards
					if (colour_elim > rank_elim) {
						clue_type = ACTION.COLOUR;
					}
					else if (colour_elim < rank_elim) {
						clue_type = ACTION.RANK;
					}
					else {
						// Figure out which clue has less interpretations
						if (colour_interpret.length <= rank_interpret.length) {
							clue_type = ACTION.COLOUR;
						}
						else {
							clue_type = ACTION.RANK;
						}
					}
				}
			}
		}
	}

	if (clue_type === ACTION.COLOUR) {
		logger.info(`selecting colour clue`);
		return { type: ACTION.COLOUR, value: suitIndex, target, bad_touch: colour_bad_touch, touch: colour_elim };
	}
	else if (clue_type === ACTION.RANK) {
		logger.info(`selecting rank clue`);
		return { type: ACTION.RANK, value: rank, target, bad_touch: rank_bad_touch, touch: rank_elim };
	}
	// Else, can't focus this card
	return;
}

// Determines if the clue is safe to give (i.e. doesn't put a critical on chop with nothing to do)
function clue_safe(state, clue) {
	const { type, value, target } = clue;
	const hypo_state = Utils.objClone(state);

	let list;
	if (type === ACTION.COLOUR) {
		list = hypo_state.hands[target].filter(c => c.suitIndex === value).map(c => c.order);
	}
	else {
		list = hypo_state.hands[target].filter(c => c.rank === value).map(c => c.order);
	}
	const action = { giver: state.ourPlayerIndex, target, list, clue, mistake: false };

	console.log('------- ENTERING SAFE CLUE HYPO --------');

	logger.setLevel(logger.LEVELS.ERROR);
	hypo_state.ourPlayerIndex = target;
	Basics.onClue(hypo_state, action);
	hypo_state.interpret_clue(hypo_state, action);
	logger.setLevel(logger.LEVELS.INFO);

	console.log('------- EXITING SAFE CLUE HYPO --------');

	const hand = hypo_state.hands[target];
	const playable_cards = find_playables(hypo_state.play_stacks, hand);
	const trash_cards = find_known_trash(hypo_state, target);

	// They won't discard next turn
	if (playable_cards.length + trash_cards.length > 0) {
		return true;
	}

	// Note that chop will be undefined if the entire hand is clued
	const chop = hand[find_chop(hand, { ignoreNew: true })];

	let give_clue = true;

	// New chop is critical
	if (chop !== undefined && Utils.isCritical(hypo_state, chop.suitIndex, chop.rank)) {
		logger.error(`Not giving clue ${JSON.stringify(clue)}, as ${chop.toString()} is critical.`);
		give_clue = false;
	}

	// Locked hand and no clues
	if (chop === undefined && hypo_state.clue_tokens === 0) {
		logger.error(`Not giving clue ${JSON.stringify(clue)}, as hand would be locked with no clues.`);
		give_clue = false;
	}

	return give_clue;
}

module.exports = { determine_clue, clue_safe };
