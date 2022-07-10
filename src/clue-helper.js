const { ACTION } = require('./action-helper.js');
const { determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const Utils = require('./util.js');

function determine_clue(state, target, card) {
	const { suitIndex, rank } = card;
	const hand = state.hands[target];

	const colour_touch = hand.filter(c => c.suitIndex === suitIndex);
	const rank_touch = hand.filter(c => c.rank === rank);
	const [colour_bad_touch, rank_bad_touch] = [colour_touch, rank_touch].map(cards => bad_touch_num(state, target, cards));
	const [colour_focus, rank_focus] = [colour_touch, rank_touch].map(cards => determine_focus(hand, cards.map(c => c.order)).focused_card);

	let clue_type;

	// Number clue doesn't focus, pick colour clue
	if (colour_focus.order === card.order && rank_focus.order !== card.order) {
		clue_type = ACTION.COLOUR;
	}
	// Colour clue doesn't focus, pick rank clue
	else if (colour_focus.order !== card.order && rank_focus.order === card.order) {
		clue_type = ACTION.RANK;
	}
	// Both clues focus, determine more
	else if (colour_focus.order === card.order && rank_focus.order === card.order) {
		// Figure out which clue has less bad touch
		if (colour_bad_touch < rank_bad_touch) {
			clue_type = ACTION.COLOUR;
		}
		else if (rank_bad_touch < colour_bad_touch) {
			clue_type = ACTION.RANK;
		}
		else {
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
