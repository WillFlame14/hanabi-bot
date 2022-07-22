/**
 * Card properties:
 *  suitIndex: number	the index of the card's suit
 *  rank: number		the rank of the card
 *
 *  order: number		the ordinal number of the card
 *  possible: [Card]	all possibilities of the card (from positive/negative information)
 *  inferred: [Card]	all inferences of the card (from conventions)
 *
 *  clued, newly_clued, prompted, finessed are boolean flags
 *
 *  reasoning: [number]			the action indexes of when a card's possibiltiies/inferences were updated
 *  reasoning_turn: [number]	the game turns of when a card's possibiltiies/inferences were updated
 *  rewinded: boolean			whether the card was rewinded or not
 */
class Card {
	constructor(suitIndex, rank, additions = {}) {
		this.suitIndex = suitIndex;
		this.rank = rank;

		this.order = -1;
		this.possible = [];
		this.inferred = [];

		this.clued = false;
		this.newly_clued = false;
		this.prompted = false;
		this.finessed = false;

		this.reasoning = [];
		this.reasoning_turn = [];
		this.rewinded = false;

		Object.assign(this, additions);
	}

	clone() {
		return new Card(this.suitIndex, this.rank, this);
	}

	toString() {
		let suitIndex, rank;
		let append = '';

		if (this.suitIndex !== -1) {
			({ suitIndex, rank } = this);
		}
		else if (this.possible.length === 1) {
			({ suitIndex, rank } = this.possible[0]);
			append = '(known)';
		}
		else if (this.inferred.length === 1) {
			({ suitIndex, rank } = this.inferred[0]);
			append = '(inferred)';
		}
		else {
			return '(unknown)';
		}

		const colours = ['r', 'y', 'g', 'b', 'p'];
		return colours[suitIndex] + rank + append;
	}

	matches(suitIndex, rank) {
		return this.suitIndex === suitIndex && this.rank === rank;
	}

	intersect(type, cards) {
		this[type] = this[type].filter(c1 => cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}

	subtract(type, cards) {
		this[type] = this[type].filter(c1 => !cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}
}

module.exports = { Card };
