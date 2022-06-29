const { ACTION, find_connecting } = require('./action-helper.js');
const { find_chop, determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const Utils = require('./util.js');

function find_clues(state) {
	const play_clues = [];
	const save_clues = [];

	// Find all valid clues
	for (let target = 0; target < state.hands.length; target++) {
		// Ignore our own hand
		if (target === state.ourPlayerIndex) {
			continue;
		}

		play_clues[target] = [];
		save_clues[target] = undefined;

		const hand = state.hands[target];
		const chopIndex = find_chop(hand);

		// Play clue
		for (let cardIndex = chopIndex; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank } = card;
			// TODO: Should eventually use hypo stacks
			// TODO: Should eventually find all possible clues and determine the best one
			// TODO: Try both types of clues, see which one touches more cards or has less bad touch or fills in more cards
			// TODO: Examine tempo clues
			if (!card.clued) {
				const next_playable_rank = state.hypo_stacks[suitIndex] + 1;
				console.log('giving play clue. suitIndex', suitIndex, 'play stack:', state.play_stacks[suitIndex], 'hypo stack:', state.hypo_stacks[suitIndex]);
				// while (find_connecting(state, state.ourPlayerIndex, target, suitIndex, next_playable_rank)) {

				// }
				if (next_playable_rank === rank) {
					// console.log('found playable card to clue', card);
					const colour_focus = determine_focus(hand, hand.filter(c => c.suitIndex === suitIndex).map(c => c.order)).focused_card;
					const rank_focus = determine_focus(hand, hand.filter(c => c.rank === rank).map(c => c.order)).focused_card;

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
						clue_type = ACTION.COLOUR;
					}

					if (clue_type === ACTION.COLOUR) {
						play_clues[target].push({ type: ACTION.COLOUR, value: suitIndex, target });

						// If the card is on chop, add this as potential save
						if (cardIndex === chopIndex) {
							save_clues[target] = { type: ACTION.COLOUR, value: suitIndex, target };
						}
					}
					else if (clue_type === ACTION.RANK) {
						play_clues[target].push({ type: ACTION.RANK, value: rank, target });
						if (cardIndex === chopIndex) {
							save_clues[target] = { type: ACTION.RANK, value: rank, target };
						}
					}
					// Else, can't focus this card
				}

				// Save clue
				if (cardIndex === chopIndex) {
					const chop = hand[chopIndex];
					// TODO: See if someone else can save
					if (Utils.isCritical(state, chop.suitIndex, chop.rank)) {
						console.log('saving critical card', Utils.cardToString(chop));
						if (chop.rank === 5) {
							save_clues[target] = { type: ACTION.RANK, value: 5, target };
						}
						else {
							const colour_touch = hand.filter(c => c.suitIndex === suitIndex);
							const rank_touch = hand.filter(c => c.suitIndex === suitIndex);

							const [colour_bad_touch, rank_bad_touch] = [colour_touch, rank_touch].map(cards => bad_touch_num(state, target, cards));
							if (colour_bad_touch < rank_bad_touch) {
								save_clues[target] = { type: ACTION.COLOUR, value: chop.suitIndex, target };
							}
							else  {
								save_clues[target] = { type: ACTION.RANK, value: chop.rank, target };
							}
							// TODO: More conditions
						}
					}
					else if (chop.rank === 2) {
						// Play stack hasn't started and other copy of 2 isn't visible (to us)
						if (state.play_stacks[chop.suitIndex] === 0 && Utils.visibleFind(state, state.ourPlayerIndex, chop.suitIndex, 2).length === 1) {
							// Also check if not reasonably certain in our hand
							if(!state.hands[state.ourPlayerIndex].some(c => c.inferred.length === 1 && Utils.cardMatch(c.inferred[0], suitIndex, rank))) {
								save_clues[target] = { type: ACTION.RANK, value: 2, target };
							}
							else {
								console.log('condition not met for 2 save: inferred in hand');
							}
						}
						else {
							console.log('condition not met for 2 save: play stack', state.play_stacks[chop.suitIndex] === 0,
								'visible:', Utils.visibleFind(state, target, chop.suitIndex, 2).length);
						}
					}
					else {
						console.log('chop card', Utils.cardToString(chop), 'is not critical');
					}
				}
			}
			else {
				// Tempo clue
			}
		}
	}
	console.log('found play clues', play_clues);
	console.log('found save clues', save_clues);
	return { play_clues, save_clues };
}

module.exports = { find_clues };
