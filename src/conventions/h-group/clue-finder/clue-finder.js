const { CLUE, ACTION } = require('../../../constants.js');
const { clue_safe } = require('./clue-safe.js');
const { find_fix_clues } = require('./fix-clues.js');
const { determine_clue, direct_clues } = require('./determine-clue.js');
const { find_chop, determine_focus, stall_severity } = require('../hanabi-logic.js');
const { isBasicTrash, isCritical, isSaved, isTrash, visibleFind } = require('../../../basics/hanabi-util.js');
const { logger } = require('../../../logger.js');
const Utils = require('../../../util.js');

function save2(state, target, card) {
	const { suitIndex, rank } = card;

	if (rank !== 2) {
		return false;
	}

	const clue = { type: CLUE.RANK, value: 2, target };

	return state.play_stacks[suitIndex] === 0 &&									// play stack at 0
		visibleFind(state, state.ourPlayerIndex, suitIndex, 2).length === 1 &&	// other copy isn't visible
		!state.hands[state.ourPlayerIndex].some(c => c.matches(suitIndex, rank, { infer: true })) &&   // not in our hand
		clue_safe(state, clue);
}

function find_save(state, target, card) {
	const { suitIndex, rank } = card;

	if (isBasicTrash(state, suitIndex, rank)) {
		return;
	}

	// Save a delayed playable card that isn't visible somewhere else
	if (state.hypo_stacks[suitIndex] + 1 === rank &&
		visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length === 1
	) {
		return determine_clue(state, target, card);
	}

	if (isCritical(state, suitIndex, rank)) {
		logger.warn('saving critical card', Utils.logCard(card));
		if (rank === 5) {
			return { type: ACTION.RANK, value: 5, target };
		}
		else {
			// The card is on chop, so it can always be focused
			return determine_clue(state, target, card);
		}
	}
	else if (save2(state, target, card)) {
		return { type: ACTION.RANK, value: 2, target };
	}
	return;
}

function find_tcm(state, target, saved_cards, trash_card) {
	logger.info(`saved cards ${saved_cards.map(c => Utils.logCard(c)).join(',')}, trash card ${Utils.logCard(trash_card)}`);
	const chop = saved_cards.at(-1);

	// Colour or rank save (if possible) is preferred over trash chop move
	// TODO: Can save variant cards together (like rainbow)
	if (isCritical(state, chop.suitIndex, chop.rank) &&
		(saved_cards.every(c => c.suitIndex === chop.suitIndex) || saved_cards.every(c => c.rank === chop.rank))
	) {
		logger.info('prefer direct save');
		return;
	}
	else if (save2(state, target, chop) && saved_cards.every(c => c.rank === 2)) {
		logger.info('prefer direct 2 save');
		return;
	}
	else if (isTrash(state, state.ourPlayerIndex, chop.suitIndex, chop.rank, chop.order)) {
		logger.info('chop is trash, can give tcm later');
		return;
	}

	let saved_trash = 0;
	// At most 1 trash card should be saved
	for (const card of saved_cards) {
		const { suitIndex, rank, order } = card;

		// Saving a trash card or two of the same card
		if (isTrash(state, state.ourPlayerIndex, suitIndex, rank, order) ||
			saved_cards.some(c => card.matches(c.suitIndex, c.rank) && card.order > c.order)
		) {
			saved_trash++;
			logger.info(`would save trash ${Utils.logCard(card)}`);
		}
	}

	// There has to be more useful cards saved than trash cards, and a trash card should not be on chop (otherwise can wait)
	if (saved_trash <= 1 && (saved_cards.length - saved_trash) > saved_trash) {
		const possible_clues = direct_clues(state, target, trash_card);

		const tcm = possible_clues.find(clue => {
			// Ensure that the card will become known trash
			if (clue.type === CLUE.COLOUR) {
				if (state.play_stacks[clue.value] !== state.max_ranks[clue.value]) {
					return false;
				}
			}
			else if (clue.type === CLUE.RANK) {
				for (let i = 0; i < state.suits.length; i++) {
					// Could be a useful card
					if (state.play_stacks[i] < clue.value && state.max_ranks[i] >= clue.value) {
						return false;
					}
				}
			}

			const touch = state.hands[target].clueTouched(state.suits, clue);
			const { focused_card } = determine_focus(state.hands[target], touch.map(c => c.order), { beforeClue: true });

			return focused_card.order === trash_card.order;
		});

		if (tcm !== undefined) {
			// Convert CLUE to ACTION
			return { type: tcm.type + 2, value: tcm.value, target };
		}
	}
	return;
}

