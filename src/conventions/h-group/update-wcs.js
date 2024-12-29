import { CLUE_INTERP, LEVEL } from './h-constants.js';
import { getRealConnects, inBetween, older_queued_finesse } from './hanabi-logic.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').PlayAction} PlayAction
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 * @typedef {import('../../types.js').Demonstration} Demonstration
 * @typedef {import('../../types.js').INTERP} INTERP
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * 
 * Impure! (modifies common)
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
export function remove_finesse(game, waiting_connection) {
	const { common, state } = game;
	const { connections, focus, inference, symmetric } = waiting_connection;

	// Remove remaining finesses
	for (const connection of connections) {
		const card = common.thoughts[connection.order];

		// Notes are not written on symmetric connections. Thus, no need to remove finesses
		if (symmetric)
			continue;

		let new_inferred = card.inferred;

		if (connection.type === 'finesse' || connection.type === 'prompt') {
			if (card.hidden)
				new_inferred = card.inferred.intersect([]);
			else
				new_inferred = card.inferred.subtract(connection.identities);
		}

		const card_reset = !card.superposition && new_inferred.length === 0;

		if (card_reset) {
			if (card.old_inferred !== undefined)
				new_inferred = card.old_inferred.intersect(card.possible);
			else
				logger.error(`no old inferences on card ${logCard(card)} ${connection.order} (while removing finesse)! current inferences ${card.inferred.map(logCard)}`);
		}

		common.updateThoughts(connection.order, (draft) => {
			draft.inferred = new_inferred;

			if (card_reset) {
				draft.finessed = false;
				draft.hidden = false;

				if (draft.old_inferred !== undefined) {
					// Don't try to restore old inferences again
					draft.superposition = true;
					draft.old_inferred = undefined;
				}
			}
		});
	}

	// Remove inference (if possible)
	if (common.thoughts[focus].possible.length > 1)
		common.updateThoughts(focus, (draft) => { draft.inferred = common.thoughts[focus].inferred.subtract(inference); });

	if (common.thoughts[focus].inferred.length === 0 && !common.thoughts[focus].reset)
		common.thoughts[focus] = common.reset_card(focus);

	common.update_hypo_stacks(state);
}

/**
 * @param {Game} game
 * @param {number} reacting
 * @param {number} order
 * @param {WaitingConnection} waiting_connection
 * @param {{played: boolean}} options
 */
