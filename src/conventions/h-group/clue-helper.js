const { find_chop, determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const { ACTION } = require('../../basics/helper.js');
const { LEVELS, logger } = require('../../logger.js');
//const { find_focus_possible } = require('./interpret_helper.js');
const Basics = require('../../basics.js')
const Utils = require('../../util.js');

function determine_clue(state, target, card, save = false) {
	logger.info('determining clue to target card', card.toString());
	const { suitIndex, rank } = card;
	const hand = state.hands[target];
	// const chopIndex = find_chop(hand);

	const colour_clue = {type: ACTION.COLOUR, value: suitIndex};
	const rank_clue = {type: ACTION.RANK, value: rank};

	/*const [colour_interpret, rank_interpret] = [colour_clue, rank_clue].map(clue => find_focus_possible(
		state,
		state.ourPlayerIndex,
		target,
		clue,
		hand.findIndex(c => c.matches(suitIndex, rank)) === chopIndex
	));*/

	// const [colour_save_p, rank_save_p] = [colour_interpret, rank_interpret].map(ps => ps.some(p => p.save));
	

	const colour_touch = hand.filter(c => c.suitIndex === suitIndex);
	const rank_touch = hand.filter(c => c.rank === rank);
	const [colour_bad_touch, rank_bad_touch] = [colour_touch, rank_touch].map(cards => bad_touch_num(state, target, cards));
	const [colour_focused, rank_focused] = [colour_touch, rank_touch].map(cards => determine_focus(hand, cards.map(c => c.order)).focused_card.order === card.order);

	let colour_interpret, rank_interpret;

	[colour_clue, rank_clue].forEach(clue => {
		const hypo_state = Utils.objClone(state);
		const touched = clue.type === ACTION.COLOUR ? colour_touch : rank_touch;
		const action = { giver: state.ourPlayerIndex, target, list: touched.map(c => c.order), clue, mistake: false };

		logger.setLevel(LEVELS.WARN);

		Basics.onClue(hypo_state, action);
		hypo_state.interpret_clue(hypo_state, action);

		logger.setLevel(LEVELS.INFO);

		if (clue.type === ACTION.COLOUR) {
			colour_interpret = hypo_state.hands[target].find(c => c.order === card.order).inferred.map(c => { return { suitIndex: c.suitIndex, rank: c.rank }});
		}
		else {
			rank_interpret = hypo_state.hands[target].find(c => c.order === card.order).inferred.map(c => { return { suitIndex: c.suitIndex, rank: c.rank }});
		}
	});
	logger.info('colour_interpret', colour_interpret, 'rank_interpret', rank_interpret);

	let clue_type;
	logger.debug(`colour_focused ${colour_focused} rank_focused ${rank_focused}`);

	// Number clue doesn't focus, pick colour clue
	if (colour_focused && !rank_focused) {
		clue_type = ACTION.COLOUR;
	}
	// Colour clue doesn't focus, pick rank clue
	else if (!colour_focused && rank_focused) {
		clue_type = ACTION.RANK;
	}
	// Both clues focus, determine more
	else if (colour_focused && rank_focused) {
		// Number clue doesn't have correct interpretation
		if (colour_interpret.some(p => card.matches(p.suitIndex, p.rank)) && !rank_interpret.some(p => card.matches(p.suitIndex, p.rank))) {
			clue_type = ACTION.COLOUR;
		}
		// Colour clue doesn't have correct interpretation
		else if (!colour_interpret.some(p => card.matches(p.suitIndex, p.rank)) && rank_interpret.some(p => card.matches(p.suitIndex, p.rank))) {
			clue_type = ACTION.RANK;
		}
		else if (colour_interpret.some(p => card.matches(p.suitIndex, p.rank)) && rank_interpret.some(p => card.matches(p.suitIndex, p.rank))) {
			if (state.discard_stacks.some(stack => stack[rank - 1] === 1)) {
				clue_type = ACTION.COLOUR;
			}
			logger.debug(`colour_bad_touch ${colour_bad_touch} rank_bad_touch ${rank_bad_touch}`);
			// Figure out which clue has less bad touch
			if (colour_bad_touch < rank_bad_touch) {
				clue_type = ACTION.COLOUR;
			}
			else if (rank_bad_touch < colour_bad_touch) {
				clue_type = ACTION.RANK;
			}
			else {
				logger.debug(`colour_touch ${colour_touch.length} rank_touch ${rank_touch.length}`);
				// Figure out which clue touches more cards
				// TODO: Should probably be which one "fills in" more cards
				if (colour_touch.length >= rank_touch.length) {
					clue_type = ACTION.COLOUR;
				}
				else {
					clue_type = ACTION.RANK;
				}
			}
		}
	}

	if (clue_type === ACTION.COLOUR) {
		return { type: ACTION.COLOUR, value: suitIndex, target, bad_touch: colour_bad_touch, touch: colour_touch.length };
	}
	else if (clue_type === ACTION.RANK) {
		return { type: ACTION.RANK, value: rank, target, bad_touch: rank_bad_touch, touch: rank_touch.length };
	}
	// Else, can't focus this card
	return;
}

module.exports = { determine_clue };
