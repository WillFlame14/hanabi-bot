import { LEVEL } from '../h-constants.js';
import { cardTouched, direct_clues, variantRegexes } from '../../../variants.js';
import { isSaved, isTrash, knownAs, visibleFind } from '../../../basics/hanabi-util.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import { get_result } from './determine-clue.js';
import { CLUE } from '../../../constants.js';
import { order_1s } from '../action-helper.js';

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

		for (const order of state.hands[target]) {
			const card = me.thoughts[order];

			const pink_1s = () => {
				if (!state.includesVariant(variantRegexes.pinkish))
					return false;

				const unknown_1s = state.hands[target].filter(o => state.deck[o].clues.every(clue => clue.type === CLUE.RANK && clue.value === 1));
				const ordered_1s = order_1s(state, common, unknown_1s, { no_filter: true });

				return ordered_1s[0] !== undefined && state.isPlayable(state.deck[ordered_1s[0]]);
			};

			const fix_unneeded = card.possible.length === 1 ||
				card.possible.every(p => state.isBasicTrash(p)) ||
				(card.chop_moved && !state.deck[order].clued) ||										// Card chop moved but not clued, don't fix
				common.dependentConnections(order).some(wc => wc.symmetric)	||		// Part of a symmetric waiting connection
				card.inferred.length === 0 ||
				pink_1s();

			if (fix_unneeded)
				continue;

			const seems_playable = card.inferred.every(p => {
				const away = state.playableAway(p);

				// Possibility is immediately playable or 1-away and we have the connecting card
				return away === 0 ||
					(away === 1 && state.ourHand.some(o => me.thoughts[o].matches({ suitIndex: p.suitIndex, rank: p.rank - 1 }, { infer: true })));
			});

			// We don't need to fix cards where we hold one copy, since we can just sarcastic discard
			if (state.ourHand.some(o => me.thoughts[o].matches(card, { infer: true })))
				continue;

			const wrong_inference = !state.hasConsistentInferences(card) && state.playableAway(card) !== 0;

			const duplicate = visibleFind(state, me, card).find(o => o !== order && common.thoughts[o].touched);
			const unknown_duplicated = card.clued && card.inferred.length > 1 && duplicate !== undefined;

			let fix_criteria;
			if (wrong_inference) {
				fix_criteria = inference_corrected;
				logger.highlight('yellow', `card ${logCard(card)} needs fix, wrong inferences ${card.inferred.map(logCard)} (urgent? ${seems_playable})`);
			}
			// We only want to give a fix clue to the player whose turn comes sooner
			else if (unknown_duplicated && !duplicated_cards.some(c => c.matches(card))) {

				const matching_connection = common.waiting_connections.find(({ connections }) => connections.some(conn => conn.order === duplicate));
				let needs_fix = true;

				if (matching_connection !== undefined) {
					const { connections, conn_index } = matching_connection;
					const connection_index = connections.findIndex(conn => conn.order === duplicate);

					// The card is part of a finesse connection that hasn't been played yet
					if (conn_index <= connection_index) {
						logger.warn(`duplicate ${logCard(card)} part of a finesse, not giving fix yet`);
						needs_fix = false;
					}
				}

				if (needs_fix) {
					fix_criteria = duplication_known;
					duplicated_cards.push(card);
					logger.highlight('yellow', `card ${logCard(card)} needs fix, duplicated (urgent? ${seems_playable})`);
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

					if (fixed && (result.bad_touch.length === 0 || (state.strikes === 2 && seems_playable)))
						fix_clues[target].push(Object.assign({}, clue, { trash, result, urgent: seems_playable }));
				}

				const possible_clues = direct_clues(state.variant, target, card);
				for (const clue of possible_clues) {
					const { fixed, trash, result } = check_fixed(game, target, order, clue, fix_criteria);

					if (fixed && (result.bad_touch.length === 0 || (state.strikes === 2 && seems_playable)))
						fix_clues[target].push(Object.assign({}, clue, { trash, result, urgent: seems_playable }));
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

	if (state.isBasicTrash(state.deck[order]))
		return card.possible.every(p => state.isBasicTrash(p));

	// Revealed to be pink
	if (knownAs(game, order, variantRegexes.pinkish))
		return card.inferred.every(i => !state.isPlayable(i)) && state.hasConsistentInferences(card);

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
	const list = state.clueTouched(state.hands[target], clue);

	const action = /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });

	// Prevent outputting logs until we know that the result is correct
	logger.collect();
	logger.highlight('green', `------- ENTERING HYPO ${logClue(clue)} -------`);

	const hypo_game = game.simulate_clue(action, { enableLogs: true });
	const { common: hypo_common, state: hypo_state } = hypo_game;
	const card_after_cluing = hypo_common.thoughts[order];

	const result = {
		fixed: fix_criteria(hypo_game, order, target),
		trash: card_after_cluing.possible.every(p => isTrash(hypo_state, hypo_common, p, order, { infer: true })),
		result: get_result(game, hypo_game, action)
	};

	logger.highlight('green', `------- EXITING HYPO ${logClue(clue)} -------`);

	logger.flush(result.fixed);

	return result;
}
