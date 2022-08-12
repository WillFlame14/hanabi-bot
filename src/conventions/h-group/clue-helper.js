const { determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const { ACTION, CLUE } = require('../../basics/helper.js');
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
	const [colour_focused, rank_focused] = [colour_touch, rank_touch].map(cards => determine_focus(hand, cards.map(c => c.order)).focused_card.order === card.order);

	let colour_interpret, rank_interpret, colour_elim, rank_elim;

	const colour_clue = {type: CLUE.COLOUR, value: suitIndex};
	const rank_clue = {type: CLUE.RANK, value: rank};

	[colour_clue, rank_clue].forEach(clue => {
		const hypo_state = Utils.objClone(state);
		const touched = clue.type === CLUE.COLOUR ? colour_touch : rank_touch;
		const action = { giver: state.ourPlayerIndex, target, list: touched.map(c => c.order), clue, mistake: false };

		//logger.setLevel(logger.LEVELS.ERROR);
		console.log('------- ENTERING HYPO --------');

		Basics.onClue(hypo_state, action);
		hypo_state.interpret_clue(hypo_state, action);

		//logger.setLevel(logger.LEVELS.INFO);
		console.log('------- EXITING HYPO --------');

		const inferred_after_cluing = hypo_state.hands[target].find(c => c.order === card.order).inferred;
		let elim_sum = 0;

		// Count the number of cards that have increased elimination (i.e. cards that were "filled in")
		for (let i = 0; i < state.hands[target].length; i++) {
			const old_card = state.hands[target][i];
			const hypo_card = hypo_state.hands[target][i];

			if (hypo_card.clued && hypo_card.inferred.length < old_card.inferred.length) {
				elim_sum++;
			}
		}

		if (clue.type === CLUE.COLOUR) {
			colour_interpret = inferred_after_cluing;
			colour_elim = elim_sum;
		}
		else {
			rank_interpret = inferred_after_cluing;
			rank_elim = elim_sum;
		}
	});

	let clue_type;
	logger.debug(`colour_focused ${colour_focused} rank_focused ${rank_focused}`);
	logger.info('colour_interpret', colour_interpret.map(c => c.toString()), 'rank_interpret', rank_interpret.map(c => c.toString()));

	const colour_correct = colour_focused && colour_interpret.some(p => card.matches(p.suitIndex, p.rank));
	const rank_correct = rank_focused && rank_interpret.some(p => card.matches(p.suitIndex, p.rank));

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
		logger.debug(`colour_bad_touch ${colour_bad_touch} rank_bad_touch ${rank_bad_touch}`);
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
				logger.info(`colour_touch ${colour_elim} rank_touch ${rank_elim}`);
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

	if (clue_type === ACTION.COLOUR) {
		return { type: ACTION.COLOUR, value: suitIndex, target, bad_touch: colour_bad_touch, touch: colour_elim };
	}
	else if (clue_type === ACTION.RANK) {
		return { type: ACTION.RANK, value: rank, target, bad_touch: rank_bad_touch, touch: rank_elim };
	}
	// Else, can't focus this card
	return;
}

module.exports = { determine_clue };
