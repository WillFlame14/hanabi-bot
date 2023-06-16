// @ts-nocheck
import * as https from 'https';
import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config();

import { handle } from './command-handler.js';
import { fetchVariants } from './variants.js';
import { initConsole } from './tools/console.js';
import * as Utils from './tools/util.js';

/**
 * Logs in to hanab.live and returns the session cookie to authenticate future requests.
 */
function connect(bot_index = '') {
	const u_field = `HANABI_USERNAME${bot_index}`, p_field = `HANABI_PASSWORD${bot_index}`;

	if (process.env[u_field] === undefined || process.env[p_field] === undefined) {
		throw new Error(`Missing ${u_field} and ${p_field} environment variables.`);
	}

	const data = `username=${process.env[u_field]}&password=${process.env[p_field]}&version=bot`;
	const options = {
		hostname: 'hanab.live',
		port: 443,
		path: '/login',
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': data.length
		}
	};

	return new Promise((resolve, reject) => {
		// Send login request to hanab.live
		const req = https.request(options, (res) => {
			console.log(`Request status code: ${res.statusCode}`);

			const cookie = res.headers['set-cookie'][0];
			if (cookie == null) {
				reject('Failed to parse cookie from auth headers.');
				return;
			}

			res.on('data', (data) => process.stdout.write(data));
			resolve(cookie);
		});

		req.on('error', (error) => {
			reject(`Request error: ${error}`);
			return;
		});

		// Write data body to POST request
		req.write(data);
		req.end();
	});
}

async function main() {
	const args = Utils.parse_args();

	let cookie = connect(args.index);
	fetchVariants();

	// Connect to server using credentials
	try {
		cookie = await cookie;
	}
	catch (error) {
		console.error(error);
		return;
	}

	// Establish websocket
	const ws = new WebSocket('wss://hanab.live/ws', { headers: { Cookie: cookie } });

	// Pass the websocket to utils
	Utils.globalModify({ ws });
	initConsole();

	ws.on('open', () => console.log('Established websocket connection!'));
	ws.on('error', (err) => console.log('Websocket error:', err));
	ws.on('close', () => console.log('Websocket closed from server.'));

	ws.on('message', (data) => {
		// Websocket messages are in the format: commandName {"field_name":"value"}
		const str = data.toString();
		const ind = str.indexOf(' ');
		const [command, arg] = [str.slice(0, ind), str.slice(ind + 1)];

		// Handle the command if there's a registered handler function for it
		if (handle[command] !== undefined) {
			handle[command](JSON.parse(arg));
		}
	});
}

main();
