import { CLUE } from '../../../constants.js';
import { CLUE_INTERP, LEVEL } from '../h-constants.js';
import { determine_focus, getIgnoreOrders } from '../hanabi-logic.js';
import { find_connecting, find_known_connecting, resolve_bluff } from './connecting-cards.js';
import { cardTouched, find_possibilities } from '../../../variants.js';
import { valid_bluff } from './connection-helper.js';
import * as Utils from '../../../tools/util.js';

import logger from '../../../tools/logger.js';
import { logCard, logConnection } from '../../../tools/log.js';


export class IllegalInterpretation extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

export class RewindEscape extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * @param {Game} game
 * @param {number} finesses
 * @param {ActualCard} prompt
 * @param {Identity} identity
 * @returns {Connection[]}
 */
function own_prompt(game, finesses, prompt, identity) {
	const { state, me } = game;

	if (game.level === 1 && finesses >= 1)
		throw new IllegalInterpretation('blocked prompt + finesse at level 1');

	const card = me.thoughts[prompt.order];
	const reacting = state.ourPlayerIndex;

	if (card.rewinded && identity.suitIndex !== prompt.suitIndex && state.isPlayable(prompt)) {
		if (game.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation('blocked hidden finesse at level 1');

		return [{ type: 'known', reacting, card: prompt, hidden: true, self: true, identities: [prompt.raw()] }];
	}

	if (card.matches(identity, { assume: true }))
		return [{ type: 'prompt', reacting, card: prompt, self: true, identities: [identity] }];

	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {ActualCard} focusedCard
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number[]} connected
 * @param {number[]} ignoreOrders
 * @param {number} ignorePlayer
 * @param {number[]} selfRanks
 * @param {number} finesses
 * @returns {Connection[]}
 */
function connect(game, action, focusedCard, identity, looksDirect, connected, ignoreOrders, ignorePlayer, selfRanks, finesses) {
	const { common, state } = game;
	const { giver, target } = action;
	const our_hand = state.hands[state.ourPlayerIndex];

	// First, see if someone else has the connecting card
	const connections = find_connecting(game, action, identity, looksDirect, connected, ignoreOrders, { knownOnly: [ignorePlayer] });
	const other_connecting = resolve_bluff(game, target, connections, focusedCard, identity, action);
	if (other_connecting.length > 0 && other_connecting[0].type !== 'terminate' && (other_connecting.at(-1).reacting != state.ourPlayerIndex || other_connecting.at(-1).card.matches(identity, {assume: true})))
		return other_connecting;

	// See if the giver knows about their own card
	const duplicated_in_own = state.hands[giver].find(c => c.matches(identity) && common.unknown_plays.has(c.order));
	if (duplicated_in_own && game.players[giver].thoughts[duplicated_in_own.order].identity({ infer: true })?.matches(identity)) {
		logger.warn(`assuming ${state.playerNames[giver]} knows about their own ${logCard(identity)} asymmetrically`);
		return [{ type: 'known', reacting: giver, card: duplicated_in_own, identities: [identity] }];
	}

	if (giver !== state.ourPlayerIndex && !(target === state.ourPlayerIndex && looksDirect)) {
		// Otherwise, try to find prompt in our hand
		const prompt = common.find_prompt(our_hand, identity, state.variant, connected, ignoreOrders);
		logger.debug('prompt in slot', prompt ? our_hand.findIndex(c => c.order === prompt.order) + 1 : '-1');

		if (prompt !== undefined) {
			const connections = own_prompt(game, finesses, prompt, identity);

			if (connections.length > 0)
				return connections;
		}
		else if (!selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, ignorePlayer === -1);
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					// Will probably never be seen
					logger.warn(error.message);
				else
					throw error;
			}
		}
	}

	// Use the ignoring player's hand
	if (ignorePlayer !== -1) {
		const their_hand = state.hands[ignorePlayer];
		const prompt = common.find_prompt(their_hand, identity, state.variant, connected, ignoreOrders);

		if (prompt !== undefined) {
			if (game.level === 1 && finesses >= 1)
				throw new IllegalInterpretation('blocked double finesse at level 1');

			if (common.thoughts[prompt.order].matches(identity, { assume: true }))
				return [{ type: 'prompt', reacting: target, card: prompt, self: true, identities: [identity] }];
		}
		else {
			const finesse = common.find_finesse(their_hand, connected, ignoreOrders);

			if (finesse) {
				const card = common.thoughts[finesse.order];

				if (card.inferred.has(identity) && card.matches(identity, { assume: true })) {
					if (game.level === 1 && connected.length >= 1)
						throw new IllegalInterpretation('blocked double finesse at level 1');

					return [{ type: 'finesse', reacting: target, card: finesse, self: true, identities: [identity] }];
				}
			}
		}

		// Try finesse in our hand again (if we skipped it earlier to prefer ignoring player)
		if (giver !== state.ourPlayerIndex && !(target === state.ourPlayerIndex && looksDirect) && selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, ignorePlayer === -1);
			}
			catch (error) {
				if (error instanceof IllegalInterpretation)
					logger.warn(error.message);
				else
					throw error;
			}
		}
	}
	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse/bluff through own hand if necessary.
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number} [ignorePlayer]
 * @param {number[]} [selfRanks]
 * @throws {IllegalInterpretation} If no connection can be found.
 * @returns {Connection[]}
 */