function stomped_finesse(game, reacting, order, waiting_connection, options) {
	const { common, state } = game;
	const thoughts = common.thoughts[order];
	const possibilities = options.played ? thoughts.old_possible : thoughts.possible;

	return thoughts.clued && thoughts.clues.at(-1).turn > waiting_connection.turn && (thoughts.focused ||
		(common.thinksPlayables(state, reacting).length === 0 &&
			possibilities.every(i => state.isPlayable(i) || thoughts.matches(i, { assume: true }) || state.isBasicTrash(i))));
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
export function resolve_card_retained(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, giver, target, inference, action_index, ambiguousPassback, selfPassback, focus, symmetric } = waiting_connection;
	const { type, reacting, bluff, possibly_bluff, identities } = connections[conn_index];
	const { order } = connections[conn_index];

	// Card may have been updated, so need to find it again
	const card = state.deck[order];

	// Determines if we need to pass back an ambiguous finesse.
	const passback = () => {
		const non_hidden_connections = connections.filter((conn, index) =>
			index >= conn_index && !conn.hidden && conn.reacting === reacting && conn.type === 'finesse');

		return reacting !== state.ourPlayerIndex && 	// can't pass back to ourselves
			non_hidden_connections.length > 1 &&		// they need to play more than 1 card
			non_hidden_connections.length === inference.rank - state.play_stacks[inference.suitIndex] - 1 && 	// they have all the required cards
			!ambiguousPassback;							// haven't already tried to pass back
	};

	const last_reacting_action = game.last_actions[reacting];
	const new_finesse_queued = connections.slice(conn_index).find(conn =>
		conn.type === 'finesse' && state.hands[conn.reacting].some(o => {
			const { inferred, finessed, finesse_index } = common.thoughts[o];

			// A newer finesse exists on this player that is not part of the same suit.
			return finessed && finesse_index > common.thoughts[conn.order].finesse_index && !inferred.some(i => i.suitIndex === conn.identities[0].suitIndex);
		}));

	// Didn't play into finesse
	if (type === 'finesse' || type === 'prompt' || new_finesse_queued) {
		if (card.suitIndex !== -1 && state.play_stacks[card.suitIndex] + 1 < card.rank) {
			logger.warn(`${state.playerNames[reacting]} didn't play into unplayable ${type}`);
			return { remove: false };
		}

		if (last_reacting_action?.type === 'clue') {
			// TODO: Maybe it's good to force demonstrating the connection immediately anyways; this can be confusing.
			if (stomped_finesse(game, reacting, order, waiting_connection, { played: false })) {
				logger.warn(`finesse was stomped on, ${state.playerNames[reacting]} no longer needs to demonstrate connection immediately`);
				return { remove: false };
			}

			if (type === 'prompt' && /** @type {INTERP[keyof INTERP][]} */([CLUE_INTERP.PLAY, CLUE_INTERP.SAVE, CLUE_INTERP.FIX, CLUE_INTERP.CM_TRASH, CLUE_INTERP.CM_5, CLUE_INTERP.CM_TEMPO]).includes(game.lastMove)) {
				logger.warn(`allowing ${state.playerNames[reacting]} to defer a prompt by giving a useful clue`);
				return { remove: false };
			}

			if (game.level >= LEVEL.INTERMEDIATE_FINESSES && last_reacting_action.important) {
				if (bluff || possibly_bluff) {
					logger.warn(`${state.playerNames[reacting]} not allowed to defer a potential bluff`);
				} else {
					logger.warn(`allowing ${state.playerNames[reacting]} to defer a finesse for an important clue`);
					return { remove: false };
				}
			}
		}

		if (passback()) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but they need to play multiple non-hidden cards, passing back`);
			return { remove: false, ambiguousPassback: true };
		}

		const old_finesse = older_queued_finesse(state, reacting, common, order);

		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && old_finesse !== undefined) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, but they need to play into an older finesse that could be layered`);
			return { remove: false };
		}

		// Didn't play into a self-connection
		if (!bluff && (reacting === target || reacting === state.ourPlayerIndex)) {
			const alternate_conn = common.waiting_connections.find(wc =>
				wc.focus === focus && wc.connections.every(conn => conn.order !== order));

			if (alternate_conn !== undefined) {
				logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but alternate conn [${alternate_conn.connections.map(logConnection).join(' -> ')}] exists not using this card`);
				return { remove: false };
			}

			if (!selfPassback) {
				// Find all waiting connections using this order and merge their possible identities
				const linked_ids = common.waiting_connections.filter(wc => wc.focus === focus).flatMap(wc => wc.connections.find((conn, i) => i >= wc.conn_index && conn.order === order)?.identities);

				/** @param {number} finesse */
				const allowable_hesitation = (finesse) => {
					if (finesse === undefined)
						return undefined;

					// Returns an identity that the player could be hesitating for on the given finesse order, if it exists.
					const id = state.deck[finesse].identity();
					return linked_ids.find(i => (id === undefined) ? common.thoughts[finesse].inferred.has(i) : id.matches(i));
				};

				for (let playerIndex = state.nextPlayerIndex(reacting); playerIndex != giver; playerIndex = state.nextPlayerIndex(playerIndex)) {
					const finesse = common.find_finesse(state, playerIndex);
					const hesitation_poss = allowable_hesitation(finesse);

					if (hesitation_poss) {
						logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but allowable hesitation on ${state.playerNames[playerIndex]} ${logCard(hesitation_poss)}`);
						return { remove: false, selfPassback: true };
					}
				}
			}
		}

		if (last_reacting_action?.type === 'play') {
			const { order: reacting_order } = last_reacting_action;

			if (type === 'finesse') {
				const play = common.thoughts[reacting_order];
				const expected_play = common.thoughts[order];

				if (play.finessed && play.finesse_index < expected_play.finesse_index) {
					logger.warn(`${state.playerNames[reacting]} played into older finesse ${play.finesse_index} < ${expected_play.finesse_index}, continuing to wait`);
					return { remove: false };
				}

				if (play.finessed && expected_play.hidden && expected_play.clued && play.finesse_index === expected_play.finesse_index) {
					logger.warn(`${state.playerNames[reacting]} jumped ahead in layered finesse, continuing to wait`);
					return { remove: false };
				}
			}
			else if (type === 'prompt') {
				logger.warn(`${state.playerNames[reacting]} played into something else, continuing to wait`);
				return { remove: false };
			}
		}

		// Check if the card could be superpositioned on a finesse that is not yet playable.
		const unplayable_connections = common.waiting_connections.filter(wc =>
			wc.conn_index !== -1 &&
			wc !== waiting_connection &&
			wc.connections.some((conn, index) =>
				index >= conn_index && conn.order === order && conn.identities.some(i => state.playableAway(i) > 0)) &&
			// The reacting player has to wait for someone else, or they already tried to play
			(wc.connections[wc.conn_index].reacting !== reacting || last_reacting_action?.type === 'play'));

		if (unplayable_connections.length > 0) {
			logger.warn(last_reacting_action?.type, 'but not all possibilities playable', unplayable_connections.map(wc =>
				`${wc.connections.map(logConnection).join(' -> ')}  (${wc.connections.find((conn, index) =>
					index >= conn_index && conn.order === order && conn.identities.some(i => state.playableAway(i) > 0)
				).identities.map(logCard).join()})`));
			return { remove: false };
		}

		const attempted_bomb = last_reacting_action?.type === 'discard' && last_reacting_action.failed &&
			identities.some(i => game.players[reacting].thoughts[last_reacting_action.order].possible.has(i));

		if (attempted_bomb) {
			logger.warn(`${state.playerNames[reacting]} bombed, maybe tried to play into it`);
			return { remove: false };
		}

		// We're not playing in a rewind
		if (!bluff && reacting === state.ourPlayerIndex && game.catchup && !inBetween(state.numPlayers, state.ourPlayerIndex, giver, target)) {
			const self_delay = state.deck[common.find_finesse(state, target)]?.matches(identities[0]);

			if (self_delay && !selfPassback) {
				logger.warn('delaying for potential self-finesse');
				return { remove: false, selfPassback: true };
			}
		}

		if (!bluff && reacting === state.ourPlayerIndex && common.thoughts[order].rewinded) {
			logger.highlight('cyan', 'allowing us to delay into a rewinded finesse');
			return { remove: false, remove_finesse: false };
		}

		if (type === 'prompt' && last_reacting_action?.type === 'discard' && last_reacting_action.intentional) {
			logger.highlight('cyan', 'allowing delaying a prompt for an intentional discard');
			return { remove: false };
		}

		logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, removing inference ${logCard(inference)}`);

		// Don't rewind if this is a symmetric connection that doesn't involve us
		if (reacting !== state.ourPlayerIndex && !(symmetric && connections.every((conn, i) => i < conn_index || conn.reacting !== state.ourPlayerIndex))) {
			const real_connects = getRealConnects(connections, conn_index);
			const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: real_connects, order, inference }]);
			if (new_game) {
				new_game.updateNotes();
				Object.assign(game, new_game);
				return { quit: true };
			}
		}

		return { remove: true, remove_finesse: true };
	}
	else if (last_reacting_action?.type === 'discard' && !last_reacting_action.intentional && !state.screamed_at && !state.generated) {
		const unplayable_identities = identities.filter(i => !state.isBasicTrash(i) && !state.isPlayable(i));
		if (unplayable_identities.length > 0) {
			logger.warn('discarded but not all possibilities playable', unplayable_identities.map(logCard));
			return { remove: false };
		}

		logger.warn(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);

		const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: 0, order, inference }]);
		if (new_game) {
			new_game.updateNotes();
			Object.assign(game, new_game);
			return { quit: true };
		}
		return { remove: true, remove_finesse: true };
	}
	return { remove: false };
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 * @returns {{ remove: boolean, remove_finesse?: boolean, next_index?: number, demonstration?: Demonstration }}
 */
export function resolve_card_played(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, inference, target, focus } = waiting_connection;
	const { type, reacting, identities } = connections[conn_index];

	logger.info(`waiting card ${identities.length === 1 ? logCard(identities[0]) : '(unknown)'} played`);

	// Advance waiting connection to next card that still exists
	const next_index = connections.findIndex((conn, index) => index > conn_index && state.hands[conn.reacting].includes(conn.order));

	if (type === 'finesse' || type === 'prompt') {
		// Finesses demonstrate that a card must be playable and not save
		const order = /** @type {PlayAction} */(game.last_actions[reacting]).order;
		const thoughts = common.thoughts[order];

		// Consider a stomped finesse if the played card was focused or they didn't choose to play it first
		if (type === 'finesse' && stomped_finesse(game, reacting, order, waiting_connection, { played: true })) {
			logger.warn(`connecting card was focused/known playable with a clue (stomped on), not confirming ${logCard(inference)} finesse`);

			if (connections[conn_index + 1]?.self) {
				logger.warn(`connection requires that we blind play, removing due to occam's razor`);
				return { remove: true, remove_finesse: true };
			}
		}
		else if (type === 'prompt' && thoughts.old_possible.length === 1) {
			logger.warn('connecting card was filled in completely, not confirming prompt');
		}
		else {
			// Should prompts demonstrate connections? Sometimes acting on asymmetric info can look like a prompt.
			const demonstration = (type === 'finesse' || game.level < LEVEL.INTERMEDIATE_FINESSES) ?
				{ order: focus, inference, connections: connections.slice(conn_index + 1) } :
				undefined;

			const only_clued_connections_left = waiting_connection.connections.every((conn, index) =>
				index < next_index || conn.type !== 'finesse' || conn.reacting === target);

			const remove = (demonstration !== undefined && only_clued_connections_left) || next_index === -1;
			return { demonstration, remove, next_index };
		}
	}

	return { remove: next_index === -1, next_index };
}

