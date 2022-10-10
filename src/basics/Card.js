/**
 * Card properties:
 *  suitIndex: number	the index of the card's suit
 *  rank: number		the rank of the card
 *
 *  order: number		the ordinal number of the card
 *  possible: [Card]	all possibilities of the card (from positive/negative information)
 *  inferred: [Card]	all inferences of the card (from conventions)
 *  old_inferred: [Card] | undefined		only used when undoing a finesse
 *
 *  clued, newly_clued, prompted, finessed, chop_moved, reset are boolean flags
 *
 *  reasoning: [number]			the action indexes of when a card's possibiltiies/inferences were updated
 *  reasoning_turn: [number]	the game turns of when a card's possibiltiies/inferences were updated
 *  rewinded: boolean			whether the card was rewinded or not
 *
 *  full_note: string		the entire note on the card
 *  last_note: string		the most recent note on the card
 */
class Card {
	constructor(suitIndex, rank, additions = {}) {
		this.suitIndex = suitIndex;
		this.rank = rank;

		this.order = -1;
		this.possible = [];
		this.inferred = [];

		this.clues = [];
		this.clued = false;
		this.newly_clued = false;
		this.prompted = false;
		this.finessed = false;
		this.chop_moved = false;
		this.reset = false;

		this.reasoning = [];
		this.reasoning_turn = [];
		this.rewinded = false;

		this.full_note = '';
		this.last_note = '';

		Object.assign(this, additions);
	}

	clone() {
		const new_card = new Card(this.suitIndex, this.rank, this);

		for (const field of ['possible', 'inferred']) {
			new_card[field] = [];
			for (const card of this[field]) {
				new_card[field].push(new Card(card.suitIndex, card.rank));
			}
		}

		for (const field of ['clues', 'reasoning', 'reasoning_turn']) {
			new_card[field] = [];
			for (const obj of this[field]) {
				new_card[field].push(JSON.parse(JSON.stringify(obj)));
			}
		}
		return new_card;
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

		const colours = ['r', 'y', 'g', 'b', 'p', 't'];
		return colours[suitIndex] + rank + append;
	}

	matches(suitIndex, rank, options = {}) {
		let identity;
		if (!options.symmetric && this.suitIndex !== -1) {
			identity = this;
		}
		else if (this.possible.length === 1) {
			identity = this.possible[0];
		}
		else if (options.infer && this.inferred.length === 1) {
			identity = this.inferred[0];
		}
		else {
			return false;
		}

		return identity.suitIndex === suitIndex && identity.rank === rank;
	}

	matches_inferences() {
		return this.suitIndex === -1 || this.possible.length === 1 || this.inferred.some(c => c.matches(this.suitIndex, this.rank));
	}

	intersect(type, cards) {
		this[type] = this[type].filter(c1 => cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}

	subtract(type, cards) {
		this[type] = this[type].filter(c1 => !cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}

	union(type, cards) {
		for (const card of cards) {
			if (!this[type].some(c => c.matches(card.suitIndex, card.rank))) {
				this[type].push(card);
			}
		}
	}
}

module.exports = { Card };
