const { ACTION, CLUE } = require('../../../constants.js');
const { find_possibilities } = require('../../../basics/helper.js');
const { logger } = require('../../../logger.js');
const Basics = require('../../../basics.js');
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
			// Card known, doesn't need fix
			if (card.possible.length === 1) {
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

				const card_fixed = function (target_card) {
					return target_card.possible.every(p => Utils.playableAway(state, p.suitIndex, p.rank) !== 0);
				};
				const card_trash = function (target_card) {
					return target_card.possible.every(p =>
						Utils.isBasicTrash(state, p.suitIndex, p.rank) ||
						Utils.visibleFind(state, target, p.suitIndex, p.rank).some(c => c.clued && p.order !== c.order)
					);
				}

				// Card doesn't match any inferences and seems playable but isn't (need to fix)
				if (!card.matches_inferences() && seems_playable && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
					let found_clue = false;

					const other_clues = Utils.objClone(play_clues[target]);

					// Try the save clue as well if it exists
					if (save_clues[target] !== undefined) {
						other_clues.push(save_clues[target]);
					}

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						const touch = Utils.clueTouched(hand, clue);

						// The clue cannot touch the fixed card or it will look like just a fix
						if (touch.some(c => c.order === card.order)) {
							continue;
						}

						const hypo_state = Utils.objClone(state);
						const action = { giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue, mistake: false };

						// Prevent outputting logs until we know that the result is correct
						logger.collect();

						logger.setLevel(logger.LEVELS.ERROR);
						hypo_state.ourPlayerIndex = target;
						Basics.onClue(hypo_state, action);
						hypo_state.interpret_clue(hypo_state, action);
						logger.setLevel(logger.LEVELS.INFO);

						const card_after_cluing = hypo_state.hands[target].find(c => c.order === card.order);

						logger.flush(card_fixed(card_after_cluing));

						if (card_fixed(card_after_cluing)) {
							// TODO: Find the highest value play clue
							logger.info(`found fix ${Utils.logClue(clue)} for card ${card.toString()} to inferences [${card_after_cluing.inferred.map(c => c.toString()).join(',')}]`)
							fix_clues[target].push(Object.assign(clue, { trash: card_trash(card_after_cluing) }));
							found_clue = true;
							break;
						}
					}

					if (found_clue) {
						continue;
					}

					const colour_clue = { type: CLUE.COLOUR, value: card.suitIndex };
					const rank_clue = { type: CLUE.RANK, value: card.rank };
					const [colour_fix, rank_fix] = [colour_clue, rank_clue].map(clue => {
						const copy = card.clone();
						copy.intersect('possible', find_possibilities(clue, state.suits.length));

						// Fixed if every possibility is now unplayable
						return {
							fixed: card_fixed(copy),
							trash: card_trash(copy)};
					});

					if (colour_fix.fixed && !rank_fix.fixed) {
						fix_clues[target].push({ type: ACTION.COLOUR, target, value: card.suitIndex, trash: colour_fix.trash });
					}
					// Always prefer rank fix if it works
					else if (rank_fix.fixed) {
						fix_clues[target].push({ type: ACTION.RANK, target, value: card.rank, trash: rank_fix.trash });
					}
				}
			}
		}
	}
	return fix_clues;
}

module.exports = { find_fix_clues };
