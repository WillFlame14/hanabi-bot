const { find_chop, determine_focus, bad_touch_num } = require('./hanabi-logic.js');
const Utils = require('./util.js');

const ACTION = {
	PLAY: 0,
	DISCARD: 1,
	COLOUR: 2,
	RANK: 3
}

const CLUE = { COLOUR: 0, NUMBER: 1 };

function find_possibilities(clue, num_suits) {
	const new_possible = [];
	if (clue.type === CLUE.COLOUR) {
		const suitIndex = clue.value;
		for (let rank = 1; rank <= 5; rank++) {
			new_possible.push({ suitIndex: clue.value, rank });
		}
	}
	else {
		const rank = clue.value;
		for (let suitIndex = 0; suitIndex < num_suits; suitIndex++) {
			new_possible.push({ suitIndex, rank });
		}
	}
	return new_possible;
}

function find_bad_touch(state) {
	const bad_touch = [];

	// Find useless cards
	for (let suitIndex = 0; suitIndex <= state.num_suits; suitIndex++) {
		for (let rank = 0; rank <= state.play_stacks[suitIndex]; rank++) {
			bad_touch.push({suitIndex, rank});
		}
	}

	// Find cards clued in other hands (or inferred cards in our hand)
	// TODO: Modify if the person giving the clue has the card potentially in their hand
	for (let i = 0; i < state.hands.length; i++) {
		const hand = state.hands[i];
		for (const card of hand) {
			if (!card.clued) {
				continue;
			}
			let suitIndex, rank;
			if (i === state.ourPlayerIndex) {
				if (card.possible.length === 1) {
					({suitIndex, rank} = card.possible[0]);
				}
				else if (card.inferred.length === 1) {
					({suitIndex, rank} = card.inferred[0]);
				}
				else {
					continue;
				}
			} else {
				({suitIndex, rank} = card);
			}

			if (state.play_stacks[suitIndex] < rank) {
				bad_touch.push({suitIndex, rank});
			}
		}
	}

	return bad_touch;
}

function find_own_playables(stacks, hand) {
	// console.log('finding playables with stack', stacks, 'and hand', hand);
	const playables = [];

	for (const card of hand) {
		let playable = true;

		// Card is probably trash
		if (card.inferred.length === 0) {
			// Still, double check if all possibilities are playable
			for (const possible of card.possible) {
				if (stacks[possible.suitIndex] + 1 !== possible.rank) {
					playable = false;
					break;
				}
			}
		}
		else {
			for (const possible of card.inferred) {
				// Note: Do NOT use hypo stacks
				if (stacks[possible.suitIndex] + 1 !== possible.rank) {
					playable = false;
					break;
				}
			}
		}

		if (playable) {
			playables.push(card);
		}
	}
	return playables;
}

function find_known_trash(play_stacks, hand) {
	const trash = [];

	for (const card of hand) {
		let can_discard = true;
		for (const possible of card.possible) {
			// TODO: (possibly) need to check if visibleFind can see the others
			if (possible.rank > play_stacks[possible.suitIndex]) {
				can_discard = false;
				break;
			}
		}
		if (can_discard) {
			trash.push(card);
		}
	}
	return trash;
}

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
			if (!card.clued && state.play_stacks[suitIndex] + 1 === rank) {
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
				}
				else if (clue_type === ACTION.RANK) {
					play_clues[target].push({ type: ACTION.RANK, value: rank, target });
				}
				// Else, can't focus this card
			}
			// Save clue (chop is unclued by definition)
			else if (cardIndex === chopIndex) {
				const chop = hand[chopIndex];
				// TODO: See if someone else can save
				if (Utils.isCritical(state, chop.suitIndex, chop.rank)) {
					console.log('saving critical card', chop);
					if (chop.rank === 5) {
						save_clues[target] = { type: ACTION.RANK, value: 5, target };
					}
					else {
						const colour_touch = hand.filter(c => c.suitIndex === suitIndex);
						const rank_touch = hand.filter(c => c.suitIndex === suitIndex);

						const [colour_bad_touch, rank_bad_touch] = [colour_touch, rank_touch].map(cards => bad_touch_num(state, cards));
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
					// Play stack hasn't started and other copy of 2 isn't visible
					if (state.play_stacks[chop.suitIndex] === 0 && Utils.visibleFind(state.hands, chop.suitIndex, 2).length === 1) {
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
							'visible:', Utils.visibleFind(state.hands, chop.suitIndex, 2).length);
					}
				}
				else {
					// console.log('chop card with suitIndex', chop.suitIndex, 'and rank', chop.rank, 'is not critical');
				}
			}
		}
	}
	console.log('found play clues', play_clues);
	console.log('found save clues', save_clues);
	return { play_clues, save_clues };
}

function remove_card_from_hand(hand, order) {
	const card_index = hand.findIndex((card) => card.order === order);

	if (card_index === undefined) {
		console.log('could not find such card index!');
		return;
	}

	// Remove the card from their hand
	hand.splice(card_index, 1);
}

module.exports = {
	ACTION, CLUE,
	find_possibilities, find_bad_touch,
	find_own_playables, find_known_trash, find_clues,
	remove_card_from_hand
};