/**
 * Fixes a waiting connection after someone else plays a connecting card.
 * 
 * Impure! (modifies common)
 * @param {Game} game
 * @param {number} playerIndex
 * @param {WaitingConnection} waiting_connection
 */
export function resolve_other_play(game, playerIndex, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, inference, focus } = waiting_connection;
	const { type, identities, order } = connections[conn_index];

	logger.highlight('cyan', `${state.playerNames[playerIndex]} played connecting card, continuing connections`);

	// Advance waiting connection to next card that still exists
	const next_index = connections.findIndex((conn, index) => index > conn_index && state.hands[conn.reacting].includes(conn.order));

	const card = common.thoughts[order];
	common.updateThoughts(order, (draft) => {
		// Remove finesse
		draft.inferred = card.inferred.subtract(identities);

		if (draft.inferred.length === 0) {
			if (draft.old_inferred !== undefined) {
				// Restore old inferences
				draft.inferred = card.old_inferred.intersect(card.possible);
				draft.old_inferred = undefined;
			}
			else {
				logger.error(`no old inferences on card ${logCard(draft)} ${order} (while resolving other play)! current inferences ${draft.inferred.map(logCard)}`);
			}
			draft.finessed = false;
		}
	});

	const demonstration = (type === 'finesse' || game.level < LEVEL.INTERMEDIATE_FINESSES) ?
		{ order: focus, inference, connections: connections.slice(conn_index + 1) } :
		undefined;

	return { demonstration, remove: next_index === -1, next_index };
}
