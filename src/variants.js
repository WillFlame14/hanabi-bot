import * as https from 'https';
import { CLUE } from './constants.js';

/**
 * @typedef {import('./types.js').Clue} Clue
 * @typedef {import('./types.js').Identity} Identity
 * 
 * @typedef Variant
 * @property {number} id
 * @property {string} name
 * @property {string[]} suits
 * @property {string} newID
 * @property {number} [specialRank]
 * @property {boolean} [specialRankAllClueColors]
 * @property {boolean} [specialRankAllClueRanks]
 * @property {boolean} [specialRankNoClueColors]
 * @property {boolean} [specialRankNoClueRanks]
 * @property {number} criticalRank
 */

const variantsURL = 'https://raw.githubusercontent.com/Hanabi-Live/hanabi-live/main/packages/game/src/json/variants.json';
const colorsURL = 'https://raw.githubusercontent.com/Hanabi-Live/hanabi-live/main/packages/game/src/json/suits.json';

/** @type {Promise<Variant[]>} */
const variants_promise = new Promise((resolve, reject) => {
	https.get(variantsURL, (res) => {
		const { statusCode } = res;

		if (statusCode !== 200) {
			// Consume response data to free up memory
			res.resume();
			reject(`Failed to retrieve variants. Status Code: ${statusCode}`);
		}

		res.setEncoding('utf8');

		let rawData = '';
		res.on('data', (chunk) => { rawData += chunk; });
		res.on('end', () => {
			try {
				const parsedData = JSON.parse(rawData);
				resolve(parsedData);
			} catch (e) {
				reject(e.message);
			}
		});
	}).on('error', (e) => {
		console.error(`Error when retrieving variants: ${e.message}`);
	});
});

/** @type {Promise<Array>} */
const colors_promise = new Promise((resolve, reject) => {
	https.get(colorsURL, (res) => {
		const { statusCode } = res;

		if (statusCode !== 200) {
			// Consume response data to free up memory
			res.resume();
			reject(`Failed to retrieve colors. Status Code: ${statusCode}`);
		}

		res.setEncoding('utf8');

		let rawData = '';
		res.on('data', (chunk) => { rawData += chunk; });
		res.on('end', () => {
			try {
				const parsedData = JSON.parse(rawData);
				resolve(parsedData);
			} catch (e) {
				reject(e.message);
			}
		});
	}).on('error', (e) => {
		console.error(`Error when retrieving colors: ${e.message}`);
	});
});

/**
 * Returns a variant's properties, given its name.
 * @param {string} name
 */
export async function getVariant(name) {
	const variants = await variants_promise;
	return variants.find(variant => variant.name === name);
}

export let shortForms = /** @type {string[]} */ ([]);

/**
 * Edits shortForms to have the correct acryonyms.
 * @param {string[]} suits
 */
export async function getShortForms(suits) {
	const colors = await colors_promise;
	const abbreviations = [];
	for (const suitName of suits) {
		if (['Black', 'Pink', 'Brown'].includes(suitName)) {
			abbreviations.push(['k', 'i', 'n'][['Black', 'Pink', 'Brown'].indexOf(suitName)]);
		} else {
			const abbreviation = colors.find(color => color.name === suitName)?.abbreviation ?? suitName.charAt(0);
			if (abbreviations.includes(abbreviation.toLowerCase())) {
				for (const char of suitName) {
					if (!abbreviations.includes(char)) {
						abbreviations.push(char.toLowerCase());
						break;
					}
				}
			} else {
				abbreviations.push(abbreviation.toLowerCase());
			}
		}
	}
	shortForms = abbreviations;
}

/**
 * Returns whether the card would be touched by the clue.
 * @param {Identity} card
 * @param {Variant} variant
 * @param {Omit<Clue, 'target'>} clue
 */
export function cardTouched(card, variant, clue) {
	const { type, value } = clue;
	const { suitIndex, rank } = card;
	const suit = variant.suits[suitIndex];

	if (suit === 'Null' || suit === 'Dark Null') {
		return false;
	}
	else if (suit === 'Omni' || suit === 'Dark Omni') {
		return true;
	}

	if (type === CLUE.COLOUR) {
		if (['White', 'Gray', 'Light Pink', 'Gray Pink'].includes(suit)) {
			return false;
		}
		else if (['Rainbow', 'Dark Rainbow', 'Muddy Rainbow', 'Cocoa Rainbow'].includes(suit)) {
			return true;
		}
		else if (suit === 'Prism' || suit === 'Dark Prism') {
			// TODO: Fix implementation of prism touch for complex variants (ex. Prism & Dark Prism)
			return (rank % variant.suits.length - 1) === (value + 1);
		}

		if (rank === variant.specialRank) {
			if (variant.specialRankAllClueColors) {
				return true;
			}
			else if (variant.specialRankNoClueColors) {
				return false;
			}
		}

		return suitIndex === value;
	}
	else if (type === CLUE.RANK) {
		if (['Brown', 'Dark Brown', 'Muddy Rainbow', 'Cocoa Rainbow'].includes(suit)) {
			return false;
		}
		else if (['Pink', 'Dark Pink', 'Light Pink', 'Gray Pink'].includes(suit)) {
			return true;
		}

		if (rank === variant.specialRank) {
			if (variant.specialRankAllClueRanks) {
				return true;
			}
			else if (variant.specialRankNoClueRanks) {
				return false;
			}
		}

		return rank === value;
	}
}

/**
 * Returns whether the clue is possible to give. For example, white cannot be clued.
 * @param {Variant} variant
 * @param {Omit<Clue, 'target'>} clue
 */
export function isCluable(variant, clue) {
	const { type, value } = clue;

	if (type === CLUE.COLOUR && [
		'Null', 'Omni', 'White', 'Rainbow', 'Light Pink', 'Muddy Rainbow', 'Prism',
		'Dark Null', 'Dark Omni', 'Gray', 'Dark Rainbow', 'Gray Pink', 'Cocoa Rainbow', 'Dark Prism'
	].includes(variant.suits[value])) {
		return false;
	}
	if (type === CLUE.RANK && value === variant.specialRank && (variant.specialRankAllClueRanks || variant.specialRankNoClueRanks)) {
		return false;
	}
	return true;
}

/**
 * Returns the total number of cards for an identity.
 * @param {string[]} suits
 * @param {Variant} variant
 * @param {Identity} identity
 */
export function cardCount(suits, variant, { suitIndex, rank }) {
	if ([
		'Dark Null', 'Dark Brown', 'Cocoa Rainbow',
		'Gray', 'Black', 'Dark Rainbow',
		'Gray Pink', 'Dark Pink', 'Dark Omni',
		'Dark Prism'
	].includes(suits[suitIndex])) {
		return 1;
	}

	if (variant.criticalRank === rank) {
		return 1;
	}

	return [3, 2, 2, 2, 1][rank - 1];
}
