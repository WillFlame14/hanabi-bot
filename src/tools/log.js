import { ACTION, CLUE, END_CONDITION } from '../constants.js';
import { Card } from '../basics/Card.js';
import { colourableSuits, shortForms, variantRegexes } from '../variants.js';
import { globals } from './util.js';

/**
 * @typedef {import('../basics/Game.js').Game} Game
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../basics/Hand.js').Hand} Hand
 * @typedef {import('../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../basics/Player.js').Player} Player
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').PerformAction} PerformAction
 * @typedef {import('../types.js').Connection} Connection
 * @typedef {import('../types.js').Link} Link
 */

/**
 * Returns a log-friendly representation of a card.
 * @param {{suitIndex: number, rank: number} | ActualCard | Card} card
 */
export function logCard(card) {
	let suitIndex, rank, append;

	if (card.suitIndex !== -1) {
		({ suitIndex, rank } = card);
	}
	else if (card instanceof Card && card.possible.length === 1) {
		({ suitIndex, rank } = card.possible.array[0]);
		append = '(known)';
	}
	else if (card instanceof Card && card.inferred.length === 1) {
		({ suitIndex, rank } = card.inferred.array[0]);
		append = '(inferred)';
	}
	else {
		return '(unknown)';
	}
	return shortForms[suitIndex] + rank + (append !== undefined ? ' ' + append : '');
}

/**
 * Returns a log-friendly representation of a hand.
 * @param {{ order: number }[]} hand
 * @param {Player} [player]
 */
export function logHand(hand, player = globals.game.common) {
	const new_hand = [];

	for (const { order } of hand) {
		const card = player.thoughts[order];
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : logCard(card));
		new_card.order = card.order;

		new_card.flags = ['clued', 'newly_clued', 'prompted', 'finessed', 'chop_moved', 'rewinded', 'hidden', 'called_to_discard'].filter(flag => card[flag]);

		new_card.possible = card.possible.map(logCard);
		new_card.inferred = card.inferred.map(logCard);
		new_card.reasoning = card.reasoning_turn;
		new_hand.push(new_card);
	}
	return new_hand;
}

/**
 * Returns a log-friendly representation of a clue.
 * @param {Clue | Omit<PerformAction, 'tableID'>} clue
 */
export function logClue(clue) {
	if (clue === undefined)
		return;

	const { state } = globals.game;
	const value = (clue.type === CLUE.COLOUR || clue.type === ACTION.COLOUR) ? colourableSuits(state.variant)[clue.value].toLowerCase() : clue.value;

	return `(${value} to ${state.playerNames[clue.target]})`;
}

/**
 * Returns a log-friendly representation of a PerformAction.
 * @param  {Omit<PerformAction, 'tableID'>} action
 */
export function logPerformAction(action) {
	if (action === undefined)
		return;

	const { type, target } = action;

	/** @type {Game} */
	const game = globals.game;

	const { common, state } = game;
	const hand = state.hands[state.ourPlayerIndex];

	switch(type) {
		case ACTION.PLAY: {
			const slot = hand.findIndex(card => card.order === target) + 1;
			const card = common.thoughts[hand[slot - 1].order];

			return `Play slot ${slot}, inferences [${card.inferred.map(logCard)}]`;
		}
		case ACTION.DISCARD: {
			const slot = hand.findIndex(card => card.order === target) + 1;
			const card = common.thoughts[hand[slot - 1].order];

			return `Discard slot ${slot}, inferences [${card.inferred.map(logCard)}]`;
		}
		case ACTION.COLOUR:
		case ACTION.RANK:
			return logClue(action);
		case ACTION.END_GAME:
			return JSON.stringify(action);
		default:
			throw new Error('Attempted to log invalid action');
	}
}

/**
 * Returns a log-friendly representation of a PerformAction objectively.
 * @param  {State} state
 * @param  {Omit<PerformAction, 'tableID'> & { playerIndex: number }} action
 */
