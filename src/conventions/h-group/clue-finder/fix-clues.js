import { LEVEL } from '../h-constants.js';
import { cardTouched } from '../../../variants.js';
import { direct_clues, isBasicTrash, isSaved, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';
import { get_result } from './determine-clue.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').FixClue} FixClue
 */

/**
 * Finds fix clues for all players. All valid play clues and save clues are also needed
 * as they might be able to elim fix at the same time.
 * @param {State} state
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 * @param {{ignorePlayerIndex?: number}} options
 */
export function find_fix_clues(state, play_clues, save_clues, options = {}) {
	/** @type {FixClue[][]} */
	const fix_clues = [];
	const duplicated_cards = [];

	// Skip ourselves
	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;
		fix_clues[target] = [];

		if (state.level < LEVEL.FIX || target === options.ignorePlayerIndex)
			continue;

		const hand = state.hands[target];

		for (const { clued, order } of hand) {
			const card = state.me.thoughts[order];

			// Card known (or known trash), doesn't need fix
			if (card.possible.length === 1 || card.possible.every(c => isBasicTrash(state, c)))
				continue;

			// Card chop moved but not clued, don't fix
			if (card.chop_moved && !clued)
				continue;

			if (card.inferred.length === 0) {
				// TODO
				logger.debug(`card ${logCard(card)} order ${order} need fix??`);
			}
			else {
				const seems_playable = card.inferred.every(p => {
					const away = playableAway(state, p);
					const our_hand = state.hands[state.ourPlayerIndex];

					// Possibility is immediately playable or 1-away and we have the connecting card
					return away === 0 ||
						(away === 1 && our_hand.some(c => state.me.thoughts[c.order].matches({ suitIndex: p.suitIndex, rank: p.rank - 1 }, { infer: true })));
				});

				const wrong_inference = !card.matches_inferences() && playableAway(state, card) !== 0;

				// We don't need to fix duplicated cards where we hold one copy, since we can just sarcastic discard
				const duplicate = visibleFind(state, state.me, card, { ignore: [state.ourPlayerIndex] }).find(c => c.order !== order && (card.finessed || c.clued));

				const unknown_duplicated = clued && card.inferred.length > 1 && duplicate !== undefined;

				let fix_criteria;
				if (wrong_inference) {
					fix_criteria = inference_corrected;
					logger.info(`card ${logCard(card)} needs fix, wrong inferences ${card.inferred.map(logCard)}`);
				}
				// We only want to give a fix clue to the player whose turn comes sooner
				else if (unknown_duplicated && !duplicated_cards.some(c => c.matches(card))) {
					const matching_connection = state.common.waiting_connections.find(({ connections }) => connections.some(conn => conn.card.order === duplicate.order));
					let needs_fix = true;

					if (matching_connection !== undefined) {
						const { connections, conn_index } = matching_connection;
						const connection_index = connections.findIndex(conn => conn.card.order === duplicate.order);

						// The card is part of a finesse connection that hasn't been played yet
						if (conn_index <= connection_index) {
							logger.warn(`duplicate ${logCard(card)} part of a finesse, not giving fix yet`);
							needs_fix = false;
						}
					}

					if (needs_fix) {
						fix_criteria = duplication_known;
						duplicated_cards.push(card);
						logger.info(`card ${logCard(card)} needs fix, duplicated`);
					}
				}

				// Card doesn't match any inferences and seems playable but isn't (need to fix)
				if (fix_criteria !== undefined) {
					// Try all play clues and save clue if it exists
					const other_clues = play_clues[target].concat(save_clues[target] !== undefined ? [save_clues[target]] : []);

					// Go through all other clues to see if one fixes
					for (const clue of other_clues) {
						// The clue cannot touch the fixed card or it will look like just a fix
						if (cardTouched(card, state.variant, clue))
							continue;

						const { fixed, trash, result } = check_fixed(state, target, order, clue, fix_criteria);

						if (fixed)
							fix_clues[target].push(Object.assign({}, clue, { trash, result, urgent: seems_playable }));
					}

					const possible_clues = direct_clues(state, target, card);
					for (const clue of possible_clues) {
						const { fixed, trash, result } = check_fixed(state, target, order, clue, fix_criteria);

						if (fixed)
							fix_clues[target].push(Object.assign(clue, { trash, result, urgent: seems_playable }));
					}
				}
			}
		}
	}
	return fix_clues;
}

/**
 * A fix criterion. Considered fixed when the card matches at least one of its inferences.
 * @param {State} state
 * @param {number} order
 * @param {number} _target
 */
function inference_corrected(state, order, _target) {
	const card = state.common.thoughts[order];
	const actualCard = state.hands.flat().find(c => c.order === order);

	if (isBasicTrash(state, actualCard))
		return card.possible.every(p => isBasicTrash(state, p));

	return card.possible.every(p => playableAway(state, p) !== 0);
}

/**
 * A fix criterion. Considered fixed when the card becomes known duplicated as an already saved card.
 * @param {State} state
 * @param {number} order
 * @param {number} _target
 */
function duplication_known(state, order, _target) {
	const card = state.common.thoughts[order];
	return card.possible.length === 1 && isSaved(state, state.common, card, order);
}

/**
 * Checks whether the given card is fixed by the clue, according to the fix criteria.
 * @param {State} state
 * @param {number} target
 * @param {number} order
 * @param {Clue} clue
 * @param {(state: State, order: number, target: number) => boolean} fix_criteria
 */
function check_fixed(state, target, order, clue, fix_criteria) {
	const touch = state.hands[target].clueTouched(clue, state.variant);

	const action = /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue });

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	const hypo_state = state.simulate_clue(action, { enableLogs: true, simulatePlayerIndex: target });
	const card_after_cluing = hypo_state.common.thoughts[order];

	const result = {
		fixed: fix_criteria(hypo_state, order, target),
		trash: card_after_cluing.possible.every(p => isTrash(hypo_state, state.common, p, order)),
		result: get_result(state, hypo_state, clue, state.ourPlayerIndex)
	};

	logger.flush(result.fixed);

	return result;
}
