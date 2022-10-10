const readline = require('readline');
const { Card } = require('./basics/Card.js');
const { logger } = require('./logger.js');
const { ACTION, CARD_COUNT } = require('./constants.js');

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
					case 'state': {
						console.log(state[parts[1]]);
					}
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

function findOrder(hand, order) {
	return hand.find(c => c.order === order);
}

function handFind(hand, suitIndex, rank) {
	return hand.filter(c => c.matches(suitIndex, rank));
}

function handFindInfer(hand, suitIndex, rank, options = {}) {
	return hand.filter(c => {
		if (c.possible.length === 1) {
			return c.possible[0].matches(suitIndex, rank);
		}
		else if (!options.noInfer && c.inferred.length === 1) {
			return c.inferred[0].matches(suitIndex, rank);
		}
		return false;
	});
}

function handLocked(hand) {
	return hand.every(c => c.clued || c.chop_moved);
}

function visibleFind(state, inferringPlayerIndex, suitIndex, rank, options = {}) {
	let found = [];
	for (let i = 0; i < state.numPlayers; i++) {
		if (options.ignore?.includes(i)) {
			continue;
		}

		const hand = state.hands[i];
		if (i === inferringPlayerIndex || i === state.ourPlayerIndex) {
			found = found.concat(handFindInfer(hand, suitIndex, rank, options));
		}
		else {
			found = found.concat(handFind(hand, suitIndex, rank));
		}
	}
	return found;
}

// NOTE: This function uses ACTION instead of CLUE, which is not typical.
function clueTouched(hand, clue) {
	const { type, value } = clue;
	if (type === ACTION.COLOUR) {
		return hand.filter(c => c.suitIndex === value);
	}
	else if (type === ACTION.RANK) {
		return hand.filter(c => c.rank === value);
	}
}

function isCritical(state, suitIndex, rank) {
	return state.discard_stacks[suitIndex][rank - 1] === (CARD_COUNT[rank - 1] - 1);
}

function isBasicTrash(state, suitIndex, rank) {
	return rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex];
}

function isSaved(state, inferringPlayerIndex, suitIndex, rank, order = -1, options) {
	return visibleFind(state, inferringPlayerIndex, suitIndex, rank, options).some(c => {
		if (order !== -1 && c.order === order) {
			return false;
		}
		return c.finessed || c.clued || c.chop_moved;
	});
}

function isTrash(state, suitIndex, rank, order) {
	return isBasicTrash(state, suitIndex, rank) || isSaved(state, state.ourPlayerIndex, suitIndex, rank, order);
}

function playableAway(state, suitIndex, rank) {
	return rank - (state.play_stacks[suitIndex] + 1);
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

function logCard(suitIndex, rank) {
	const colours = ['r', 'y', 'g', 'b', 'p', 't'];
	return colours[suitIndex] + rank;
}

function logHand(hand) {
	const new_hand = [];

	for (const card of hand) {
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : card.toString());
		new_card.order = card.order;

		new_card.flags = [];
		for (const flag of ['clued', 'newly_clued', 'prompted', 'finessed', 'chop_moved', 'rewinded']) {
			if (card[flag]) {
				new_card.flags.push(flag);
			}
		}

		new_card.possible = card.possible.map(c => c.toString());
		new_card.inferred = card.inferred.map(c => c.toString());
		new_card.reasoning = card.reasoning_turn;
		new_hand.push(new_card);
	}
	return new_hand;
}

function logClue(clue) {
	if (clue === undefined) {
		return;
	}

	const new_clue = {};
	const value = clue.type === 2 ? ['red', 'yellow', 'green', 'blue', 'purple', 'teal'][clue.value] : clue.value;

	new_clue.info = `(${value} to playerIndex ${clue.target})`;
	return new_clue.info;
}

function writeNote(turn, card, tableID) {
	let note = card.inferred.map(c => c.toString()).join(',');

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

function getPace(state) {
	return state.play_stacks.reduce((acc, curr) => acc + curr) + state.cards_left + state.numPlayers - (state.suits.length * 5);
}

module.exports = {
	CARD_COUNT,
	globalModify, initConsole,
	sendChat, sendCmd,
	findOrder,
	handFind, handFindInfer, handLocked, visibleFind,
	clueTouched,
	isCritical, isBasicTrash, isSaved, isTrash, playableAway,
	objClone, objPick,
	logCard, logHand, logClue, writeNote,
	getPace
};
