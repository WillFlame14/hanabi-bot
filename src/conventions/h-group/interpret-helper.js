const { CLUE } = require('../../constants.js');
const { find_prompt, find_finesse } = require('./hanabi-logic.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_focus_possible(state, giver, target, clue, chop, ignoreCard) {
	const focus_possible = [];
	logger.info('play/hypo/max stacks in clue interpretation:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	if (clue.type === CLUE.COLOUR) {
		const suitIndex = clue.value;
		let next_playable_rank = state.play_stacks[suitIndex] + 1;

		// Play clue
		const connections = [];

		// Try looking for a connecting card (other than itself)
		const hypo_state = Utils.objClone(state);
		let already_connected = [ignoreCard.order];
		let connecting = find_connecting(hypo_state, giver, target, suitIndex, next_playable_rank, already_connected);

		while (connecting !== undefined && next_playable_rank < 5) {
			const { type, card } = connecting;

			if (type === 'known' && card.newly_clued && card.possible.length > 1 && ignoreCard.inferred.some(c => c.matches(suitIndex, next_playable_rank))) {
				// Trying to use a newly 'known' connecting card, but the focused card could be that
				// e.g. If 2 reds are clued with only r5 remaining, the focus should not connect to the other card as r6
				logger.warn(`blocked connection - focused card could be ${Utils.logCard(suitIndex, next_playable_rank)}`);
				break;
			}
			else if (type === 'finesse') {
				// Even if a finesse is possible, it might not be a finesse
				focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections: Utils.objClone(connections) });
				card.finessed = true;
			}
			hypo_state.play_stacks[suitIndex]++;

			next_playable_rank++;
			connections.push(connecting);
			already_connected.push(card.order);
			connecting = find_connecting(hypo_state, giver, target, suitIndex, next_playable_rank, already_connected);
		}

		// Our card could be the final rank that we can't find
		focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections });

		// Save clue on chop (5 save cannot be done with number)
		if (chop) {
			for (let rank = next_playable_rank + 1; rank < 5; rank++) {
				// Check if card is critical
				if (Utils.isCritical(state, suitIndex, rank)) {
					focus_possible.push({ suitIndex, rank, save: true, connections: [] });
				}
			}
		}
	}
	else {
		const rank = clue.value;

		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			// Play clue
			let stack_rank = state.play_stacks[suitIndex] + 1;
			const connections = [];

			if (rank === stack_rank) {
				focus_possible.push({ suitIndex, rank, save: false, connections });
			}
			else if (rank > stack_rank) {
				// Try looking for all connecting cards
				const hypo_state = Utils.objClone(state);
				let connecting;
				let already_connected = [ignoreCard.order];

				while (stack_rank !== rank) {
					connecting = find_connecting(hypo_state, giver, target, suitIndex, stack_rank, already_connected);
					if (connecting === undefined) {
						break;
					}

					const { type, card } = connecting;
					connections.push(connecting);
					already_connected.push(card.order);

					if (type === 'finesse') {
						card.finessed = true;
					}
					stack_rank++;
					hypo_state.play_stacks[suitIndex]++;
				}

				// Connected cards can stack up to this rank
				if (rank === stack_rank) {
					focus_possible.push({ suitIndex, rank, save: false, connections });
				}
			}

			// Save clue on chop
			if (chop) {
				// Don't need to consider save on playable cards
				if (Utils.playableAway(state, suitIndex, rank) === 0) {
					continue;
				}

				let save2 = false;

				// Determine if it's a 2 save
				if (rank === 2) {
					const duplicates = Utils.visibleFind(state, target, suitIndex, rank).filter(c => c.order !== ignoreCard.order);

					// No duplicates found, so can be a 2 save
					if (duplicates.length === 0) {
						save2 = true;
					}
					// Both duplicates found, so can't be a 2 save
					else if (duplicates.length === 2) {
						continue;
					}
					else {
						// Can be a 2 save if the other 2 is in the giver's hand
						save2 = state.hands[giver].some(c => c.order === duplicates[0].order);
					}
				}

				// Critical save or 2 save
				if (Utils.isCritical(state, suitIndex, rank) || save2) {
					focus_possible.push({ suitIndex, rank, save: true, connections: [] });
				}
			}
		}
	}

	// Remove earlier duplicates (since save overrides play)
	return focus_possible.filter((p1, index1) => {
		return !focus_possible.some((p2, index2) => p1.suitIndex === p2.suitIndex && p1.rank === p2.rank && index1 < index2);
	});
}

