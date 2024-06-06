import { LEVEL } from '../h-constants.js';
import { cardTouched, direct_clues } from '../../../variants.js';
import { isSaved, isTrash, visibleFind } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';
import { get_result } from './determine-clue.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').Card} Card
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 * @typedef {import('../../../types.js').FixClue} FixClue
 */

/**
 * Finds fix clues for all players. All valid play clues and save clues are also needed
 * as they might be able to elim fix at the same time.
 * @param {Game} game
 * @param {Clue[][]} play_clues
 * @param {SaveClue[]} save_clues
 */
export function find_fix_clues(game, play_clues, save_clues) {
	const { common, me, state } = game;

	/** @type {FixClue[][]} */
	const fix_clues = [];
	const duplicated_cards = [];

	// Skip ourselves
	for (let i = 1; i < state.numPlayers; i++) {
		const target = (state.ourPlayerIndex + i) % state.numPlayers;
		fix_clues[target] = [];

		if (game.level < LEVEL.FIX)
			continue;

		for (const { clued, order } of state.hands[target]) {
			const card = me.thoughts[order];

			// Card known (or known trash), doesn't need fix
			if (card.possible.length === 1 || card.possible.every(p => state.isBasicTrash(p)))
				continue;

			// Card chop moved but not clued, don't fix
			if (card.chop_moved && !clued)
				continue;

			// Part of a symmetric waiting connection
			if (common.dependentConnections(order).some(wc => wc.symmetric))
				continue;

			if (card.inferred.length === 0) {
				logger.debug(`card ${logCard(card)} order ${order} need fix??`);
				continue;
			}

			const seems_playable = card.inferred.every(p => {
				const away = state.playableAway(p);
				const our_hand = state.hands[state.ourPlayerIndex];

				// Possibility is immediately playable or 1-away and we have the connecting card
				return away === 0 ||
					(away === 1 && our_hand.some(c => me.thoughts[c.order].matches({ suitIndex: p.suitIndex, rank: p.rank - 1 }, { infer: true })));
			});

			// We don't need to fix cards where we hold one copy, since we can just sarcastic discard
			if (state.hands[state.ourPlayerIndex].some(c => me.thoughts[c.order].matches(card, { infer: true })))
				continue;

			const wrong_inference = !card.matches_inferences() && state.playableAway(card) !== 0;

			const duplicate = visibleFind(state, me, card).find(c => c.order !== order && common.thoughts[c.order].touched);
			const unknown_duplicated = clued && card.inferred.length > 1 && duplicate !== undefined;

			let fix_criteria;
			if (wrong_inference) {
				fix_criteria = inference_corrected;
				logger.info(`card ${logCard(card)} needs fix, wrong inferences ${card.inferred.map(logCard)}`);
			}
			// We only want to give a fix clue to the player whose turn comes sooner
			else if (unknown_duplicated && !duplicated_cards.some(c => c.matches(card))) {

				const matching_connection = common.waiting_connections.find(({ connections }) => connections.some(conn => conn.card.order === duplicate.order));
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

					const { fixed, trash, result } = check_fixed(game, target, order, clue, fix_criteria);

					if (fixed)
						fix_clues[target].push(Object.assign({}, clue, { trash, result, urgent: seems_playable }));
				}

				const possible_clues = direct_clues(state.variant, target, card);
				for (const clue of possible_clues) {
					const { fixed, trash, result } = check_fixed(game, target, order, clue, fix_criteria);

					if (fixed)
						fix_clues[target].push(Object.assign(clue, { trash, result, urgent: seems_playable }));
				}
			}
		}
	}
	return fix_clues;
}

/**
 * A fix criterion. Considered fixed when the card matches at least one of its inferences.
 * @param {Game} game
 * @param {number} order
 * @param {number} _target
 */
function inference_corrected(game, order, _target) {
	const { common, state } = game;
	const card = common.thoughts[order];
	const actualCard = state.hands.flat().find(c => c.order === order);

	if (state.isBasicTrash(actualCard))
		return card.possible.every(p => state.isBasicTrash(p));

	return card.possible.every(p => !state.isPlayable(p));
}

/**
 * A fix criterion. Considered fixed when the card becomes known duplicated as an already saved card.
 * @param {Game} game
 * @param {number} order
 * @param {number} _target
 */
function duplication_known(game, order, _target) {
	const { common, state } = game;
	const card = common.thoughts[order];
	return card.possible.length === 1 && isSaved(state, common, card, order);
}

/**
 * Checks whether the given card is fixed by the clue, according to the fix criteria.
 * @param {Game} game
 * @param {number} target
 * @param {number} order
 * @param {Clue} clue
 * @param {(game: Game, order: number, target: number) => boolean} fix_criteria
 */
function check_fixed(game, target, order, clue, fix_criteria) {
	const { state } = game;
	const touch = state.hands[target].clueTouched(clue, state.variant);

	const action = /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list: touch.map(c => c.order), clue });

	// Prevent outputting logs until we know that the result is correct
	logger.collect();

	const hypo_game = game.simulate_clue(action, { enableLogs: true });
	const { common: hypo_common, state: hypo_state } = hypo_game;
	const card_after_cluing = hypo_common.thoughts[order];

	const result = {
		fixed: fix_criteria(hypo_game, order, target),
		trash: card_after_cluing.possible.every(p => isTrash(hypo_state, hypo_common, p, order, { infer: true })),
		result: get_result(game, hypo_game, clue, state.ourPlayerIndex)
	};

	logger.flush(result.fixed);

	return result;
}
