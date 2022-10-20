const { CLUE } = require('../../../constants.js');
const { isBasicTrash, isTrash } = require('../../../basics/hanabi-util.js');
const { logger } = require('../../../logger.js');
const Utils = require('../../../util.js');

function interpret_tcm(state, target) {
	let oldest_trash_index;
	// Find the oldest newly clued trash
	for (let i = state.hands[target].length - 1; i >= 0; i--) {
		const card = state.hands[target][i];

		if (card.newly_clued && card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank))) {
			oldest_trash_index = i;
			break;
		}
	}

	logger.info(`oldest trash card is ${Utils.logCard(state.hands[target][oldest_trash_index])}`);

	// Chop move every unclued card to the right of this
	for (let i = oldest_trash_index + 1; i < state.hands[target].length; i++) {
		const card = state.hands[target][i];

		if (!card.clued) {
			card.chop_moved = true;
			logger.info(`trash chop move on ${Utils.logCard(card)}`);
		}
	}
}

function interpret_5cm(state, giver, target) {
	logger.info('interpreting potential 5cm');

	// Find the oldest 5 clued and its distance from chop
	let chopIndex = -1;

	for (let i = state.hands[target].length - 1; i >= 0; i--) {
		const card = state.hands[target][i];

		// Skip finessed, chop moved and previously clued cards
		if (card.finessed || card.chop_moved || (card.clued && !card.newly_clued)) {
			logger.info('skipping card', Utils.logCard(card));
			continue;
		}

		// First unclued or newly clued card is chop
		if (chopIndex === -1) {
			const { suitIndex, rank, order } = card;
			// If we aren't the target, we can see the card being chop moved
			if (target !== state.ourPlayerIndex && isTrash(state, giver, suitIndex, rank, order)) {
				logger.info(`chop ${Utils.logCard(card)} is trash, not interpreting 5cm`);
				break;
			}
			chopIndex = i;
			continue;
		}

		// Check the next card that meets the requirements (must be 5 and newly clued to be 5cm)
		if (card.newly_clued && card.clues.some(clue => clue.type === CLUE.RANK && clue.value === 5)) {
			if (chopIndex === -1) {
				logger.info('rightmost 5 was clued on chop, not interpreting 5cm');
				break;
			}
			logger.info(`5cm, saving ${Utils.logCard(state.hands[target][chopIndex])}`);
			state.hands[target][chopIndex].chop_moved = true;
			return true;
		}

		// We found a 5 that doesn't meet 5cm requirements, so it might be a play
		logger.info(`not 5cm`);
		break;
	}
	return false;
}

module.exports = { interpret_tcm, interpret_5cm };