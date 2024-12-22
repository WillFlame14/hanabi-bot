import { BOT_VERSION } from './constants.js';
import { team_elim } from './basics/helper.js';
import * as Basics from './basics.js';
import * as Utils from './tools/util.js';

import logger from './tools/logger.js';
import { logAction, logCard } from './tools/log.js';

import { produce } from './StateProxy.js';

/**
 * @typedef {import('./types.js').Action} Action
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} CardAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 * @typedef {import('./basics/Game.js').Game} Game
 */

/**
 * Impure!
 * @this Game
 * @param {Action} 	action
 */
export function handle_action(action) {
	const { state } = this;
	state.actionList.push(action);

	if (action.type === 'clue' && action.giver === state.ourPlayerIndex)
		this.handHistory[state.turn_count] = Utils.objClone(state.ourHand);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { giver, list } = action;
			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			this.interpret_clue(this, action);
			this.last_actions[giver] = action;

			state.dda = undefined;
			state.screamed_at = false;
			state.generated = false;

			// Remove the newly_clued flag
			for (const order of list) {
				state.deck = state.deck.with(order, produce(state.deck[order], draft => { draft.newly_clued = false; }));
				for (const player of this.allPlayers)
					player.updateThoughts(order, (draft) => { draft.newly_clued = false; });
			}

			// Clear the list of ignored cards
			this.next_ignore = [];
			this.next_finesse = [];
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { order, playerIndex, rank, suitIndex } = action;
			const card = state.deck[order];

			if (card.identity() === undefined)
				state.deck = state.deck.with(order, produce(card, Utils.assignId({ suitIndex, rank })));
			this.players[playerIndex].updateThoughts(order, Utils.assignId({ suitIndex, rank }));

			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			// Assume one cannot SDCM after being screamed at
			state.dda = undefined;
			state.screamed_at = false;
			state.generated = false;

			this.interpret_discard(this, action);
			this.last_actions[playerIndex] = action;
			break;
		}
		case 'draw': {
			// { type: 'draw', playerIndex: 0, order: 2, suitIndex: 1, rank: 2 },
			Basics.onDraw(this, action);
			break;
		}
		case 'gameOver': {
			logger.highlight('redb', logAction(action));
			this.in_progress = false;
			break;
		}
		case 'turn': {
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			const { currentPlayerIndex, num } = action;
			state.currentPlayerIndex = currentPlayerIndex;
			state.turn_count = num + 1;

			if (state.turn_count == 2 && this.notes[0] === undefined && !this.catchup && this.in_progress) {
				const note = `[INFO: v${BOT_VERSION}, ${this.convention_name + (/** @type {any} */(this).level ?? '')}]`;

				Utils.sendCmd('note', { tableID: this.tableID, order: 0, note });
				this.notes[0] = { last: note, turn: 0, full: note };
			}

			this.updateNotes();
			this.update_turn(this, action);
			break;
		}
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			const card = state.deck[order];

			if (card.identity() === undefined)
				state.deck = state.deck.with(order, produce(card, Utils.assignId({ suitIndex, rank })));
			this.players[playerIndex].updateThoughts(order, Utils.assignId({ suitIndex, rank }));

			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			this.interpret_play(this, action);
			this.last_actions[playerIndex] = action;
			state.dda = undefined;
			state.screamed_at = false;
			break;
		}
		case 'identify': {
			const { order, playerIndex, identities, infer = false } = action;

			if (!state.hands[playerIndex].includes(order))
				throw new Error('Could not find card to rewrite!');

			logger.info(`identifying card with order ${order} as ${identities.map(logCard)}, infer? ${infer}`);

			this.common.updateThoughts(order, (draft) => {
				draft.rewinded = true;
				if (infer) {
					draft.inferred = this.common.thoughts[order].inferred.intersect(identities);
				}
				else {
					if (identities.length === 1) {
						draft.suitIndex = identities[0].suitIndex;
						draft.rank = identities[0].rank;
					}
					else {
						draft.rewind_ids = identities;
					}
				}
			});

			if (!infer && identities.length === 1) {
				const { suitIndex, rank } = identities[0];
				this.me.updateThoughts(order, Utils.assignId({ suitIndex, rank }));
				state.deck = state.deck.with(order, produce(state.deck[order], Utils.assignId({ suitIndex, rank })));
			}
			team_elim(this);
			break;
		}
		case 'ignore': {
			const { conn_index, order, inference } = action;

			this.next_ignore[conn_index] ??= [];

			// Ignore the card
			this.next_ignore[conn_index].push({ order, inference });
			break;
		}
		case 'finesse':  {
			const { list, clue } = action;
			this.next_finesse.push({ list, clue });
			break;
		}
		default:
			break;
	}
}
