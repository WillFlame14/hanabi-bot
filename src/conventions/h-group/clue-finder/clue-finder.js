import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { card_value, clue_safe, save2 } from './clue-safe.js';
import { find_fix_clues } from './fix-clues.js';
import { determine_clue, direct_clues, get_result } from './determine-clue.js';
import { find_chop, stall_severity } from '../hanabi-logic.js';
import { isBasicTrash, isCritical, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';
import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 * @typedef {import('../../../types.js').PerformAction} PerformAction
 */

/**
 * Finds a save clue (if necessary) for the given card in the target's hand.
 * @param {State} state
 * @param {number} target
 * @param {Card} card
 * @returns {SaveClue | undefined} The save clue if necessary, otherwise undefined.
 */
function find_save(state, target, card) {
	const { suitIndex, rank } = card;

	if (isBasicTrash(state, suitIndex, rank)) {
		return;
	}

	// Save a delayed playable card that isn't visible somewhere else
	if (state.hypo_stacks[suitIndex] + 1 === rank && visibleFind(state, state.ourPlayerIndex, suitIndex, rank).length === 1) {
		return Object.assign(determine_clue(state, target, card, { save: true }), { playable: true });
	}

	if (isCritical(state, suitIndex, rank)) {
		logger.warn('saving critical card', logCard(card));
		if (rank === 5) {
			return { type: CLUE.RANK, value: 5, target, playable: false };
		}
		else {
			// The card is on chop, so it can always be focused
			return Object.assign(determine_clue(state, target, card, { save: true }), { playable: false });
		}
	}
	else if (save2(state, target, card) && clue_safe(state, { type: CLUE.RANK, value: 2 , target })) {
		return { type: CLUE.RANK, value: 2, target, playable: false };
	}
	return;
}

/**
 * Finds a Trash Chop Move (if valid) using the given trash card in the target's hand.
 * @param {State} state
 * @param {number} target
 * @param {Card[]} saved_cards
 * @param {Card} trash_card
 * @param {Clue[]} play_clues
 * @returns {SaveClue | undefined} The TCM if valid, otherwise undefined.
 */
function find_tcm(state, target, saved_cards, trash_card, play_clues) {
	logger.info(`attempting tcm with trash card ${logCard(trash_card)}, saved cards ${saved_cards.map(c => logCard(c)).join(',')}`);
	const chop = saved_cards.at(-1);

	// Colour or rank save (if possible) is preferred over trash chop move
	// TODO: Can save variant cards together (like rainbow)
	if ((isCritical(state, chop.suitIndex, chop.rank) || save2(state, target, chop)) &&
		(saved_cards.every(c => c.suitIndex === chop.suitIndex) || saved_cards.every(c => c.rank === chop.rank))
	) {
		logger.info('prefer direct save');
		return;
	}
	else if (play_clues.some(clue => saved_cards.every(c => state.hands[target].clueTouched(state.suits, clue).some(card => card.order === c.order)))) {
		logger.info('prefer play clue to save');
		return;
	}
	else if (isTrash(state, state.ourPlayerIndex, chop.suitIndex, chop.rank, chop.order) ||
		saved_cards.some(c => c.matches(chop.suitIndex, chop.rank) && c.order !== chop.order)	// A duplicated card is also trash
	) {
		logger.info('chop is trash, can give tcm later');
		return;
	}

	const saved_trash = saved_cards.filter(card => {
		const {suitIndex, rank, order} = card;

		return isTrash(state, state.ourPlayerIndex, suitIndex, rank, order) ||					// Saving a trash card
			saved_cards.some(c => card.matches(c.suitIndex, c.rank) && card.order > c.order) ||	// Saving 2 of the same card
			state.hands.some((hand, index) =>
				hand.findCards(suitIndex, rank, { infer: index === state.ourPlayerIndex }).some(c =>
					c.order !== order && hand[find_chop(hand)].order !== order));		// Saving a copy of a visible card that isn't on chop
	}).map(c => logCard(c));

	logger.info(`would save ${saved_trash.length === 0 ? 'no' : saved_trash.join()} trash`);

	// There has to be more useful cards saved than trash cards
	if (saved_trash.length <= 1 && (saved_cards.length - saved_trash.length) > saved_trash.length) {
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

			return true;
		});

		if (tcm !== undefined) {
			return { type: tcm.type, value: tcm.value, target, playable: false };
		}
	}
	return;
}

/**
 * Finds a 5's Chop Move (if valid) with the given chop moved card in the target's hand.
 * @param {State} 	state
 * @param {number} 	target
 * @param {Card} 	chop
 * @param {number} 	cardIndex
 * @returns {SaveClue | undefined} The 5CM if valid, otherwise undefined.
 */
function find_5cm(state, target, chop, cardIndex) {
	const { suitIndex, rank, order } = chop;

	// Card to be chop moved is basic trash or already saved
	if (isTrash(state, state.ourPlayerIndex, suitIndex, rank, order)) {
		return;
	}

	let new_chop;
	for (let i = cardIndex - 1; i >= 0; i--) {
		const card = state.hands[target][i];
		if (card.clued) {
			continue;
		}
		new_chop = card;
		break;
	}

	// 5cm to lock for unique 2 or critical
	if (new_chop === undefined) {
		if (card_value(state, chop) >= 4) {
			return { type: CLUE.RANK, value: 5, target, playable: false };
		}
	}
	else {
		// 5cm if new chop is less valuable than old chop
		if (card_value(state, chop) >= card_value(state, new_chop)) {
			return { type: CLUE.RANK, value: 5, target, playable: false };
		}
	}

	return;
}

