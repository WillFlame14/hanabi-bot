const https = require('https');
const WebSocket = require('ws');

const { handle } = require('./command-handler.js');
const Utils = require('./util.js');

const data = `username=${process.env.HANABI_USERNAME}&password=${process.env.HANABI_PASSWORD}&version=bot`;
const options = {
	hostname: 'hanab.live',
	port: 443,
	path: '/login',
	method: 'POST',
	headers: {
		'Content-Type': 'application/x-www-form-urlencoded',
		'Content-Length': data.length
	}
}

/**
 * Logs in to hanab.live and returns the session cookie to authenticate future requests.
 */
function connect() {
	return new Promise((resolve, reject) => {
		if (process.env.HANABI_USERNAME === undefined || process.env.HANABI_PASSWORD === undefined) {
			console.log('Missing HANABI_USERNAME and HANABI_PASSWORD environment variables.');
			reject();
		}

		// Send login request to hanab.live
		const req = https.request(options, (res) => {
			console.log(`Request status code: ${res.statusCode}`);

			const cookie = res.headers['set-cookie'][0];
			if (cookie == null) {
				console.log('Failed to parse cookie from auth headers.');
				reject();
			}

			res.on('data', (data) => process.stdout.write(data));
			resolve(cookie);
		});

		req.on('error', (error) => {
			console.log('Request error:', error);
			reject();
		});

		// Write data body to POST request
		req.write(data);
		req.end();
	});
}

async function main() {
	const cookie = await connect();
	const ws = new WebSocket('wss://hanab.live/ws', { headers: { Cookie: cookie } });

	// Pass the websocket to utils
	Utils.wsInit(ws);

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
