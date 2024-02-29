import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { cardTouched, variantRegexes } from '../../../variants.js';
import { clue_safe } from './clue-safe.js';
import { find_fix_clues } from './fix-clues.js';
import { determine_clue, get_result } from './determine-clue.js';
import { stall_severity, valuable_tempo_clue } from '../hanabi-logic.js';
import { cardValue, direct_clues, isBasicTrash, isCritical, isTrash, save2, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';
import { find_possibilities } from '../../../basics/helper.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').ClueResult} ClueResult
 * @typedef {import('../../../types.js').PerformAction} PerformAction
 */

/**
 * Finds a save clue (if necessary) for the given card in the target's hand.
 * @param {State} state
 * @param {number} target
 * @param {ActualCard} card
 * @returns {SaveClue | undefined} The save clue if necessary, otherwise undefined.
 */
function find_save(state, target, card) {
	const { suitIndex, rank } = card;

	if (isBasicTrash(state, card))
		return;

	if (isCritical(state, card)) {
		logger.highlight('yellow', 'saving critical card', logCard(card));
		if (rank === 5) {
			const defaultClue = { type: CLUE.RANK, value: 5, target, playable: false, cm: [], safe: true };
			if (cardTouched(card, state.variant, defaultClue))
				return defaultClue;
			logger.highlight('red', 'unable to save', logCard(card), 'with a 5 clue due to the variant.');
		}
		// The card is on chop, so it can always be focused
		const save_clue = determine_clue(state, target, card, { save: true });

		if (save_clue === undefined) {
			logger.error(`unable to find critical save clue for ${logCard(card)}!`);
			return;
		}
		return Object.assign(save_clue, { playable: false, cm: [], safe: true });
	}
	// Save a non-critical delayed playable card that isn't visible somewhere else
	else if (state.me.hypo_stacks[suitIndex] + 1 === rank && visibleFind(state, state.me, card).length === 1) {
		logger.highlight('yellow', 'saving playable card', logCard(card));
		const save_clue = determine_clue(state, target, card, { save: true });

		if (save_clue === undefined) {
			logger.error(`unable to find playable save clue for ${logCard(card)}!`);
			return;
		}

		return Object.assign(save_clue, { playable: true, cm: [], safe: clue_safe(state, state.me, save_clue) });
	}
	else if (save2(state, state.me, card)) {
		logger.highlight('yellow', 'saving unique 2', logCard(card));

		if (state.variant.suits[card.suitIndex].match(variantRegexes.brownish)) {
			logger.highlight('red', 'unable to save', logCard(card), 'with a 2 clue due to variant.');
			const save_clue = determine_clue(state, target, card, { save: true });
			const safe = clue_safe(state, state.me, save_clue);
			return { type: save_clue.type, value: save_clue.value, target, playable: false, cm: [], safe };
		}

		const safe = clue_safe(state, state.me, { type: CLUE.RANK, value: 2 , target });
		return { type: CLUE.RANK, value: 2, target, playable: false, cm: [], safe };
	}
}

/**
 * Finds a Trash Chop Move (if valid) using the given trash card in the target's hand.
 * @param {State} state
 * @param {number} target
 * @param {ActualCard[]} saved_cards
 * @param {Card} trash_card
 * @param {Clue[]} play_clues
 * @returns {SaveClue | undefined} The TCM if valid, otherwise undefined.
 */