export function logObjectiveAction(state, action) {
	/** @type {string} */
	let actionType;

	switch (action.type) {
		case ACTION.PLAY:
			actionType = `play ${logCard(state.deck[action.target])}`;
			break;
		case ACTION.COLOUR:
		case ACTION.RANK:
			if (action.target === -1)
				actionType = 'clue';
			else
				actionType = `clue ${logClue(action)}`;
			break;
		case ACTION.DISCARD:
			actionType = 'discard';
	}

	return `${actionType} (${state.playerNames[action.playerIndex]})`;
}

/**
 * Returns a log-friendly representation of an Action.
 * @param  {Action} action
 */
export function logAction(action) {
	/** @type {State} */
	const state = globals.game.state;

	if (action === undefined)
		return;

	switch(action.type) {
		case 'clue': {
			const { giver, target, clue } = action;
			const [playerName, targetName] = [giver, target].map(index => state.playerNames[index]);
			let clue_value;

			if (clue.type === CLUE.COLOUR)
				clue_value = state.variant.suits.filter(suit => !suit.match(variantRegexes.noColour))[clue.value].toLowerCase();
			else
				clue_value = clue.value;

			return `${playerName} clues ${clue_value} to ${targetName}`;
		}
		case 'discard': {
			const { playerIndex, rank, suitIndex, failed } = action;
			const playerName = state.playerNames[playerIndex];

			return `${playerName} ${failed ? 'bombs' : 'discards'} ${logCard({ suitIndex, rank })}`;
		}
		case 'draw': {
			const { playerIndex, suitIndex, rank } = action;

			return `${state.playerNames[playerIndex]} draws ${logCard({ suitIndex, rank })}`;
		}
		case 'gameOver': {
			const { endCondition, playerIndex } = action;

			switch(endCondition) {
				case END_CONDITION.NORMAL:
					return `Players score ${state.score} points.`;
				case END_CONDITION.STRIKEOUT:
					return `Players lose!`;
				case END_CONDITION.TERMINATED:
					return `${state.playerNames[playerIndex]} terminated the game!`;
				case END_CONDITION.IDLE_TIMEOUT:
					return 'Players were idle for too long.';
				default:
					return `gameOver ${JSON.stringify(action)}`;
			}
		}
		case 'turn': {
			const { currentPlayerIndex, num } = action;
			return `Turn ${num} (${state.playerNames[currentPlayerIndex]})`;
		}
		case 'play': {
			const { playerIndex, rank, suitIndex } = action;
			const playerName = state.playerNames[playerIndex];

			return `${playerName} plays ${logCard({ suitIndex, rank })}`;
		}
		default:
			return JSON.stringify(action);
	}
}

/**
 * @param {Connection} connection
 */
export function logConnection(connection) {
	const { type, reacting, identities, card } = connection;
	const identity = identities.length === 1 ? logCard(identities[0]) : `[${identities.map(logCard)}]`;
	const logType = type === 'finesse' ? (connection.bluff ? 'bluff' : 'finesse') : type;

	return `${card.order} ${identity} ${logType} (${globals.game.state.playerNames[reacting]})${connection.certain ? ' (certain)' : ''}`;
}

/**
 * @param {Connection[]} connections
 * @param {Identity} nextIdentity
 */
export function logConnections(connections, nextIdentity) {
	const { suitIndex, rank } = nextIdentity;
	const showNext = globals.game.state.max_ranks[suitIndex] >= rank;

	return `[${connections.map(conn => logConnection(conn)).join(' -> ')} ${showNext ? `-> ${logCard(nextIdentity)}?` : ''}]`;
}

/**
 * @param {Link[]} links
 */
export function logLinks(links) {
	return links.map(link => {
		const { cards, identities, promised } = link;

		return {
			cards: cards.map(c => c.order),
			identities: identities.map(logCard),
			promised
		};
	});
}
