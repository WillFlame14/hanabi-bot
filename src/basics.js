import { Card } from './basics/Card.js';
import { find_possibilities } from './basics/helper.js';
import { visibleFind } from './basics/hanabi-util.js';
import { cardCount } from './variants.js';
import logger from './tools/logger.js';
import { logCard } from './tools/log.js';
import * as Utils from './tools/util.js';

/**
 * @typedef {import('./basics/State.js').State} State
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * @param {State} state
 * @param {ClueAction} action
 */
export function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.suits);

	for (const card of state.hands[target]) {
		const previously_unknown = card.possible.length > 1;

		if (list.includes(card.order)) {
			const inferences_before = card.inferred.length;
			card.intersect('possible', new_possible);
			card.intersect('inferred', new_possible);

			if (!card.clued) {
				card.newly_clued = true;
				card.clued = true;
			}
			card.clues.push(clue);
			if (card.inferred.length < inferences_before) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}
		}
		else {
			card.subtract('possible', new_possible);
			card.subtract('inferred', new_possible);
		}

		// If card is now definitely known to everyone and wasn't previously - eliminate
		if (previously_unknown && card.possible.length === 1) {
			for (let i = 0; i < state.numPlayers; i++) {
				card_elim(state, i, card.possible[0].suitIndex, card.possible[0].rank);
				state.hands[i].refresh_links();
			}
		}
	}

	state.clue_tokens--;
}

/**
 * @param {State} state
 * @param {DiscardAction} action
 */
export function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.discard_stacks[suitIndex][rank - 1]++;

	// Card is now definitely known to everyone - eliminate
	for (let i = 0; i < state.numPlayers; i++) {
		card_elim(state, i, suitIndex, rank);
		state.hands[i].refresh_links();
	}

	// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank) && state.max_ranks[suitIndex] > rank - 1) {
		state.max_ranks[suitIndex] = rank - 1;
	}

	if (failed) {
		state.strikes++;
	}

	// Bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {DrawAction} action
 */
export function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new Card(suitIndex, rank, {
		order,
		possible: Utils.objClone(state.all_possible[playerIndex]),
		inferred: Utils.objClone(state.all_inferred[playerIndex]),
		drawn_index: state.actionList.length
	});
	state.hands[playerIndex].unshift(card);

	// If we know its identity, everyone elims except the player who drew the card
	if (card.identity() !== undefined) {
		for (let i = 0; i < state.numPlayers; i++) {
			if (i !== playerIndex) {
				card_elim(state, i, suitIndex, rank);
				state.hands[i].refresh_links();
			}
		}
	}

	state.cardsLeft--;

	// suitIndex and rank are -1 if they're your own cards
}

/**
 * @param {State} state
 * @param {PlayAction} action
 */
