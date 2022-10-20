const https = require('https');
const { CLUE } = require('./constants.js');

const variantsURL = 'https://raw.githubusercontent.com/Hanabi-Live/hanabi-live/main/packages/data/src/json/variants.json';
let variants_promise;

async function fetchVariants() {
	variants_promise = new Promise((resolve, reject) => {
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
}

async function getVariant(name) {
	const variants = await variants_promise;
	return variants.find(variant => variant.name === name);
}

const shortForms = {
	'Red': 'r',
	'Yellow': 'y',
	'Green': 'g',
	'Blue': 'b',
	'Purple': 'p',
	'Teal': 't',
	'Black': 'k',
	'Rainbow': 'm',
	'White': 'w',
	'Pink': 'i',
	'Brown': 'n',
	'Omni': 'o',
	'Null': 'u',
	'Prism': 'i'
};

function cardTouched(card, suits, clue) {
	const { type, value } = clue;
	const { suitIndex, rank } = card;
	const suit = suits[suitIndex];

	if (suit === 'Null') {
		return false;
	}
	else if (suit === 'Omni') {
		return true;
	}

	if (type === CLUE.COLOUR) {
		if (suit === 'White') {
			return false;
		}
		else if (suit === 'Rainbow') {
			return true;
		}
		else if (suit === 'Prism') {
			return (rank % suits.length - 1) === (value + 1);
		}

		return suitIndex === value;
	}
	else if (type === CLUE.RANK) {
		if (suit === 'Brown') {
			return false;
		}
		else if (suit === 'Pink') {
			return true;
		}

		return rank === value;
	}
}

function isCluable(suits, clue) {
	const { type, value } = clue;

	if (type === CLUE.COLOUR && ['Null', 'Omni', 'White', 'Rainbow', 'Prism'].includes(suits[value])) {
		return false;
	}
	return true;
}

function cardCount(suit, rank) {
	if (suit === 'Black') {
		return 1;
	}

	return [3, 2, 2, 2, 1][rank - 1];
}

module.exports = { cardCount, cardTouched, fetchVariants, getVariant, isCluable, shortForms };
