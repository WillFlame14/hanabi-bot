let ws;

/**
 * Initializes a local reference of the websocket.
 */
function wsInit(_ws) {
	ws = _ws;
}

function sendChat(recipient, msg) {
	sendCmd('chatPM', { msg, recipient, room: 'lobby' });
}

function sendCmd(command, arg) {
	const cmd = command + ' ' + JSON.stringify(arg);
	console.log('sending cmd ' + cmd);
	ws.send(cmd);
}

function findOrder(hand, order) {
	return hand.find(c => c.order === order);
}

function handFind(hand, suitIndex, rank) {
	return hand.filter(c => c.suitIndex === suitIndex && c.rank === rank);
}

function visibleFind(hands, suitIndex, rank) {
	const found = [];
	for (const hand of hands) {
		found.concat(handFind(hand, suitIndex, rank));
	}
	return found;
}

const CARD_COUNT = [3, 2, 2, 2, 1];

function isCritical(state, suitIndex, rank) {
	// console.log(`checking if suitIndex ${suitIndex} and rank ${rank} are critical`);
	// console.log(`card_count ${CARD_COUNT[rank - 1]} visibleFind len ${visibleFind(state.hands, suitIndex, rank - 1).length}`);
	// console.log(`discard_stacks ${state.discard_stacks}`);

	return state.discard_stacks[suitIndex][rank - 1] === (CARD_COUNT[rank - 1] - 1)
		&& visibleFind(state.hands, suitIndex, rank - 1).length === 0;
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
	return JSON.parse(JSON.stringify(obj));
}

function cardToString(card) {
	const colours = ['r', 'y', 'g', 'b', 'p'];
	return colours[card.suitIndex] + card.rank;
}

function logHand(hand) {
	const copy = objClone(hand);
	for (const card of copy) {
		card.possible = card.possible.map(c => cardToString(c));
		card.inferred = card.inferred.map(c => cardToString(c));
	}
	return copy;
}

module.exports = {
	CARD_COUNT,
	wsInit,
	sendChat, sendCmd,
	findOrder,
	handFind, visibleFind,
	isCritical,
	cardMatch, intersectCards, subtractCards,
	objClone,
	cardToString, logHand
};