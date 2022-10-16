const { ACTION } = require('../constants.js');
const { logger } = require('../logger.js');

class Hand extends Array {
	removeOrder(order) {
		const card_index = this.findIndex(c => c.order === order);

		if (card_index === -1) {
			logger.error('could not find such card index!');
			return;
		}

		// Remove the card from their hand
		this.splice(card_index, 1);
	}

	isLocked() {
		return this.every(c => c.clued || c.chop_moved);
	}

	findOrder(order) {
		return this.find(c => c.order === order);
	}

	findCards(suitIndex, rank, options = {}) {
		return this.filter(c => c.matches(suitIndex, rank, options));
	}

	// NOTE: This function uses ACTION instead of CLUE, which is not typical.
	clueTouched(clue) {
		const { type, value } = clue;
		if (type === ACTION.COLOUR) {
			return this.filter(c => c.suitIndex === value);
		}
		else if (type === ACTION.RANK) {
			return this.filter(c => c.rank === value);
		}
	}
}

module.exports = { Hand };
