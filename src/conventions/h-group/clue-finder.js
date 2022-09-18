const { determine_clue, clue_safe } = require('./clue-helper.js');
const { find_chop, find_prompt, find_finesse } = require('./hanabi-logic.js');
const { ACTION, CLUE, find_possibilities } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function valid_play(state, target, card) {
	const { suitIndex, rank } = card;
	const finesses = state.hands.map(_ => []);
	const known_cards = state.hands.map(hand => hand.filter(card => card.possible.length === 1 || card.inferred.length === 1)).flat();
	logger.info(`checking if ${card.toString()} is a valid play`);

	for (let conn_rank = state.hypo_stacks[suitIndex] + 1; conn_rank < rank; conn_rank++) {
		logger.info('looking for connecting', Utils.logCard(suitIndex, conn_rank).toString());

		if (!known_cards.some(c => c.matches(suitIndex, conn_rank))) {
			let found = false;

			// Try looking for prompt or finesse (note: cannot prompt or finesse on self)
			for (let i = 1; i < state.numPlayers; i++) {
				const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;
				const hand = state.hands[playerIndex];

				const prompt = find_prompt(hand, suitIndex, rank);

				// No prompt available, look for finesse
				if (prompt === undefined) {
					const finesse = find_finesse(hand, suitIndex, conn_rank, finesses[playerIndex]);

					if (finesse?.matches(suitIndex, conn_rank)) {
						// Finesse found, move the player's finesse position by 1
						logger.info('found finesse');
						finesses[playerIndex].push(finesse.order);
						found = true;
						break;
					}
				}
				else if (!prompt.matches(suitIndex, conn_rank)) {
					// Prompt doesn't match, we shouldn't look for a finesse (would be wrong prompt)
					logger.info(`would be wrong prompt on ${prompt.toString()}`);
					continue;
				}
				else {
					logger.info('found prompt');
					found = true;
					break;
				}
			}

			if (!found) {
				return { valid: false };
			}
		}
	}
	logger.debug(card.toString(),'is a valid play clue!');
	return { valid: true, finesses: finesses.reduce((sum, curr) => sum + curr.length, 0), self: finesses[target].length > 0 };
}

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

		for (let cardIndex = chopIndex; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank, clued, finessed } = card;

			// Clued, finessed, trash, visible elsewhere or possibly part of a finesse
			if (clued || finessed || rank <= state.hypo_stacks[suitIndex] || rank > state.max_ranks[suitIndex] ||
				Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).some(c => c.clued || c.finessed) ||
				state.waiting_connections.some(c => suitIndex === c.inference.suitIndex && rank <= c.inference.rank)) {
				continue;
			}

			const { valid, finesses, self } = valid_play(state, target, card);

			if (valid) {
				// Play clue
				const clue = determine_clue(state, target, card, self ? ACTION.RANK: undefined);
				if (clue !== undefined && clue_safe(state, clue)) {
					play_clues[target].push(Object.assign(clue, {finesses}));

					// Save a playable card if it's on chop and its duplicate is not visible somewhere
					if (cardIndex === chopIndex && Utils.visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length === 1) {
						save_clues[target] = clue;
					}
				}
			}
			else if (cardIndex === chopIndex && !card.finessed) {
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
				else {
					logger.debug('not saving card', card.toString(), 'on chop');
				}
			}
		}
	}

	const fix_clues = find_fix_clues(state, play_clues, save_clues);

	logger.debug('found play clues', play_clues);
	logger.info('found save clues', save_clues);
	logger.debug('found fix clues', fix_clues);
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
				const matches_inferences = card.inferred.length > 0 && card.inferred.some(p => card.matches(p.suitIndex, p.rank));
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
				if (!matches_inferences && seems_playable && state.play_stacks[card.suitIndex] + 1 !== card.rank) {
					let found_clue = false;

					let other_clues = play_clues[target];
					other_clues.push(save_clues[target]);
					other_clues = other_clues.filter(clue => clue !== undefined);

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						// The clue cannot touch the fixed card or it will look like just a fix
						if ((clue.type === CLUE.COLOUR && clue.value === card.suitIndex) ||
							(clue.type === CLUE.RANK && clue.value === card.rank)) {
							continue;
						}

						const copy = card.clone();
						copy.intersect('inferred', find_possibilities(clue, state.num_suits));

						if (card_fixed(copy)) {
							// TODO: Find the highest value play clue
							fix_clues[target].push(Object.assign(clue, { trash: card_trash(copy) }));
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
