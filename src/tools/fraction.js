/**
 * @param {number} a
 * @param {number} b
 */
function find_gcd(a, b) {
	return (b === 0) ? a : find_gcd(b, a % b);
}

/**
 * @param {number} a
 * @param {number} b
 */
function find_lcm(a, b) {
	return a * b / find_gcd(a, b);
}

export class Fraction {
	/** @type {number} */
	numerator;

	/** @type {number} */
	denominator;

	/**
	 * @param {number} numerator
	 * @param {number} denominator
	 */
	constructor(numerator, denominator) {
		this.numerator = numerator;
		this.denominator = denominator;
	}

	get toDecimal() {
		return this.numerator / this.denominator;
	}

	get toString() {
		return this.denominator === 1 ? `${this.numerator}` : `${this.numerator}/${this.denominator}`;
	}

	reduce() {
		if (this.numerator > this.denominator && this.numerator % this.denominator === 0)
			return new Fraction(this.numerator / this.denominator, 1);

		if (this.denominator % 2 === 0 && this.numerator % 2 === 0)
			return new Fraction(this.numerator / 2, this.denominator / 2).reduce();

		for (let i = 3; i <= Math.min(this.numerator, this.denominator); i += 2) {
			if (this.denominator % i === 0 && this.numerator % i === 0)
				return new Fraction(this.numerator / i, this.denominator / i).reduce();
		}
		return this;
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {Fraction}
	 */
	plus(other) {
		const other_f = (other instanceof Fraction) ? other : new Fraction(other, 1);

		const lcm = find_lcm(this.denominator, other_f.denominator);
		return new Fraction(this.numerator * (lcm / this.denominator) + other_f.numerator * (lcm / other_f.denominator), lcm).reduce();
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {Fraction}
	 */
	subtract(other) {
		const other_f = (other instanceof Fraction) ? other : new Fraction(other, 1);
		return this.plus(new Fraction(-other_f.numerator, other_f.denominator));
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {Fraction}
	 */
	multiply(other) {
		const other_f = (other instanceof Fraction) ? other : new Fraction(other, 1);
		return new Fraction(this.numerator * other_f.numerator, this.denominator * other_f.denominator).reduce();
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {Fraction}
	 */
	divide(other) {
		const other_f = (other instanceof Fraction) ? other : new Fraction(other, 1);
		return this.multiply(new Fraction(other_f.denominator, other_f.numerator));
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {boolean}
	 */
	lessThan(other) {
		const diff = this.subtract(other);
		return diff.numerator < 0;
	}

	/**
	 * @param {number | Fraction} other
	 * @returns {boolean}
	 */
	equals(other) {
		const diff = this.subtract(other);
		return diff.numerator === 0;
	}
}