function find_tcm(state, target, saved_cards, trash_card, play_clues) {
	logger.info(`attempting tcm with trash card ${logCard(trash_card)}, saved cards ${saved_cards.map(logCard).join(',')}`);
	const chop = saved_cards.at(-1);

	// Critical cards and unique 2s can be saved directly if touching all cards
	if ((isCritical(state, chop) || (save2(state, state.me, chop) && !state.variant.suits[chop.suitIndex].match(variantRegexes.brownish) && clue_safe(state, state.me, { type: CLUE.RANK, value: 2, target }))) &&
		(direct_clues(state, target, chop).some(clue => saved_cards.every(c => cardTouched(c, state.variant, clue))))
	) {
		logger.info('prefer direct save');
		return;
	}
	else if (play_clues.some(clue => saved_cards.every(c => cardTouched(c, state.variant, clue)))) {
		logger.info('prefer play clue to save');
		return;
	}
	else if (isTrash(state, state.me, chop, chop.order) || saved_cards.some(c => c.duplicateOf(chop))) {
		logger.info('chop is trash, can give tcm later');
		return;
	}

	// TODO: Should visible (but not saved, possibly on chop?) cards be included as trash?
	const saved_trash = saved_cards.filter(card =>
		isTrash(state, state.me, card, card.order) ||						// Saving a trash card
		saved_cards.some(c => card.matches(c) && card.order > c.order)		// Saving 2 of the same card
	).map(logCard);

	logger.info(`would save ${saved_trash.length === 0 ? 'no' : saved_trash.join()} trash`);

	// There has to be more useful cards saved than trash cards
	if (saved_trash.length <= 1 && (saved_cards.length - saved_trash.length) > saved_trash.length) {
		const possible_clues = direct_clues(state, target, trash_card);

		// Ensure that the card will become known trash
		const tcm = possible_clues.find(clue => find_possibilities(clue, state.variant).every(c => isBasicTrash(state, c)));

		if (tcm !== undefined)
			return Object.assign(tcm, { playable: false, cm: saved_cards, safe: true });
	}
}

/**
 * Finds a 5's Chop Move (if valid) with the given chop moved card in the target's hand.
 * @param {State} 	state
 * @param {number} 	target
 * @param {ActualCard} 	chop
 * @param {number} 	cardIndex
 * @returns {SaveClue | undefined} The 5CM if valid, otherwise undefined.
 */