export function find_own_finesses(game, action, identity, looksDirect, ignorePlayer = -1, selfRanks = []) {
	const { common, state } = game;
	const { giver, target, clue, list } = action;
	const { suitIndex, rank } = identity;
	const { focused_card } = determine_focus(state.hands[target], common, list, { beforeClue: true });

	if (giver === state.ourPlayerIndex && ignorePlayer === -1)
		throw new IllegalInterpretation('cannot finesse ourselves.');

	if (target === (ignorePlayer === -1 ? state.ourPlayerIndex : ignorePlayer)) {
		const connected = find_known_connecting(game, giver, { suitIndex, rank }, getIgnoreOrders(game, 0, suitIndex));

		if (connected !== undefined && connected.type !== 'terminate' && connected.card.order !== focused_card.order)
			throw new IllegalInterpretation(`won't find own finesses for ${logCard({ suitIndex, rank })} when someone already has [${logConnection(connected)}]`);
	}

	// Create hypothetical state where we have the missing cards (and others can elim from them)
	const hypo_game = game.minimalCopy();
	const { state: hypo_state, common: hypo_common } = hypo_game;

	const connections = /** @type {Connection[]} */ ([]);
	const already_connected = [focused_card.order];

	let finesses = 0;
	let direct = looksDirect;

	for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
		const next_identity = { suitIndex, rank: next_rank };
		const ignoreOrders = getIgnoreOrders(game, next_rank - state.play_stacks[suitIndex] - 1, suitIndex);

		const curr_connections = connect(hypo_game, action, focused_card, next_identity, direct, already_connected, ignoreOrders, ignorePlayer, selfRanks, finesses);

		if (curr_connections.length === 0)
			throw new IllegalInterpretation(`no connecting cards found for identity ${logCard(next_identity)}`);

		if (curr_connections[0].type === 'terminate') {
			Object.assign(game, hypo_game);
			throw new RewindEscape('successfully found self-finesse!');
		}

		let allHidden = true;
		for (const connection of curr_connections) {
			connections.push(connection);

			const { reacting, card, hidden, bluff, type } = connection;

			if (type === 'finesse') {
				finesses++;

				// Someone else playing into a finesse reveals that it's not direct (UNLESS it was a colour clue, we already checked if fully known)
				// Note that just playing a hidden card doesn't work - they have to actually play the connecting card eventually
				if (direct && !hidden && reacting !== target && clue.type !== CLUE.COLOUR)
					direct = false;
			}

			if (hidden) {
				const id = card.identity();

				if (id !== undefined) {
					hypo_state.play_stacks[id.suitIndex]++;
					hypo_common.hypo_stacks[id.suitIndex]++;		// Everyone knows this card is playing
				}

				if (bluff)
					allHidden = false;
			}
			else {
				allHidden = false;

				// Assume this is actually the card
				const conn_card = hypo_common.thoughts[card.order];
				conn_card.inferred = conn_card.inferred.intersect(next_identity);
				hypo_common.good_touch_elim(hypo_state);
			}
			already_connected.push(card.order);
		}

		// Hidden connection, need to look for this rank again
		if (allHidden)
			next_rank--;
		else
			hypo_state.play_stacks[suitIndex]++;
	}
	return resolve_bluff(game, target, connections, focused_card, { suitIndex, rank }, action);
}

/**
 * @param {Game} game
 * @param {Identity} identity
 * @param {number[]} [connected] 		The orders of cards that have previously connected.
 * @param {number[]} [ignoreOrders] 	The orders of cards that should be ignored when searching.
 */
