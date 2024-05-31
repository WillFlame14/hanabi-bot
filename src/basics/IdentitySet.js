import { BasicCard } from './Card.js';

/**
 * @typedef {import('./Card.js').Identity} Identity
 */

export class IdentitySet {
	/** @type {BasicCard[]} */
	#array;

	/** @type {number} */
	#length;

	/**
	 * @param {number} numSuits
	 * @param {number} [value]
	 */
	constructor(numSuits, value) {
		this.maxStackRank = 5;

		this.numSuits = numSuits;
		this.value = value ?? Math.pow(2, this.numSuits * this.maxStackRank) - 1;
		this.#array = undefined;
		this.#length = 0;
	}

	/**
	 * @param {Identity} identity
	 * @param {number} [maxStackRank]
	 */
	static toMask({ suitIndex, rank }, maxStackRank = 5) {
		return 1 << (suitIndex * maxStackRank + (rank - 1));
	}

	/**
	 * @param {Identity[]} identities
	 * @param {number} [maxStackRank]
	 */
	static identitiesToMask(identities, maxStackRank = 5) {
		return identities.reduce((mask, id) => mask | IdentitySet.toMask(id, maxStackRank), 0);
	}

	/**
	 * @param {Identity[] | IdentitySet | Identity} identities
	 * @param {number} [maxStackRank]
	 */
	static parse(identities, maxStackRank = 5) {
		if (identities instanceof IdentitySet)
			return identities.value;

		if (Array.isArray(identities))
			return IdentitySet.identitiesToMask(identities, maxStackRank);

		return IdentitySet.toMask(identities, maxStackRank);
	}

	/**
	 * @param {number} numSuits
	 * @param {Identity[] | IdentitySet | Identity} identities
	 * @param {number} [maxStackRank]
	 */
	static create(numSuits, identities, maxStackRank = 5) {
		return new IdentitySet(numSuits, IdentitySet.parse(identities, maxStackRank));
	}

	/**
	 * Returns the number of possible identities.
	 */
	get length() {
		if (this.#length)
			return this.#length;

		let copy = this.value;
		copy = copy - ((copy >> 1) & 0x55555555);
		copy = (copy & 0x33333333) + ((copy >> 2) & 0x33333333);

		return ((copy + (copy >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
	}

	/**
	 * @returns {BasicCard[]}
	 */
	get array() {
		if (this.#array)
			return this.#array;

		let run = 1;
		this.#array = [];

		for (let i = 0; i < this.numSuits * this.maxStackRank; i++) {
			if ((this.value & run) !== 0)
				this.#array.push(Object.freeze(new BasicCard(Math.floor(i / this.maxStackRank), (i % this.maxStackRank) + 1)));
			run <<= 1;
		}

		return this.#array;
	}

	/**
	 * @template T
	 * @param {(i: BasicCard) => T} func
	 */
	map(func) { return this.array.map(func); }

	/** @param {(i: BasicCard) => boolean} func */
	filter(func) { return this.array.filter(func); }

	/**
	 * @template T
	 * @param {(acc: T, curr: BasicCard) => T} func
	 * @param {T} [initial]
	 */
	reduce(func, initial) { return this.array.reduce(func, initial); }

	/** @param {(i: BasicCard) => unknown} func */
	every(func) { return this.array.every(func); }

	/** @param {(i: BasicCard) => unknown} func */
	some(func) { return this.array.some(func); }

	/** @param {(i: BasicCard) => unknown} func */
	find(func) { return this.array.find(func); }

	/**
	 * @param {Identity} identity
	 */
	has(identity) {
		if (identity.suitIndex === -1 || identity.rank === -1)
			return false;

		return (this.value & IdentitySet.toMask(identity, this.maxStackRank)) !== 0;
	}

	/**
	 * Returns the intersection of the existing set and the provided array of identities.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	intersect(identities) {
		return new IdentitySet(this.numSuits, this.value & IdentitySet.parse(identities, this.maxStackRank));
	}

	/**
	 * Returns the difference of the provided array of identities from the existing set.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	subtract(identities) {
		return new IdentitySet(this.numSuits, this.value & ~IdentitySet.parse(identities, this.maxStackRank));
	}

	/**
	 * Returns the union of the existing set and the provided array of identities.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	union(identities) {
		return new IdentitySet(this.numSuits, this.value | IdentitySet.parse(identities, this.maxStackRank));
	}

	/**
	 * Returns whether the existing set and the provided array of identities are equal.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	equals(identities) {
		return this.value === IdentitySet.parse(identities, this.maxStackRank);
	}

	*[Symbol.iterator]() {
		for (const id of this.array)
			yield id;
	}
}
