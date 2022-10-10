const { ACTION } = require('../../../constants.js');
const { logger } = require('../../../logger.js');
const Utils = require('../../../util.js');

function find_fix_clues(state, play_clues, save_clues) {
	const fix_clues = [];
	for (let target = 0; target < state.numPlayers; target++) {
		fix_clues[target] = [];
		// Ignore our own hand
		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];

		for (const card of hand) {
			// Card known (or known trash), doesn't need fix
			if (card.possible.length === 1 || card.possible.every(c => Utils.isBasicTrash(state, c.suitIndex, c.rank))) {
				continue;
			}

			if (card.inferred.length === 0) {
				// TODO
				logger.error(`card ${card.toString()} order ${card.order} need fix??`);
			}
			else {
				const seems_playable = card.inferred.every(p => {
					const playableAway = Utils.playableAway(state, p.suitIndex, p.rank);
					const our_hand = state.hands[state.ourPlayerIndex];

					// Possibility is immediately playable or 1-away and we have the connecting card
					return playableAway === 0 || (playableAway === 1 && our_hand.some(c => c.matches(p.suitIndex, p.rank - 1, { infer: true })));
				});

				const wrong_inference = !card.matches_inferences() && Utils.playableAway(state, card.suitIndex, card.rank) !== 0;

				// We don't need to fix duplicated cards where we hold one copy, since we can just sarcastic discard
				const unknown_duplicated = card.clued && card.inferred.length > 1 &&
					Utils.isSaved(state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order, { ignore: [state.ourPlayerIndex] });

				let fix_criteria;
				if (wrong_inference) {
					fix_criteria = inference_corrected;
				}
				else if (unknown_duplicated) {
					fix_criteria = duplication_known;
				}

				// Card doesn't match any inferences and seems playable but isn't (need to fix)
				if (wrong_inference || unknown_duplicated) {
					let found_clue = false;

					const other_clues = Utils.objClone(play_clues[target]);

					// Try the save clue as well if it exists
					if (save_clues[target] !== undefined) {
						other_clues.push(save_clues[target]);
					}

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						// The clue cannot touch the fixed card or it will look like just a fix
						if (Utils.clueTouched(hand, clue).some(c => c.order === card.order)) {
							continue;
						}

						const { fixed, trash } = check_fixed(state, target, card, clue, fix_criteria);

						if (fixed) {
							// TODO: Find the highest value play clue
							// logger.info(`found fix ${Utils.logClue(clue)} for card ${card.toString()} to inferences [${card_after_cluing.inferred.map(c => c.toString()).join(',')}]`);
							fix_clues[target].push(Object.assign(clue, { trash, urgent: seems_playable }));
							found_clue = true;
							break;
						}
					}

					if (found_clue) {
						continue;
					}

					// NOTE: We are using clues with ACTION instead of CLUE here to match the play/save clues from the finder
					// This is not normal - typically simulated clues use CLUE, which is why we need to convert in check_fixed()
					const colour_clue = { type: ACTION.COLOUR, target, value: card.suitIndex };
					const rank_clue = { type: ACTION.RANK, target, value: card.rank };
					const [colour_fix, rank_fix] = [colour_clue, rank_clue].map(clue => check_fixed(state, target, card, clue, fix_criteria));

					if (colour_fix.fixed && !rank_fix.fixed) {
						fix_clues[target].push(Object.assign(colour_clue, { trash: colour_fix.trash, urgent: seems_playable }));
					}
					// Always prefer rank fix if it works
					else if (rank_fix.fixed) {
						fix_clues[target].push(Object.assign(rank_clue, { trash: rank_fix.trash, urgent: seems_playable }));
					}
				}
			}
		}
	}
	return fix_clues;
}

function inference_corrected(_state, card, _target) {
	return card.matches_inferences(); //card.possible.every(p => Utils.playableAway(state, p.suitIndex, p.rank) !== 0);
}

function duplication_known(state, card, target) {
	return card.possible.length === 1 && Utils.isSaved(state, target, card.suitIndex, card.rank, card.order);
}

// Every possibility is trash or duplicated
function card_trash(state, target, card) {
	return card.possible.every(p =>
		Utils.isBasicTrash(state, p.suitIndex, p.rank) ||
		Utils.isSaved(state, target, p.suitIndex, p.rank, card.order)
	);
}

function check_fixed(state, target, card, clue, fix_criteria) {
	const hand = state.hands[target];
	const touch = Utils.clueTouched(hand, clue);

	// Convert clue type from ACTION to CLUE
	const clue_copy = Utils.objClone(clue);
	clue_copy.type -= 2;

	const action = { giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue: clue_copy };

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	const hypo_state = state.simulate_clue(state, action, { enableLogs: true, simulatePlayerIndex: target });
	const card_after_cluing = hypo_state.hands[target].find(c => c.order === card.order);

	const result = {
		fixed: fix_criteria(hypo_state, card_after_cluing, target),
		trash: card_trash(hypo_state, target, card_after_cluing)
	};

	logger.flush(result.fixed);

	return result;
}

module.exports = { find_fix_clues };