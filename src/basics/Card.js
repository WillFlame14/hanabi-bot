import { logCard } from '../tools/log.js';

/**
 * @typedef {{infer?: boolean, assume?: boolean}} MatchOptions
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('./IdentitySet.js').IdentitySet} IdentitySet
 */

export class BasicCard {
	/**
	 * @param {number} [suitIndex]	The index of the card's suit
	 * @param {number} [rank]		The rank of the card
	 */
	constructor(suitIndex, rank) {
		this.suitIndex = suitIndex;
		this.rank = rank;
	}

	raw() {
		return Object.freeze({ suitIndex: this.suitIndex, rank: this.rank });
	}

	identity() {
		if (this.suitIndex !== -1 && this.rank !== -1)
			return { suitIndex: this.suitIndex, rank: this.rank };
	}

	matches({suitIndex, rank}) {
		return this.suitIndex === suitIndex && this.rank === rank;
	}

	/**
	 * Returns whether the card would be played on the stacks before the given identity.
	 * Always returns false if the two cards are of different suits.
	 * @param {Identity} identity
	 * @param {{ equal?: boolean }} options
	 */
	playedBefore({ suitIndex, rank }, options = {}) {
		return this.suitIndex === suitIndex && (options.equal ? (this.rank <= rank) : (this.rank < rank));
	}
}

export class ActualCard extends BasicCard {
	/**
	 * @param {number} suitIndex	The index of the card's suit
	 * @param {number} rank			The rank of the card
	 * @param {number} [order]		The order of the card in the deck
	 * @param {number} [drawn_index]
	 * @param {boolean} [clued]
	 * @param {boolean} [newly_clued]
	 * @param {BaseClue[]} [clues]	List of clues that have touched this card
	 */
	constructor(suitIndex, rank, order = -1, drawn_index = -1, clued = false, newly_clued = false, clues = []) {
		super(suitIndex, rank);

		this.order = order;
		this.drawn_index = drawn_index;
		this.clued = clued;
		this.newly_clued = newly_clued;
		this.clues = clues;
	}

	clone() {
		return new ActualCard(this.suitIndex, this.rank, this.order, this.drawn_index, this.clued, this.newly_clued, this.clues.slice());
	}

	shallowCopy() {
		return new ActualCard(this.suitIndex, this.rank, this.order, this.drawn_index, this.clued, this.newly_clued, this.clues);
	}

	/**
	 * Returns whether the card is a duplicate of the provided card (same suitIndex and rank, different order).
	 * @param {ActualCard} card
	 */
	duplicateOf(card) {
		return this.matches(card) && this.order !== card.order;
	}
}

/**
 * Class for a single card (i.e. a suitIndex and rank). Other attributes are optional.
 */
export class Card extends BasicCard {
	/**
	 * All possibilities of the card (from positive/negative information)
	 * @type {IdentitySet}
	 */
	possible;

	/**
	 * All inferences of the card (from conventions)
	 * @type {IdentitySet}
	 */
	inferred;

	/**
	 * Only used when undoing a finesse.
	 * @type {IdentitySet | undefined}
	 */
	old_inferred;

	// Boolean flags about the state of the card
	focused = false;
	finessed = false;
	chop_moved = false;
	reset = false;			// Whether the card has previously lost all inferences
	chop_when_first_clued = false;
	superposition = false;	// Whether the card is currently in a superposition
	hidden = false;
	called_to_discard = false;
	certain_finessed = false;

	finesse_index = -1;	// Action index of when the card was finessed
	reasoning = /** @type {number[]} */ ([]);		// The action indexes of when the card's possibilities/inferences were updated
	reasoning_turn = /** @type {number[]} */ ([]);	// The game turns of when the card's possibilities/inferences were updated
	rewinded = false;								// Whether the card has ever been rewinded

	/**
	 * @param {ActualCard} actualCard
	 * @param {Identity & Partial<Card>} identity
	 */
	constructor(actualCard, { suitIndex, rank , ...additions }) {
		super(suitIndex, rank);
		this.actualCard = actualCard;
		Object.assign(this, additions);
	}