function find_connecting(state, giver, target, suitIndex, rank, ignoreOrders = []) {
	logger.info('looking for connecting', Utils.logCard(suitIndex, rank));

	if (state.discard_stacks[suitIndex][rank - 1] === Utils.CARD_COUNT[rank - 1]) {
		logger.info('all cards in trash');
		return;
	}

	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		const known_connecting = hand.find(card =>
			card.matches(suitIndex, rank, { symmetric: true, infer: true }) &&
			(i !== state.ourPlayerIndex ? card.matches(suitIndex, rank) : true) &&		// The card should actually match
			!ignoreOrders.includes(card.order)
		);

		if (known_connecting !== undefined) {
			logger.info(`found known ${Utils.logCard(suitIndex, rank)} in ${state.playerNames[i]}'s hand`);
			return { type: 'known', reacting: i, card: known_connecting };
		}

		let playable_connecting;
		if (i !== state.ourPlayerIndex) {
			playable_connecting = hand.find(card =>
				(card.inferred.every(c => state.play_stacks[c.suitIndex] + 1 === c.rank) || card.finessed) &&
				card.matches(suitIndex, rank) &&
				!ignoreOrders.includes(card.order)
			);
		}
		else {
			playable_connecting = hand.find(card =>
				card.inferred.every(c => state.play_stacks[c.suitIndex] + 1 === c.rank) &&
				card.inferred.some(c => c.matches(suitIndex, rank)) &&
				!ignoreOrders.includes(card.order)
			);
		}

		// There's a connecting card that is known playable (but not in the giver's hand!)
		if (playable_connecting !== undefined && i !== giver) {
			logger.info(`found playable ${Utils.logCard(suitIndex, rank)} in ${state.playerNames[i]}'s hand`);
			logger.info('card inferred', playable_connecting.inferred.map(c => c.toString()).join());
			return { type: 'playable', reacting: i, card: playable_connecting };
		}
	}

	for (let i = 0; i < state.numPlayers; i++) {
		if (i === giver || i === state.ourPlayerIndex) {
			continue;
		}
		else {
			// Try looking through another player's hand (known to giver) (target?)
			const hand = state.hands[i];
			const prompt = find_prompt(hand, suitIndex, rank, ignoreOrders);
			const finesse = find_finesse(hand, suitIndex, rank, ignoreOrders);

			// Prompt takes priority over finesse
			if (prompt !== undefined) {
				if (prompt.matches(suitIndex, rank)) {
					logger.info(`found prompt ${prompt.toString()} in ${state.playerNames[i]}'s hand`);
					return { type: 'prompt', reacting: i, card: prompt, self: false };
				}
				logger.debug(`couldn't prompt ${Utils.logCard(suitIndex, rank)}, ignoreOrders ${ignoreOrders}`);
			}
			else if (finesse?.matches(suitIndex, rank)) {
				logger.info(`found finesse ${finesse.toString()} in ${state.playerNames[i]}'s hand`);
				return { type: 'finesse', reacting: i, card: finesse, self: false };
			}
		}
	}
}

function find_own_finesses(state, giver, target, suitIndex, rank) {
	// We cannot finesse ourselves
	if (giver === state.ourPlayerIndex) {
		return { feasible: false, connections: [] };
	}

	logger.info('finding finesse for (potentially) clued card', Utils.logCard(suitIndex, rank));
	const our_hand = state.hands[state.ourPlayerIndex];
	const connections = [];

	let feasible = true;
	const already_prompted = [], already_finessed = [];

	for (let next_rank = state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		if (state.discard_stacks[suitIndex][next_rank - 1] === Utils.CARD_COUNT[next_rank - 1]) {
			logger.info(`impossible to find ${Utils.logCard(suitIndex, next_rank)}, both cards in trash`);
			feasible = false;
			break;
		}

		// First, see if someone else has the connecting card
		const other_connecting = find_connecting(state, giver, target, suitIndex, next_rank, already_prompted.concat(already_finessed));
		if (other_connecting !== undefined) {
			connections.push(other_connecting);
		}
		else {
			// Otherwise, try to find prompt in our hand
			const prompt = find_prompt(our_hand, suitIndex, next_rank, already_prompted);
			if (prompt !== undefined) {
				logger.info('found prompt in our hand');
				connections.push({ type: 'prompt', reacting: state.ourPlayerIndex, card: prompt, self: true });
				already_prompted.push(prompt.order);
			}
			else {
				// Otherwise, try to find finesse in our hand
				const finesse = find_finesse(our_hand, suitIndex, next_rank, already_finessed);
				if (finesse !== undefined) {
					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, self: true });
					already_finessed.push(finesse.order);
				}
				else {
					feasible = false;
					break;
				}
			}
		}
	}
	return { feasible, connections };
}

module.exports = { find_focus_possible, find_connecting, find_own_finesses };
