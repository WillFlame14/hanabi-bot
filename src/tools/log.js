import { ACTION, CLUE, END_CONDITION } from '../constants.js';
import { shortForms } from '../variants.js';
import { globals } from './util.js';

/**
 * @typedef {import('../basics/State.js').State} State
 * @typedef {import('../basics/Hand.js').Hand} Hand
 * @typedef {import('../basics/Card.js').Card} Card
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Action} Action
 * @typedef {import('../types.js').PerformAction} PerformAction
 */

/**
 * Returns a log-friendly representation of a card.
 * @param {{suitIndex: number, rank: number} & Partial<Card>} card
 */
export function logCard(card) {
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

/**
 * Returns a log-friendly representation of a hand.
 * @param {Card[]} hand
 */
export function logHand(hand) {
	const new_hand = [];

	for (const card of hand) {
		const new_card = {};
		new_card.visible = (card.suitIndex === -1 ? 'unknown' : logCard(card));
		new_card.order = card.order;

		/** @type {string[]} */
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

/**
 * Returns a log-friendly representation of a clue.
 * @param {Clue | PerformAction} clue
 */
export function logClue(clue) {
	if (clue === undefined) {
		return;
	}
	const value = (clue.type === CLUE.COLOUR || clue.type === ACTION.COLOUR) ? globals.state.suits[clue.value].toLowerCase() : clue.value;

	return `(${value} to ${globals.state.playerNames[clue.target]})`;
}

/**
 * Returns a log-friendly representation of a PerformAction.
 * @param  {PerformAction} action
 */
export function logPerformAction(action) {
	if (action === undefined) {
		return;
	}

	const { type, target } = action;

	/** @type {Hand} */
	const hand = globals.state.hands[globals.state.ourPlayerIndex];

	switch(type) {
		case ACTION.PLAY: {
			const slot = hand.findIndex(card => card.order === target) + 1;
			const card = hand[slot - 1];

			return `Play slot ${slot}, inferences [${card.inferred.map(c => logCard(c))}]`;
		}
		case ACTION.DISCARD: {
			const slot = hand.findIndex(card => card.order === target) + 1;
			const card = hand[slot - 1];

			return `Discard slot ${slot}, inferences [${card.inferred.map(c => logCard(c))}]`;
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
 * Returns a log-friendly representation of an Action.
 * @param  {Action} action
 */
export function logAction(action) {
	/** @type {State} */
	const state = globals.state;

	if (action === undefined) {
		return;
	}

	switch(action.type) {
		case 'clue': {
			const { giver, target, clue } = action;
			const [playerName, targetName] = [giver, target].map(index => state.playerNames[index]);
			let clue_value;

			if (clue.type === CLUE.COLOUR) {
				clue_value = state.suits[clue.value].toLowerCase();
			}
			else {
				clue_value = clue.value;
			}
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
					return `Players score ${state.play_stacks.reduce((acc, stack) => acc += stack, 0)} points.`;
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