	/**
	 * Creates a deep copy of the card.
	 */
	clone() {
		const new_card = new Card(this.actualCard.clone(), {
			suitIndex: this.suitIndex,
			rank: this.rank
		});

		for (const field of ['inferred', 'possible', 'old_inferred', 'focused',
			'finessed', 'chop_moved', 'reset', 'chop_when_first_clued', 'superposition',
			'hidden', 'called_to_discard', 'certain_finessed','finesse_index', 'rewinded'])
			new_card[field] = this[field];

		for (const field of ['reasoning', 'reasoning_turn'])
			new_card[field] = this[field].slice();

		return new_card;
	}

	shallowCopy() {
		const new_card = new Card(this.actualCard, { suitIndex: this.suitIndex, rank: this.rank });
		Object.assign(new_card, this);
		return new_card;
	}

	get order() { return this.actualCard.order; }
	get clued() { return this.actualCard.clued; }
	get newly_clued() { return this.actualCard.newly_clued; }
	get clues() { return this.actualCard.clues; }
	get drawn_index() { return this.actualCard.drawn_index; }

	set order(order) { this.actualCard.order = order; }
	set clued(clued) { this.actualCard.clued = clued; }
	set newly_clued(newly_clued) { this.actualCard.newly_clued = newly_clued; }
	set clues(clues) { this.actualCard.clues = clues.slice(); }
	set drawn_index(drawn_index) { this.actualCard.drawn_index = drawn_index; }

	raw() {
		return Object.freeze({ suitIndex: this.suitIndex, rank: this.rank });
	}

	get possibilities() {
		return this.inferred.length === 0 ? this.possible : this.inferred;
	}

	/** Returns whether the card has been "touched" (i.e. clued or finessed). */
	get touched() {
		return this.clued || this.finessed;
	}

	/** Returns whether the card has been "saved" (i.e. clued, finessed or chop moved). */
	get saved() {
		return this.clued || this.finessed || this.chop_moved;
	}

	/**
	 * Returns the identity of the card (if known/inferred).
	 * 
	 * If the 'symmetric' option is enabled, asymmetric information (i.e. seeing the card) is not used.
	 * 
	 * If the 'infer' option is enabled, the card's inferences are used to determine its identity (as a last option).
	 * @param {MatchOptions} options
	 */
	identity(options = {}) {
		if (this.possible.length === 1)
			return this.possible.array[0];

		else if (this.suitIndex !== -1 && this.rank !== -1)
			return Object.freeze(new BasicCard(this.suitIndex, this.rank));

		else if (options.infer && this.inferred.length === 1)
			return this.inferred.array[0];
	}

	/**
	 * Checks if the card matches the provided identity.
	 * @param {Identity} identity
	 * @param {MatchOptions} options
	 */
	matches({ suitIndex, rank }, options = {}) {
		const id = this.identity(options);

		if (id === undefined)
			return options.assume ?? false;

		return id.suitIndex === suitIndex && id.rank === rank;
	}

	/**
	 * Returns whether the card is a duplicate of the provided card (same suitIndex and rank, different order).
	 * @param {ActualCard} card
	 * @param {MatchOptions} options
	 */
	duplicateOf(card, options = {}) {
		return this.matches(card, options) && this.order !== card.order;
	}

	/**
	 * Returns whether one of the card's inferences matches its actual suitIndex and rank.
	 * Returns true if the card has only 1 possibility or the card is unknown (i.e. in our hand). 
	 */
	matches_inferences() {
		return this.identity() === undefined || this.possible.length === 1 || this.inferred.has(this);
	}

	/**
	 * Returns the note on the card.
	 */
	getNote() {
		let note;
		if (this.inferred.length === 0)
			note = '??';
		else if (this.inferred.length <= 3)
			note = this.inferred.map(logCard).join(',');
		else
			note = '...';

		if (this.finessed)
			note = `[f] [${note}]`;

		if (this.chop_moved)
			note = `[cm] [${note}]`;

		if (this.called_to_discard)
			note = 'dc';

		return note;
	}
}
