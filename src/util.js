const readline = require('readline');
const { Card } = require('./basics/Card.js');
const { ACTION, CLUE } = require('./constants.js');
const { logger } = require('./logger.js');
const { shortForms } = require('./variants.js');

const globals = {};

/**
 * Modifies the global object.
 */
function globalModify(obj) {
	Object.assign(globals, obj);
}

/**
 * Initializes the console interactivity with the game state.
 */
function initConsole() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	let command = [];

	process.stdin.on('keypress', (_, key) => {
		if (key.ctrl && key.name === 'c') {
			process.exit();
		}

		if (globals.state === undefined) {
			return;
		}

		process.stdout.write(key.sequence);
		switch(key.sequence) {
			case '\r': {
				console.log();
				const parts = command.join('').split(' ');
				const { state } = globals;

				switch(parts[0]) {
					case 'hand': {
						if (parts.length !== 2) {
							console.log('Correct usage is "hand <playerName>"');
							break;
						}
						const playerName = parts[1];
						if (!state.playerNames.includes(playerName)) {
							console.log('That player is not in this room.');
							console.log(state.playerNames, playerName);
							break;
						}
						const playerIndex = state.playerNames.indexOf(playerName);
						console.log(logHand(state.hands[playerIndex]));
						break;
					}
					case 'state':
						console.log(state[parts[1]]);
						break;
				}
				command = [];
				break;
			}
			case '\b':
				command = command.slice(0, -1);
				break;
			default:
				command.push(key.sequence);
				break;
		}
	});
}

function sendChat(recipient, msg) {
	sendCmd('chatPM', { msg, recipient, room: 'lobby' });
}

function sendCmd(command, arg) {
	const cmd = command + ' ' + JSON.stringify(arg);
	logger.debug('sending cmd ' + cmd);
	globals.ws.send(cmd);
}

function objClone(obj) {
	if (typeof obj === 'object') {
		if (obj instanceof Card) {
			return obj.clone();
		}
		else if (Array.isArray(obj)) {
			return obj.map(elem => objClone(elem));
		}
		else {
			const new_obj = {};
			for (const [name, value] of Object.entries(obj)) {
					new_obj[name] = objClone(value);
			}
			return new_obj;
		}
	}
	else {
		return obj;
	}
}

function objPick(obj, attributes) {
	const new_obj = {};
	for (const attr of attributes) {
		new_obj[attr] = obj[attr];
	}
	return new_obj;
}

function logCard(card) {
	let suitIndex, rank, append;

	if (card.suitIndex !== -1) {
		({ suitIndex, rank } = card);
	}
	else if (card?.possible.length === 1) {
		({ suitIndex, rank } = card.possible[0]);
		append = '(known)';
	}
	else if (card?.inferred.length === 1) {
		({ suitIndex, rank } = card.inferred[0]);
		append = '(inferred)';
	}
	else {
		return '(unknown)';
	}
	return shortForms[globals.state.suits[suitIndex]] + rank + (append !== undefined ? ' ' + append : '');
}

function logHand(hand) {
	const new_hand = [];

	for (const card of hand) {
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : logCard(card));
		new_card.order = card.order;

		new_card.flags = [];
		for (const flag of ['clued', 'newly_clued', 'prompted', 'finessed', 'chop_moved', 'rewinded']) {
			if (card[flag]) {
				new_card.flags.push(flag);
			}
		}

		new_card.possible = card.possible.map(c => logCard(c));
		new_card.inferred = card.inferred.map(c => logCard(c));
		new_card.reasoning = card.reasoning_turn;
		new_hand.push(new_card);
	}
	return new_hand;
}

function logClue(clue) {
	if (clue === undefined) {
		return;
	}
	const value = [CLUE.COLOUR, ACTION.COLOUR].includes(clue.type) ? globals.state.suits[clue.value].toLowerCase() : clue.value;

	return `(${value} to ${globals.state.playerNames[clue.target]})`;
}

function writeNote(turn, card, tableID) {
	let note = card.inferred.map(c => logCard(c)).join(',');

	if (note === '') {
		note = '??';
	}

	if (card.finessed) {
		note = `[f] [${note}]`;
	}

	if (card.chop_moved) {
		note = `[cm] [${note}]`;
	}

	// Only write a new note if it's different from the last note
	if (note !== card.last_note) {
		card.last_note = note;

		if (card.full_note === '') {
			card.full_note = `t${turn}: ${note}`;
		}
		else {
			card.full_note = `${card.full_note} | t${turn}: ${note}`;
		}

		setTimeout(() => sendCmd('note', { tableID, order: card.order, note: card.full_note }), Math.random() * 3000);
	}
}

module.exports = {
	globalModify, initConsole,
	sendChat, sendCmd,
	objClone, objPick,
	logCard, logHand, logClue, writeNote
};