/**
 * Finds all play, save and fix clues for the given state.
 * Play and fix clues are 2D arrays as each player can potentially receive multiple play/fix clues.
 * Each player has only one save clue.
 * 
 * The 'ignorePlayerIndex' option skips finding clues for a particular player.
 * 
 * The 'ignoreCM' option prevents looking for save clues that cause chop moves.
 * @param {State} state
 * @param {{ignorePlayerIndex?: number, ignoreCM?: boolean}} options
 */
export function find_clues(state, options = {}) {
	/** @type Clue[][] */
	const play_clues = [];
	/** @type SaveClue[] */
	const save_clues = [];

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];
		const saves = [];

		// Ignore our own hand
		if (target === state.ourPlayerIndex || target === options.ignorePlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		const chopIndex = find_chop(hand);

		let found_tcm = false, tried_5cm = false;
		const severity = stall_severity(state, state.ourPlayerIndex);

		for (let cardIndex = hand.length - 1; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank, order, finessed } = card;
			const duplicates = visibleFind(state, state.ourPlayerIndex, suitIndex, rank);

			// Ignore finessed cards (do not ignore cm'd cards), cards visible elsewhere, or cards possibly part of a finesse (that we either know for certain or in our hand)
			if (finessed || duplicates.some(c => (c.clued || c.finessed) && (c.order !== card.order)) ||
				state.waiting_connections.some(c => (c.focused_card.suitIndex === -1 || c.inference.suitIndex === c.focused_card.suitIndex) && suitIndex === c.inference.suitIndex && rank <= c.inference.rank)) {
				continue;
			}

			// Save clue
			if (cardIndex === chopIndex) {
				saves.push(find_save(state, target, card));
			}

			let interpreted_5cm = false;

			if (state.level >= LEVEL.BASIC_CM && !options.ignoreCM) {
				// Trash card (not conventionally play)
				if (isBasicTrash(state, suitIndex, rank)) {
					// Trash chop move (we only want to find the rightmost tcm)
					if (!(card.clued || card.chop_moved) && cardIndex !== chopIndex && !found_tcm) {
						const saved_cards = hand.slice(cardIndex + 1).filter(c => !(c.clued || c.chop_moved));
						saves.push(find_tcm(state, target, saved_cards, card, play_clues[target]));

						found_tcm = true;
						logger.info('--------');
					}
					// TODO: Eventually, trash bluff/finesse/push?
					continue;
				}

				// 5's chop move (only search once, on the rightmost unclued 5 that's not on chop)
				if (!tried_5cm && rank === 5 && !(card.clued || card.chop_moved)) {
					logger.info('trying 5cm with 5 at index', cardIndex);
					tried_5cm = true;

					// Can only perform a 5cm at severity 0 (otherwise, looks like 5 stall)
					// Allow giving direct 5 clues when every hypo stack is at (max - 1) or above
					if (severity === 0 && !state.hypo_stacks.every((stack, index) => stack >= (state.max_ranks[index] - 1))) {
						// Find where chop is, relative to the rightmost clued 5
						let distance_from_chop = 0;
						for (let j = cardIndex; j < chopIndex; j++) {
							// Skip clued cards
							if (hand[j].clued) {
								continue;
							}
							distance_from_chop++;
						}

						if (distance_from_chop === 1) {
							saves.push(find_5cm(state, target, hand[chopIndex], cardIndex));

							logger.info('found 5cm');
							interpreted_5cm = true;
						}
						else {
							logger.info(`rightmost 5 is ${distance_from_chop} from chop, cannot 5cm`);
						}
					}
					else {
						logger.info(`looks like stall or direct play`);
					}
				}
			}

			// Ignore trash cards
			if (isTrash(state, state.ourPlayerIndex, suitIndex, rank, order)) {
				continue;
			}

			// Play clue
			const clue = determine_clue(state, target, card, { excludeRank: interpreted_5cm });
			if (clue !== undefined) {
				// Not a play clue
				if (clue.result.playables.length === 0) {
					if (cardIndex !== chopIndex) {
						logger.info(`found clue ${logClue(clue)} that wasn't a save/tcm/5cm/play.`);
					}
					logger.info('--------');
					continue;
				}

				play_clues[target].push(clue);
			}
			logger.info('--------');
		}

		save_clues[target] = Utils.maxOn(saves.filter(c => c !== undefined), (save_clue) => {
			const { type, value, target } = save_clue;
			const list = state.hands[target].clueTouched(state.suits, save_clue).map(c => c.order);
			const hypo_state = state.simulate_clue({ type: 'clue', clue: { type, value }, giver: state.ourPlayerIndex, target, list });
			const result = /** @type {ClueResult} */ (get_result(state, hypo_state, save_clue));

			return find_clue_value(result);
		});
	}

	const fix_clues = find_fix_clues(state, play_clues, save_clues, options);

	if (play_clues.some(clues => clues.length > 0)) {
		logger.info('found play clues', play_clues.map(clues => clues.map(clue => logClue(clue))).flat());
	}
	if (save_clues.some(clue => clue !== undefined)) {
		logger.info('found save clues', save_clues.filter(clue => clue !== undefined).map(clue => logClue(clue)));
	}
	if (fix_clues.some(clues => clues.length > 0)) {
		logger.info('found fix clues', fix_clues.map(clues => clues.map(clue => logClue(clue))).flat());
	}

	return { play_clues, save_clues, fix_clues };
}
