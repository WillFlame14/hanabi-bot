const { find_finesse_pos } = require('./hanabi-logic.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_connecting(state, giver, target, suitIndex, rank) {
	logger.info('looking for connecting', Utils.cardToString({suitIndex, rank}));

	if (state.discard_stacks[suitIndex][rank - 1] === Utils.CARD_COUNT[rank - 1]) {
		logger.info('all cards in trash');
		return;
	}

	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		const known_connecting = hand.find(card =>
			(card.possible.length === 1 && Utils.cardMatch(card.possible[0], suitIndex, rank)) ||
			(card.inferred.length === 1 && Utils.cardMatch(card.inferred[0], suitIndex, rank))
		);

		if (known_connecting !== undefined) {
			logger.info(`found known ${Utils.cardToString({ suitIndex, rank })} in ${state.playerNames[i]}'s hand`);
			return { type: 'known', reacting: i, card: known_connecting };
		}
	}

	for (let i = 0; i < state.numPlayers; i++) {
		if (i === giver || i === state.ourPlayerIndex) {
			continue;
		}
		else {
			// Try looking through another player's hand (known to giver) (target?)
			const hand = state.hands[i];

			const prompt_pos = hand.findIndex(c => c.clued && !c.newly_clued && (c.suitIndex === suitIndex || c.rank === rank));
			const finesse_pos = find_finesse_pos(hand);

			if (prompt_pos !== -1 && Utils.cardMatch(hand[prompt_pos], suitIndex, rank)) {
				logger.info(`found prompt ${Utils.cardToString(hand[prompt_pos])} in ${state.playerNames[i]}'s hand`);
				return { type: 'prompt', reacting: i, card: hand[prompt_pos], self: false };
			}
			// Prompt takes priority over finesse
			else if (finesse_pos !== -1 && Utils.cardMatch(hand[finesse_pos], suitIndex, rank)) {
				logger.info(`found finesse ${Utils.cardToString(hand[finesse_pos])} in ${state.playerNames[i]}'s hand`);
				return { type: 'finesse', reacting: i, card: hand[finesse_pos], self: false };
			}
		}
	}
}

function find_own_finesses(state, giver, target, suitIndex, rank) {
	logger.info('finding finesse for (potentially) clued card', Utils.cardToString({suitIndex, rank}));
	const our_hand = state.hands[state.ourPlayerIndex];
	const connections = [];

	const already_prompted = [];
	let already_finessed = 0;

	for (let i = state.hypo_stacks[suitIndex] + 1; i < rank; i++) {
		if (state.discard_stacks[suitIndex][i - 1] === Utils.CARD_COUNT[i - 1]) {
			logger.info(`impossible to find ${Utils.cardToString({ suitIndex, rank: i })}, both cards in trash`);
			break;
		}

		const other_connecting = find_connecting(state, giver, target, suitIndex, i);
		if (other_connecting !== undefined) {
			connections.push(other_connecting);
		}
		else {
			const prompted = our_hand.find(c => c.clued && !already_prompted.includes(c.order) && c.inferred.some(inf => Utils.cardMatch(inf, suitIndex, i)));
			if (prompted !== undefined) {
				logger.info('found prompt in our hand');
				connections.push({ type: 'prompt', card: prompted, self: true });
				already_prompted.push(prompted.order)
			}
			else {
				const finesse_pos = find_finesse_pos(our_hand, already_finessed);

				if (finesse_pos !== -1 && our_hand[finesse_pos].possible.some(c => Utils.cardMatch(c, suitIndex, i))) {
					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', card: our_hand[finesse_pos], self: true });
					already_finessed++;
				}
				else {
					break;
				}
			}
		}
	}
	return { feasible: connections.length === rank - state.hypo_stacks[suitIndex] - 1, connections };
}

module.exports = { find_connecting, find_own_finesses };
