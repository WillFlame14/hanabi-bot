import { BasicCard } from './Card.js';

/**
 * @typedef {import('./Card.js').Identity} Identity
 */

export class IdentitySet {
	/** @type {BasicCard[]} */
	#array;

	/**
	 * @param {number} numSuits
	 * @param {number} [value]
	 */
	constructor(numSuits, value) {
		this.maxStackRank = 5;

		this.numSuits = numSuits;
		this.value = value ?? Math.pow(2, this.numSuits * this.maxStackRank) - 1;
		this.#array = undefined;
	}

	clone() {
		return new IdentitySet(this.numSuits, this.value);
	}

	/**
	 * @param {Identity} identity
	 */
	#toMask({ suitIndex, rank }) {
		return 1 << (suitIndex * this.maxStackRank + (rank - 1));
	}

	/**
	 * @param {Identity[]} identities
	 */
	#identitiesToMask(identities) {
		return identities.reduce((mask, id) => mask | this.#toMask(id), 0);
	}

	/**
	 * Returns the number of possible identities.
	 */
	get length() {
		let copy = this.value;
		copy = copy - ((copy >> 1) & 0x55555555);
		copy = (copy & 0x33333333) + ((copy >> 2) & 0x33333333);

		return ((copy + (copy >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
	}

	/**
	 * @returns {BasicCard[]}
	 */
	get array() {
		// if (this.#array)
		// 	return this.#array;

		let run = 1;
		this.#array = [];

		for (let i = 0; i < this.numSuits * this.maxStackRank; i++) {
			if ((this.value & run) !== 0)
				this.#array.push(new BasicCard(Math.floor(i / this.maxStackRank), (i % this.maxStackRank) + 1));
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
		return (this.value & this.#toMask(identity)) !== 0;
	}

	/**
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	#resolveParam(identities) {
		if (identities instanceof IdentitySet)
			return identities.value;

		if (Array.isArray(identities))
			return this.#identitiesToMask(identities);

		return this.#toMask(identities);
	}

	/**
	 * Intersects the existing set and the provided array of identities.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	intersect(identities) {
		this.value &= this.#resolveParam(identities);
		this.#array = undefined;
	}

	/**
	 * Subtracts the provided array of identities from the existing set.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	subtract(identities) {
		this.value &= ~this.#resolveParam(identities);
		this.#array = undefined;
	}

	/**
	 * Performs the union of the existing set and the provided array of identities.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	union(identities) {
		this.value |= this.#resolveParam(identities);
		this.#array = undefined;
	}

	/**
	 * Assigns the existing set to the provided array of identities.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	assign(identities) {
		this.value = this.#resolveParam(identities);
		this.#array = undefined;
	}

	/**
	 * Returns whether the existing set and the provided array of identities are equal.
	 * @param {Identity[] | IdentitySet | Identity} identities
	 */
	equals(identities) {
		return this.value === this.#resolveParam(identities);
	}

	*[Symbol.iterator]() {
		for (const id of this.array)
			yield id;
	}
}
