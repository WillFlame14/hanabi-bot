import * as https from 'https';
import { CLUE } from './constants.js';
import { combineRegex } from './tools/util.js';

/**
 * @typedef {import('./types.js').Clue} Clue
 * @typedef {import('./types.js').BaseClue} BaseClue
 * @typedef {import('./types.js').Identity} Identity
 * 
 * @typedef Variant
 * @property {number} id
 * @property {string} name
 * @property {string[]} suits
 * @property {number} [specialRank]
 * @property {boolean} [specialRankAllClueColors]
 * @property {boolean} [specialRankAllClueRanks]
 * @property {boolean} [specialRankNoClueColors]
 * @property {boolean} [specialRankNoClueRanks]
 * @property {boolean} [specialRankDeceptive]
 * @property {boolean} [chimneys]
 * @property {boolean} [funnels]
 * @property {number} [criticalRank]
 * @property {number} [specialRank]
 * @property {number[]} [clueRanks]
 */

const variantsURL = 'https://raw.githubusercontent.com/Hanabi-Live/hanabi-live/main/packages/game/src/json/variants.json';
const coloursURL = 'https://raw.githubusercontent.com/Hanabi-Live/hanabi-live/main/packages/game/src/json/suits.json';

const whitish = /White|Gray|Light|Null/;
const rainbowish = /Rainbow|Omni/;
const brownish = /Brown|Muddy|Cocoa|Null/;
const pinkish = /Pink|Omni/;
const dark = /Black|Dark|Gray|Cocoa/;
const prism = /Prism/;
const noColour = combineRegex(whitish, rainbowish, prism);
export const variantRegexes = {whitish, rainbowish, brownish, pinkish, dark, prism, noColour};

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
const colours_promise = new Promise((resolve, reject) => {
	https.get(coloursURL, (res) => {
		const { statusCode } = res;

		if (statusCode !== 200) {
			// Consume response data to free up memory
			res.resume();
			reject(`Failed to retrieve colours. Status Code: ${statusCode}`);
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
		console.error(`Error when retrieving colours: ${e.message}`);
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

export let shortForms = /** @type {string[]} */ (['r', 'y', 'g', 'b', 'p']);

/**
 * Edits shortForms to have the correct acryonyms.
 * @param {Variant} variant
 */
export async function getShortForms(variant) {
	const colours = await colours_promise;
	const abbreviations = [];
	for (const suitName of variant.suits) {
		if (['Black', 'Pink', 'Brown'].includes(suitName)) {
			abbreviations.push(['k', 'i', 'n'][['Black', 'Pink', 'Brown'].indexOf(suitName)]);
		} else {
			const abbreviation = colours.find(colour => colour.name === suitName)?.abbreviation ?? suitName.charAt(0);
			if (abbreviations.includes(abbreviation.toLowerCase()))
				abbreviations.push(suitName.toLowerCase().split('').find(char => !abbreviations.includes(char)));
			else
				abbreviations.push(abbreviation.toLowerCase());

		}
	}
	shortForms = abbreviations;
}

/**
 * Sets shortForms to contain the specified acryonyms.
 * @param {string[]} abbreviations
 */
export function setShortForms(abbreviations) {
	shortForms = abbreviations;
}

/** @param {Variant} variant */
export function colourableSuits(variant) {
	return variant.suits.filter(suit => !variantRegexes.noColour.test(suit));
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

	const colourableSuits = variant.suits.filter(suit => !variantRegexes.noColour.test(suit));

	if (type === CLUE.COLOUR) {
		if (suitIndex === -1 || variantRegexes.whitish.test(suit))
			return false;

		if (variantRegexes.rainbowish.test(suit))
			return true;

		if (variantRegexes.prism.test(suit))
			return ((rank - 1) % colourableSuits.length) === value;

		if (rank === variant.specialRank) {
			if (variant.specialRankAllClueColors)
				return true;
			else if (variant.specialRankNoClueColors)
				return false;
		}

		return variant.suits[suitIndex] === colourableSuits[value];
	}
	else if (type === CLUE.RANK) {
		if (rank === -1 || variantRegexes.brownish.test(suit))
			return false;
		if (rank === variant.specialRank) {
			if (variant.specialRankAllClueRanks)
				return rank != value;
			if (variant.specialRankNoClueRanks)
				return false;

			if (variant.specialRankDeceptive)
				return (suitIndex % 4) + (variant.specialRank === 1 ? 2 : 1) === value && rank != value;
		}

		if (variantRegexes.pinkish.test(suit))
			return true;

		if (variant.chimneys)
			return rank >= value;

		if (variant.funnels)
			return rank <= value;

		return rank === value;
	}
}

/**
 * Generates a list of clues that would touch the card.
 * @param {Variant} variant
 * @param {number} target
 * @param {Identity} card
 * @param {{ excludeColour?: boolean, excludeRank?: boolean, save?: boolean }} [options] 	Any additional options.
 */
export function direct_clues(variant, target, card, options) {
	const direct_clues = [];

	if (!options?.excludeColour) {
		for (let suitIndex = 0; suitIndex < colourableSuits(variant).length; suitIndex++) {
			const clue = { type: CLUE.COLOUR, value: suitIndex, target };

			if (cardTouched(card, variant, clue))
				direct_clues.push(clue);
		}
	}

	if (!options?.excludeRank) {
		for (let rank = 1; rank <= 5; rank++) {
			const clue = { type: CLUE.RANK, value: rank, target };

			if ((variant.clueRanks?.includes(rank) ?? true) && cardTouched(card, variant, clue))
				direct_clues.push(clue);
		}
	}

	return direct_clues;
}

/**
 * @param {string[]} suits
 */
export function all_identities(suits) {
	const identities = [];

	for (let suitIndex = 0; suitIndex < suits.length; suitIndex++) {
		for (let rank = 1; rank <= 5; rank++)
			identities.push({ suitIndex, rank });
	}
	return identities;
}

/**
 * @param {BaseClue} clue
 * @param {Variant} variant
 */
export function find_possibilities(clue, variant) {
	return all_identities(variant.suits).filter(id => cardTouched(id, variant, clue));
}

/**
 * Returns the total number of cards for an identity.
 * @param {Variant} variant
 * @param {Identity} identity
 */
export function cardCount(variant, { suitIndex, rank }) {
	if (suitIndex === -1 || rank === -1)
		return 4;

	if (variantRegexes.dark.test(variant.suits[suitIndex]))
		return 1;

	if (variant.criticalRank === rank)
		return 1;

	return [3, 2, 2, 2, 1][rank - 1];
}