function resolve_layered_finesse(game, identity, connected = [], ignoreOrders = []) {
	const { common, state } = game;
	const our_hand = state.hands[state.ourPlayerIndex];

	/** @type {Connection[]} */
	const connections = [];
	const already_connected = connected.slice();

	for (const action of game.next_finesse) {
		const start_index = our_hand.findIndex(c => c.order === common.find_finesse(our_hand, already_connected, ignoreOrders).order);
		const { list, clue } = action;

		// Touching a matching card to the finesse - all untouched cards are layered
		// Touching a non-matching card - all touched cards are layered
		const matching = cardTouched(identity, state.variant, clue);

		for (let i = start_index; matching !== list.includes(our_hand[i].order); i++) {
			const card = our_hand[i];

			if (ignoreOrders.includes(card.order))
				throw new IllegalInterpretation(`impossible layered finesse, ignoring card order ${card.order}`);

			let identities = common.hypo_stacks.map((stack_rank, suitIndex) => ({ suitIndex, rank: stack_rank + 1 }));

			// Touching a non-matching card - we know exactly what playbable identities it should be
			if (!matching) {
				const possibilities = find_possibilities(clue, state.variant);
				identities = identities.filter(card => possibilities.some(p => p.suitIndex === card.suitIndex && p.rank === identity.rank));
			}

			if (identities.length === 0)
				throw new IllegalInterpretation(`impossible layered finesse, card ${card.order} has no playable identities`);

			connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card, hidden: true, self: true, identities });
			common.thoughts[card.order].inferred = common.thoughts[card.order].inferred.intersect(identities);
			already_connected.push(card.order);

			if (i === our_hand.length - 1)
				throw new IllegalInterpretation('blocked layered finesse with no end');
		}
	}

	// Assume next card is the finesse target
	const finesse = common.find_finesse(our_hand, already_connected, ignoreOrders);

	// Layered finesse is impossible
	if (finesse === undefined)
		throw new IllegalInterpretation(`couldn't find a valid finesse target after layers`);

	connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, self: true, identities: [identity] });
	return connections;
}

/**
 * @param {Game} game
 * @param {ClueAction} action
 * @param {Identity} identity
 * @param {number[]} connected
 * @param {number[]} ignoreOrders
 * @param {number} finesses
 * @param {boolean} allow_rewind
 * @returns {Connection[]}
 */
function find_self_finesse(game, action, identity, connected, ignoreOrders, finesses, allow_rewind) {
	const { common, state, me } = game;
	const { suitIndex, rank } = identity;
	const { giver } = action;
	const our_hand = state.hands[state.ourPlayerIndex];

	const finesse = common.find_finesse(our_hand, connected, ignoreOrders);
	logger.debug('finesse in slot', finesse ? our_hand.findIndex(c => c.order === finesse.order) + 1 : '-1');

	if (finesse === undefined)
		throw new IllegalInterpretation('no finesse slot');

	const card = me.thoughts[finesse.order];
	const reacting = state.ourPlayerIndex;

	const possibly_bluff = valid_bluff(game, action, finesse, reacting, connected);
	if (card.rewinded) {
		if (game.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation(`blocked layered finesse at level ${game.level}`);

		if (finesse.suitIndex !== identity.suitIndex && state.isPlayable(finesse))
			return [{ type: 'finesse', reacting, card: finesse, hidden: true, self: true, bluff: possibly_bluff, identities: [finesse.raw()] }];
	}

	if ((card.inferred.has(identity) && card.matches(identity, { assume: true })) || (possibly_bluff && card.inferred.some(id => state.isPlayable(id)))) {
		if (game.level === 1 && connected.length > 1)
			throw new IllegalInterpretation(`blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);

		// We have some information about the next finesse
		if (game.next_finesse.length > 0)
			return resolve_layered_finesse(game, identity, connected, ignoreOrders);

		const certain = state.hands[giver].some(c => c.matches(identity) && common.unknown_plays.has(c.order));
		const ambiguous = state.hands.some(hand => {
			const finesse = common.find_finesse(hand, connected);
			if (finesse === undefined)
				return false;

			const ignored_order = getIgnoreOrders(game, rank - state.play_stacks[suitIndex] - 1, suitIndex).find(order => order === finesse.order);
			if (ignored_order === undefined)
				return false;

			return state.hands.flat().find(c => c.order === ignored_order).matches(identity);
		});

		return [{ type: 'finesse', reacting, card: finesse, self: true, bluff: !card.possible.has(identity), possibly_bluff, identities: [identity], certain, ambiguous }];
	}

	const first_finesse = common.thoughts[our_hand.find(c => !c.clued)?.order];

	// Try to reinterpret an earlier clue as a hidden finesse
	if (allow_rewind && first_finesse?.finessed && !game.ephemeral_rewind) {
		try {
			logger.highlight('yellow', 'trying rewind on', first_finesse.order, 'to fulfill finesse');
			const new_game = game.rewind(first_finesse.drawn_index, {
				type: 'identify',
				order: first_finesse.order,
				playerIndex: state.ourPlayerIndex,
				identities: [identity]
			}, false, true);

			if (new_game) {
				new_game.ephemeral_rewind = false;

				if (new_game.moveHistory.at(-1).move !== CLUE_INTERP.NONE) {
					logger.highlight('yellow', 'successfully connected!');
					Object.assign(game, new_game);
					Utils.globalModify({ game: new_game });
					return [{ type: 'terminate', reacting: -1, card: null, identities: [] }];
				}
			}
		}
		catch (err) {
			logger.warn(err.message);
		}
	}

	throw new IllegalInterpretation('self-finesse not found');
}
