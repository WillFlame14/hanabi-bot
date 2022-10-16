const https = require('https');

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

module.exports = { fetchVariants, getVariant, shortForms };
