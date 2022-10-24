const { cardTouched } = require('../variants.js');
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

	clueTouched(suits, clue) {
		return this.filter(card => cardTouched(card, suits, clue));
	}
}

module.exports = { Hand };
