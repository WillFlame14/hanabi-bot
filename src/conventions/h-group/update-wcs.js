import { CLUE_INTERP, LEVEL } from './h-constants.js';
import { getRealConnects, inBetween, older_queued_finesse } from './hanabi-logic.js';

import logger from '../../tools/logger.js';
import { logCard, logConnection } from '../../tools/log.js';

/**
 * @typedef {import('../h-group.js').default} Game
 * @typedef {import('../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../types.js').PlayAction} PlayAction
 * @typedef {import('../../types.js').WaitingConnection} WaitingConnection
 * @typedef {import('../../types.js').INTERP} INTERP
 */

/**
 * "Undoes" a connection by reverting/removing notes on connecting cards.
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
export function remove_finesse(game, waiting_connection) {
	const { common, state } = game;
	const { connections, focused_card, inference, symmetric } = waiting_connection;

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
				new_inferred = card.old_inferred;
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
	if (common.thoughts[focused_card.order].possible.length > 1)
		common.updateThoughts(focused_card.order, (draft) => { draft.inferred = common.thoughts[focused_card.order].inferred.subtract(inference); });

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
	const { common, state, me } = game;
	const { connections, conn_index, giver, target, inference, action_index, ambiguousPassback, selfPassback, focused_card } = waiting_connection;
	const { type, reacting, ambiguous, bluff, identities } = connections[conn_index];
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
	const old_finesse = state.deck[connections.find((conn, i) => i >= conn_index && conn.reacting === state.ourPlayerIndex && conn.type === 'finesse')?.order];

	const new_finesse_queued = old_finesse !== undefined && state.ourHand.some(o => {
		const { finessed, finesse_index } = me.thoughts[o];
		return finessed && finesse_index > me.thoughts[old_finesse.order].finesse_index;
	});

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

			if (type === 'prompt' && !/** @type {INTERP[keyof INTERP][]} */([CLUE_INTERP.PLAY, CLUE_INTERP.SAVE, CLUE_INTERP.FIX, CLUE_INTERP.CM_TRASH, CLUE_INTERP.CM_5, CLUE_INTERP.CM_TEMPO]).includes(game.lastMove)) {
				logger.warn(`allowing ${state.playerNames[reacting]} to defer a prompt by giving a useful clue`);
				return { remove: false };
			}

			if (game.level >= LEVEL.INTERMEDIATE_FINESSES && type === 'finesse' && last_reacting_action.important) {
				if (bluff) {
					logger.warn(`${state.playerNames[reacting]} not allowed to defer a potential bluff`);
				} else {
					logger.warn(`allowing ${state.playerNames[reacting]} to defer a finesse for an important clue`);
					return { remove: false };
				}
			}
		}

		if (passback()) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but they need to play multiple non-hidden cards, passing back`);
			waiting_connection.ambiguousPassback = true;
			return { remove: false };
		}

		const old_finesse = older_queued_finesse(state, reacting, common, order);

		if (game.level >= LEVEL.INTERMEDIATE_FINESSES && old_finesse !== undefined) {
			logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, but they need to play into an older finesse that could be layered`);
			return { remove: false };
		}

		// Didn't play into a self-connection
		if (!bluff && reacting === target) {
			const alternate_conn = game.common.waiting_connections.find(wc =>
				wc.focused_card.order === focused_card.order && wc.connections.every(conn => conn.order !== order));

			if (alternate_conn !== undefined) {
				logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but alternate conn [${alternate_conn.connections.map(logConnection).join(' -> ')}] exists not using this card`);
				return { remove: false };
			}

			/** @param {number} our_finesse */
			const allowable_hesitation = (our_finesse) => our_finesse !== undefined && common.thoughts[focused_card.order].inferred.find(i =>
				!i.matches(inference) && common.thoughts[our_finesse].inferred.has(i));

			if (giver !== state.ourPlayerIndex && reacting !== state.ourPlayerIndex && !inBetween(state.numPlayers, state.ourPlayerIndex, giver, reacting) && !selfPassback) {
				const our_finesse = common.find_finesse(state, state.ourPlayerIndex);
				const hesitation_possibility = allowable_hesitation(our_finesse);

				if (hesitation_possibility) {
					logger.warn(`${state.playerNames[reacting]} didn't play into ${type} but we could have ${logCard(hesitation_possibility)} on finesse position`);
					waiting_connection.selfPassback = true;
					return { remove: false };
				}
			}
		}

		if (last_reacting_action?.type === 'play') {
			const { order: reacting_order } = last_reacting_action;

			if (type === 'finesse') {
				const play = common.thoughts[reacting_order];

				if (play.finessed && play.finesse_index < common.thoughts[order].finesse_index) {
					logger.warn(`${state.playerNames[reacting]} played into older finesse ${play.finesse_index} < ${common.thoughts[order].finesse_index}, continuing to wait`);
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
				waiting_connection.selfPassback = true;
				return { remove: false };
			}
		}

		logger.warn(`${state.playerNames[reacting]} didn't play into ${type}, removing inference ${logCard(inference)}`);

		if (reacting !== state.ourPlayerIndex) {
			const real_connects = getRealConnects(connections, conn_index);
			const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: real_connects, order, inference }]);
			if (new_game) {
				Object.assign(game, new_game);
				return { quit: true };
			}
		}

		// Can't remove finesses if we allow ourselves to "defer" an ambiguous finesse the first time around.
		if (ambiguous)
			logger.warn('not removing ambiguous finesse with connections:', waiting_connection.connections.map(logConnection));

		return { remove: true, remove_finesse: !ambiguous };
	}
	else if (last_reacting_action?.type === 'discard' && !state.screamed_at && !state.generated) {
		const unplayable_identities = identities.filter(i => !state.isBasicTrash(i) && !state.isPlayable(i));
		if (type === 'positional' && unplayable_identities.length > 0) {
			logger.warn('discarded but not all possibilities playable', unplayable_identities.map(logCard));
			return { remove: false };
		}

		logger.warn(`${state.playerNames[reacting]} discarded with a waiting connection, removing inference ${logCard(inference)}`);

		const new_game = game.rewind(action_index, [{ type: 'ignore', conn_index: 0, order, inference }]);
		if (new_game) {
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
 */
export function resolve_card_played(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, inference, target, focused_card } = waiting_connection;
	const { type, reacting, identities } = connections[conn_index];

	logger.info(`waiting card ${identities.length === 1 ? logCard(identities[0]) : '(unknown)'} played`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) => index > conn_index && state.hands[conn.reacting].includes(conn.order));

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
				{ card: focused_card, inferences: [inference], connections: connections.slice(conn_index + 1) } :
				undefined;

			const only_clued_connections_left = waiting_connection.connections.every((conn, index) =>
				index < conn_index || conn.type !== 'finesse' || conn.reacting === target);

			const remove = (demonstration !== undefined && only_clued_connections_left) || waiting_connection.conn_index === -1;
			return { demonstration, remove };
		}
	}

	return { remove: waiting_connection.conn_index === -1 };
}

/**
 * @param {Game} game
 * @param {WaitingConnection} waiting_connection
 */
export function resolve_giver_play(game, waiting_connection) {
	const { common, state } = game;
	const { connections, conn_index, giver } = waiting_connection;
	const { identities, order } = connections[conn_index];

	logger.highlight('cyan', `giver ${state.playerNames[giver]} played connecting card, continuing connections`);

	// Advance waiting connection to next card that still exists
	waiting_connection.conn_index = connections.findIndex((conn, index) => index > conn_index && state.hands[conn.reacting].includes(conn.order));

	common.updateThoughts(order, (draft) => {
		// Remove finesse
		draft.inferred = common.thoughts[order].inferred.subtract(identities);

		if (draft.inferred.length === 0) {
			if (draft.old_inferred !== undefined) {
				// Restore old inferences
				draft.inferred = common.thoughts[order].old_inferred;
				draft.old_inferred = undefined;
			}
			else {
				logger.error(`no old inferences on card ${logCard(draft)} ${order} (while resolving giver play)! current inferences ${draft.inferred.map(logCard)}`);
			}
			draft.finessed = false;
		}
	});

	return { remove: waiting_connection.conn_index === -1 };
}
