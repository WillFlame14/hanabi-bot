const { ACTION, CLUE } = require('../../constants.js');
const { determine_clue, clue_safe } = require('./clue-helper.js');
const { find_chop } = require('./hanabi-logic.js');
const { find_possibilities } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_clues(state) {
	const play_clues = [], save_clues = [];
	logger.info('play/hypo/max stacks in clue finder:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];
		save_clues[target] = undefined;

		// Ignore our own hand
		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		const chopIndex = find_chop(hand);

		for (let cardIndex = hand.length - 1; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank, finessed } = card;

			// Ignore finessed cards, trash cards, cards visible elsewhere, or cards possibly part of a finesse
			if (finessed || rank <= state.hypo_stacks[suitIndex] || rank > state.max_ranks[suitIndex] ||
				Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).some(c => (c.clued || c.finessed) && (c.order !== card.order)) ||
				state.waiting_connections.some(c => suitIndex === c.inference.suitIndex && rank <= c.inference.rank)) {
				continue;
			}

			// const { valid, finesses, self } = valid_play(state, target, card);

			// Play clue
			const clue = determine_clue(state, target, card);
			if (clue !== undefined) {
				// Not a play clue
				if (clue.result.playables === 0) {	// && clue.result.new_touched > 0)
					if (cardIndex === chopIndex) {
						// Save clue
						// TODO: See if someone else can save
						if (Utils.isCritical(state, suitIndex, rank)) {
							logger.warn('saving critical card', card.toString());
							if (rank === 5) {
								save_clues[target] = { type: ACTION.RANK, value: 5, target };
							}
							else {
								// The card is on chop, so it can always be focused
								save_clues[target] = determine_clue(state, target, card);
							}
						}
						else if (rank === 2) {
							const clue = { type: ACTION.RANK, value: 2, target };

							const save2 = state.play_stacks[suitIndex] === 0 &&									// play stack at 0
								Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, 2).length === 1 &&	// other copy isn't visible
								!state.hands[state.ourPlayerIndex].some(c => c.matches(suitIndex, rank, { infer: true })) &&   // not in our hand
								clue_safe(state, clue);															// doesn't put crit on chop

							if (save2) {
								save_clues[target] = clue;
							}
						}
					}
					continue;
				}

				play_clues[target].push(clue);

				// Save a playable card if it's on chop and its duplicate is not visible somewhere
				if (cardIndex === chopIndex && Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length === 1) {
					save_clues[target] = clue;
				}
			}
		}
	}

	const fix_clues = find_fix_clues(state, play_clues, save_clues);

	logger.info('found play clues', play_clues.map(clues => clues.map(clue => Utils.logClue(clue))));
	logger.info('found save clues', save_clues.map(clue => Utils.logClue(clue)));
	logger.debug('found fix clues', fix_clues.map(clue => Utils.logClue(clue)));
	return { play_clues, save_clues, fix_clues };
}

function find_tempo_clues(state) {
	const tempo_clues = [];

	for (let target = 0; target < state.numPlayers; target++) {
		tempo_clues[target] = [];

		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		for (const card of hand) {
			// Card must be clued and playable
			if (card.clued && state.hypo_stacks[card.suitIndex] + 1 === card.rank) {
				// Card is known playable
				if (card.inferred.every(c => Utils.playableAway(state, c.suitIndex, c.rank) === 0)) {
					continue;
				}
				const clue = determine_clue(state, target, card);
				if (clue !== undefined) {
					tempo_clues[target].push(clue);
				}
			}
		}
	}
	return tempo_clues;
}

/**
 * Finds a stall clue to give. Always finds a clue if severity is greater than 1 (hard burn).
 */
function find_stall_clue(state, severity) {
	const stall_clues = [[], [], [], []];
	stall_clues[1] = find_tempo_clues(state).flat();

	for (let target = 0; target < state.numPlayers; target++) {
		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];

		// Early game
		if (severity > 0) {
			// 5 Stall (priority 0)
			if (hand.some(c => c.rank === 5 && !c.clued)) {
				stall_clues[0].push({ type: ACTION.RANK, target, value: 5 });
				break;
			}
		}

		// Double discard/Scream discard
		if (severity > 1) {
			// Tempo clue (priority 1) is already covered

			// Fill-in (priority 2)

			// Hard burn (priority 3)
			const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
			stall_clues[3].push({ type: ACTION.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank });
		}

		// Locked hand
		if (severity > 2) {
			// Locked hand save (priority 2)
		}

		// 8 clues
		if (severity > 3) {
			// 8 clue save (priority 2)
		}
	}

	logger.info('all stall clues', stall_clues);

	// Go through each priority
	for (const clues of stall_clues) {
		if (clues.length > 0) {
			return clues[0];
		}
	}
}

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
					return target_card.inferred.every(p => Utils.playableAway(state, p.suitIndex, p.rank) !== 0);
				};
				const card_trash = function (target_card) {
					return target_card.inferred.every(p =>
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
						copy.intersect('inferred', find_possibilities(clue, state.num_suits));

						// Fixed if every inference is now unplayable
						return {
							fixed: card_fixed(copy),
							trash: card_trash(copy)};
					});

					if (colour_fix.fixed && !rank_fix.fixed) {
						fix_clues[target].push({ type: ACTION.COLOUR, target, value: card.suitIndex, trash: colour_fix.trash });
					}
					// Always prefer rank fix if it works
					else {
						fix_clues[target].push({ type: ACTION.RANK, target, value: card.rank, trash: rank_fix.trash });
					}
				}
			}
		}
	}
	return fix_clues;
}

module.exports = { find_clues, find_tempo_clues, find_stall_clue, find_fix_clues };
