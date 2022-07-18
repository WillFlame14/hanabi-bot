const readline = require('readline');
const { logger } = require('./logger.js');

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
	process.stdin.setRawMode(true);

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
	return hand.filter(c => cardMatch(c, suitIndex, rank));
}

function handFindInfer(hand, suitIndex, rank) {
	return hand.filter(c => {
		if (c.possible.length === 1) {
			return cardMatch(c.possible[0], suitIndex, rank);
		}
		else if (c.inferred.length === 1) {
			return cardMatch(c.inferred[0], suitIndex, rank);
		}
		return false;
	});
}

function visibleFind(state, target, suitIndex, rank, ignoreIndex = -1) {
	let found = [];
	for (let i = 0; i < state.hands.length; i++) {
		if (i === ignoreIndex) {
			continue;
		}

		const hand = state.hands[i];
		if (i === target || i === state.ourPlayerIndex) {
			found = found.concat(handFindInfer(hand, suitIndex, rank));
		}
		else {
			found = found.concat(handFind(hand, suitIndex, rank));
		}
	}
	return found;
}

const CARD_COUNT = [3, 2, 2, 2, 1];

function isCritical(state, suitIndex, rank) {
	return state.discard_stacks[suitIndex][rank - 1] === (CARD_COUNT[rank - 1] - 1);
}

function cardMatch(card, suitIndex, rank) {
	return card.suitIndex === suitIndex && card.rank === rank;
}

function intersectCards(cards1, cards2) {
	return cards1.filter(c1 => cards2.some(c2 => cardMatch(c1, c2.suitIndex, c2.rank)));
}

function subtractCards(cards1, cards2) {
	return cards1.filter(c1 => !cards2.some(c2 => cardMatch(c1, c2.suitIndex, c2.rank)));
}

function objClone(obj) {
	if (typeof obj === 'object' && !Array.isArray(obj)) {
		const new_obj = {};
		for (const [name, value] of Object.entries(obj)) {
			if (typeof value === 'function') {
				new_obj[name] = value;
			}
			else {
				new_obj[name] = JSON.parse(JSON.stringify(value));
			}
		}
		return new_obj;
	}
	else {
		return JSON.parse(JSON.stringify(obj));
	}
}

function cardToString(card) {
	const colours = ['r', 'y', 'g', 'b', 'p'];
	return colours[card.suitIndex] + card.rank;
}

function logHand(hand) {
	const new_hand = [];

	for (const card of hand) {
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : cardToString(card));
		new_card.order = card.order;

		new_card.flags = [];
		for (const flag of ['clued', 'newly_clued', 'prompted', 'finessed', 'rewinded']) {
			if (card[flag]) {
				new_card.flags.push(flag);
			}
		}

		new_card.possible = card.possible.map(c => cardToString(c));
		new_card.inferred = card.inferred.map(c => cardToString(c));
		new_hand.push(new_card);
	}
	return new_hand;
}

function writeNote(card, tableID) {
	let note = card.inferred.map(c => cardToString(c)).join(',');
	if (card.finessed) {
		note = `[f] [${note}]`;
	}

	note = `t${card.reasoning_turn.at(-1)}: ${note}`;

	sendCmd('note', { tableID, order: card.order, note });
}

module.exports = {
	CARD_COUNT,
	globalModify, initConsole,
	sendChat, sendCmd,
	findOrder,
	handFind, visibleFind,
	isCritical,
	cardMatch, intersectCards, subtractCards,
	objClone,
	cardToString, logHand, writeNote
};