export function onPlay(state, action) {
	const { order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.play_stacks[suitIndex] = rank;

	// Card is now definitely known to everyone - eliminate
	for (let i = 0; i < state.numPlayers; i++) {
		card_elim(state, i, suitIndex, rank);
		state.hands[i].refresh_links();
	}

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {number} playerIndex 		The index of the player performing elimination.
 * @param {number} suitIndex 		The suitIndex of the identity to be eliminated.
 * @param {number} rank 			The rank of the identity to be eliminated.
 * @returns {Card[]}				Any additional recursive eliminations performed.
 */
export function card_elim(state, playerIndex, suitIndex, rank) {
	// Skip if already eliminated
	if (!state.all_possible[playerIndex].some(c => c.matches(suitIndex, rank))) {
		return [];
	}

	const base_count = state.discard_stacks[suitIndex][rank - 1] + (state.play_stacks[suitIndex] >= rank ? 1 : 0);
	const certain_cards = visibleFind(state, playerIndex, suitIndex, rank, { infer: [] });
	const total_count = cardCount(state.suits[suitIndex], rank);

	let new_elims = [];

	// All cards are known accounted for
	if (base_count + certain_cards.length === total_count) {
		// Remove it from the list of future possibilities (and inferences)
		state.all_possible[playerIndex] = state.all_possible[playerIndex].filter(c => !c.matches(suitIndex, rank));
		state.all_inferred[playerIndex] = state.all_inferred[playerIndex].filter(c => !c.matches(suitIndex, rank));

		for (const card of state.hands[playerIndex]) {
			if (card.possible.length > 1 && !certain_cards.some(c => c.order === card.order)) {
				card.subtract('possible', [{suitIndex, rank}]);
				card.subtract('inferred', [{suitIndex, rank}]);

				// Card can be further eliminated
				if (card.inferred.length === 1 || card.possible.length === 1) {
					const { suitIndex: suitIndex2, rank: rank2 } = card.identity({ symmetric: true, infer: true });
					new_elims.push({ suitIndex: suitIndex2, rank: rank2 });

					for (let i = 0; i < state.numPlayers; i++) {
						const recursive_elims = card_elim(state, i, suitIndex2, rank2).filter(c => !new_elims.some(elim => elim.suitIndex === c.suitIndex && elim.rank ===  c.rank));
						new_elims = new_elims.concat(recursive_elims);
					}
				}
			}
		}
		logger.debug(`removing ${logCard({suitIndex, rank})} from ${state.playerNames[playerIndex]}'s hand and future possibilities`);
	}
	else {
		// Skip if already eliminated
		if (!state.all_inferred[playerIndex].some(c => c.matches(suitIndex, rank))) {
			return [];
		}

		let inferred_cards = visibleFind(state, playerIndex, suitIndex, rank);
		let focus_elim = false;

		if (base_count + inferred_cards.length >= total_count) {
			if (base_count + inferred_cards.length > total_count) {
				logger.warn(`inferring ${base_count + inferred_cards.length} copies of ${logCard({suitIndex, rank})}`);

				const initial_focus = inferred_cards.filter(card => card.focused);

				if (base_count + 1 === total_count && initial_focus.length === 1) {
					logger.info('eliminating from focus!');
					inferred_cards = initial_focus;
					focus_elim = true;
				}
				else {
					const new_link = { cards: inferred_cards, identities: [{ suitIndex, rank }], promised: false };

					// Don't add duplicates of the same link
					if (!state.hands[playerIndex].links.some(link => JSON.stringify(link) === JSON.stringify(new_link))) {
						state.hands[playerIndex].links.push(new_link);
					}
				}
			}

			// Remove it from the list of future inferences
			state.all_inferred[playerIndex] = state.all_inferred[playerIndex].filter(c => !c.matches(suitIndex, rank));

			for (const card of state.hands[playerIndex]) {
				if ((card.inferred.length > 1 || focus_elim) && !inferred_cards.some(c => c.order === card.order)) {
					card.subtract('inferred', [{suitIndex, rank}]);

					// Card can be further eliminated
					if (card.inferred.length === 1) {
						if (card.identity() !== undefined && !card.matches(suitIndex, rank)) {
							logger.warn(`incorrectly trying to elim card ${logCard(card)} as ${logCard({suitIndex, rank})}!`);
							continue;
						}

						const { suitIndex: suitIndex2, rank: rank2 } = card.inferred[0];
						new_elims.push({ suitIndex: suitIndex2, rank: rank2 });

						for (let i = 0; i < state.numPlayers; i++) {
							const recursive_elims = card_elim(state, i, suitIndex2, rank2).filter(c => !new_elims.some(elim => elim.suitIndex === c.suitIndex && elim.rank ===  c.rank));
							new_elims = new_elims.concat(recursive_elims);
						}
					}
				}
			}
			logger.debug(`removing ${logCard({suitIndex, rank})} from ${state.playerNames[playerIndex]}'s hand and future inferences`);
		}
	}
	return new_elims;
}