function find_5cm(state, target, chop, cardIndex) {
	if (state.common.hypo_stacks.every((stack, index) => stack >= (state.max_ranks[index] - 1))) {
		logger.info(`looks like stall or direct play`);
		return;
	}

	// Card to be chop moved is basic trash or already saved
	if (isTrash(state, state.me, chop, chop.order))
		return;

	const new_chop = state.hands[target].slice(0, cardIndex).toReversed().find(c => !c.clued);

	// 5cm if new chop is less valuable than old chop (or lock for unique 2/critical)
	if (cardValue(state, state.me, chop) >= (new_chop ? cardValue(state, state.me, new_chop) : 4))
		return { type: CLUE.RANK, value: 5, target, playable: false, cm: [chop], safe: true };
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
	const play_clues = /** @type Clue[][] */ 	([]);
	const save_clues = /** @type SaveClue[] */ 	([]);
	const stall_clues = /** @type Clue[][] */ 	([[], [], [], []]);

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, state.me.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];
		const saves = [];

		// Ignore our own hand
		if (target === state.ourPlayerIndex || target === options.ignorePlayerIndex)
			continue;

		const hand = state.hands[target];
		const chopIndex = state.me.chopIndex(hand);

		let found_tcm = false, tried_5cm = false;
		const severity = stall_severity(state, state.me, state.ourPlayerIndex);

		for (let cardIndex = hand.length - 1; cardIndex >= 0; cardIndex--) {
			const { rank, order } = hand[cardIndex];
			const card = state.me.thoughts[order];

			const duplicated = visibleFind(state, state.me, card).some(c => state.me.thoughts[c.order].touched && c.order !== order);

			const in_finesse = state.common.waiting_connections.some(w_conn => {
				const { fake, focused_card, inference } = w_conn;
				const matches = state.me.thoughts[focused_card.order].matches(inference, { assume: true });

				return !fake && matches && card.playedBefore(inference, { equal: true });
			});

			// Ignore finessed cards (do not ignore cm'd cards), cards visible elsewhere, or cards possibly part of a finesse (that we either know for certain or in our hand)
			if (card.finessed || duplicated || in_finesse)
				continue;

			// Save clue
			if (cardIndex === chopIndex)
				saves.push(find_save(state, target, hand[cardIndex]));

			let interpreted_5cm = false;

			if (state.level >= LEVEL.BASIC_CM && !options.ignoreCM) {
				// Trash card (not conventionally play)
				if (isBasicTrash(state, card)) {
					// Trash chop move (we only want to find the rightmost tcm)
					if (!card.saved && cardIndex !== chopIndex && !found_tcm) {
						const saved_cards = hand.slice(cardIndex + 1).filter(c => !state.me.thoughts[c.order].saved);

						saves.push(find_tcm(state, target, saved_cards, card, play_clues[target]));

						found_tcm = true;
						logger.info('--------');
					}
					// TODO: Eventually, trash bluff/finesse/push?
					continue;
				}

				// 5's chop move (only search once, on the rightmost unclued 5 that's not on chop)
				if (!tried_5cm && !state.variant.suits[card.suitIndex].match(variantRegexes.brownish) && rank === 5 && !card.saved && severity === 0) {
					logger.info('trying 5cm with 5 at index', cardIndex);
					tried_5cm = true;

					// Find where chop is, relative to the rightmost clued 5
					let distance_from_chop = 0;
					for (let j = cardIndex; j < chopIndex; j++) {
						// Skip clued cards
						if (hand[j].clued)
							continue;

						distance_from_chop++;
					}

					if (distance_from_chop === 1) {
						if (state.common.thoughts[hand[chopIndex].order].possible.some(p =>
							p.rank !== 5 && !isTrash(state, state.common, p, hand[chopIndex].order, { infer: true }))
						) {
							saves.push(find_5cm(state, target, hand[chopIndex], cardIndex));

							logger.info('found 5cm');
							interpreted_5cm = true;
						}
						else {
							logger.info('no cards left to 5cm');
						}
					}
					else {
						logger.info(`rightmost 5 is ${distance_from_chop} from chop, cannot 5cm`);
					}
				}
			}

			// Ignore trash cards
			if (isTrash(state, state.me, card, order))
				continue;

			// Play clue
			const clue = determine_clue(state, target, hand[cardIndex], { excludeRank: interpreted_5cm });
			if (clue !== undefined) {
				const { playables, elim, new_touched } = clue.result;

				if (playables.length > 0) {
					const { tempo, valuable } = valuable_tempo_clue(state, state.common, clue, playables, hand[cardIndex]);
					if (tempo && !valuable)
						stall_clues[1].push(clue);
					else
						play_clues[target].push(clue);
				}
				// Stall clues
				else if (severity > 0) {
					if (clue.type === CLUE.RANK && clue.value === 5 && !hand[cardIndex].clued) {
						logger.info('5 stall', logClue(clue));
						stall_clues[0].push(clue);
					}
					else if (cardIndex === chopIndex && chopIndex !== 0) {
						logger.info('locked hand save', logClue(clue));
						stall_clues[2].push(clue);
					}
					else if (new_touched === 0) {
						if (elim > 0) {
							logger.info('fill in', logClue(clue));
							stall_clues[2].push(clue);
						}
						else {
							logger.info('hard burn', logClue(clue));
							stall_clues[3].push(clue);
						}
					}
					else {
						logger.info('unknown valid clue??', logClue(clue));
					}
				}
			}
			logger.info('--------');
		}

		save_clues[target] = Utils.maxOn(saves.filter(c => c !== undefined), (save_clue) => {
			const { type, value, target } = save_clue;
			const list = hand.clueTouched(save_clue, state.variant).map(c => c.order);
			const hypo_state = state.simulate_clue({ type: 'clue', clue: { type, value }, giver: state.ourPlayerIndex, target, list });
			const result = get_result(state, hypo_state, save_clue, state.ourPlayerIndex);

			return find_clue_value(result);
		});
	}

	const fix_clues = find_fix_clues(state, play_clues, save_clues, options);

	if (play_clues.some(clues => clues.length > 0))
		logger.info('found play clues', play_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	if (save_clues.some(clue => clue !== undefined))
		logger.info('found save clues', save_clues.filter(clue => clue !== undefined).map(clue => logClue(clue)));

	if (fix_clues.some(clues => clues.length > 0))
		logger.info('found fix clues', fix_clues.flatMap(clues => clues.map(clue => logClue(clue) + (clue.trash ? ' (trash)' : ''))));

	if (stall_clues.some(clues => clues.length > 0))
		logger.info('found stall clues', stall_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	return { play_clues, save_clues, fix_clues, stall_clues };
}