function find_5cm(state, target, chop) {
	const { suitIndex, rank, order } = chop;
	const clue = { type: CLUE.RANK, value: 5, target };

	// The card to be chop moved is useful and not clued/finessed/chop moved elsewhere
	if (rank > state.hypo_stacks[suitIndex] && rank <= state.max_ranks[suitIndex] &&
		!isSaved(state, state.ourPlayerIndex, suitIndex, rank, order) && clue_safe(state, clue)
	) {
		return { type: ACTION.RANK, value: 5, target };
	}

	return;
}

function find_clues(state, options = {}) {
	const play_clues = [], save_clues = [];
	logger.info('play/hypo/max stacks in clue finder:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];
		save_clues[target] = undefined;

		// Ignore our own hand
		if (target === state.ourPlayerIndex || target === options.ignorePlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		const chopIndex = find_chop(hand);

		let found_tcm = false, tried_5cm = false;

		for (let cardIndex = hand.length - 1; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank, finessed } = card;
			const duplicates = visibleFind(state, state.ourPlayerIndex, suitIndex, rank);

			// Ignore finessed cards (do not ignore cm'd cards), cards visible elsewhere, or cards possibly part of a finesse
			if (finessed || duplicates.some(c => (c.clued || c.finessed) && (c.order !== card.order)) ||
				state.waiting_connections.some(c => suitIndex === c.inference.suitIndex && rank <= c.inference.rank)) {
				continue;
			}

			// Save clue
			if (cardIndex === chopIndex) {
				save_clues[target] = find_save(state, target, card);
			}

			// Trash card (not conventionally play)
			if (!options.ignoreCM && isBasicTrash(state, suitIndex, rank)) {
				// Trash chop move (we only want to find the rightmost tcm)
				if (!(card.clued || card.chop_moved) && cardIndex !== chopIndex && !found_tcm) {
					logger.info('looking for tcm on', Utils.logCard(card));
					const saved_cards = hand.slice(cardIndex + 1).filter(c => !(c.clued || c.chop_moved));
					// Use original save clue if tcm not found
					save_clues[target] = find_tcm(state, target, saved_cards, card) || save_clues[target];
					found_tcm = true;
				}
				// TODO: Eventually, trash bluff/finesse/push?
				continue;
			}

			// 5's chop move (only search once, on the rightmost unclued 5 that's not on chop)
			if (rank === 5 && cardIndex !== chopIndex && !tried_5cm && !options.ignoreCM &&
				!(card.clued || card.chop_moved) && stall_severity(state, state.ourPlayerIndex) === 0
			) {
				logger.info('trying 5cm');
				tried_5cm = true;
				let valid_5cm = false;

				// Find where chop is, relative to the rightmost clued 5
				for (let j = cardIndex + 1; j <= chopIndex; j++) {
					// Skip clued/finessed cards
					if (hand[j].clued || hand[j].finessed) {
						continue;
					}

					// Chop is 1 card away from the 5
					if (j === chopIndex) {
						valid_5cm = true;
					}

					// Only look 1 card away`
					break;
				}
				
				if (valid_5cm) {
					// Use original save clue (or look for play clue) if 5cm not found
					const cm5 = find_5cm(state, target, hand[chopIndex]);
					if (cm5 !== undefined) {
						save_clues[target] = cm5;
						continue;
					}
				}
			}

			// Play clue
			const clue = determine_clue(state, target, card);
			if (clue !== undefined) {
				// Not a play clue
				if (clue.result.playables.length === 0) {
					if (cardIndex !== chopIndex) {
						logger.info(`found clue ${Utils.logClue(clue)} that wasn't a save/tcm/5cm/play.`);
					}
					continue;
				}

				play_clues[target].push(clue);
			}
		}
	}

	const fix_clues = find_fix_clues(state, play_clues, save_clues);

	logger.info('found play clues', play_clues.map(clues => clues.map(clue => Utils.logClue(clue))));
	logger.info('found save clues', save_clues.map(clue => Utils.logClue(clue)));
	logger.info('found fix clues', fix_clues.map(clues => clues.map(clue => Utils.logClue(clue))));
	return { play_clues, save_clues, fix_clues };
}

module.exports = { find_clues };
