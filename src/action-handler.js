import * as Basics from './basics.js';
import logger from './tools/logger.js';
import { logAction, logCard, logPerformAction } from './tools/log.js';
import * as Utils from './tools/util.js';
import { team_elim } from './basics/helper.js';

/**
 * @typedef {import('./types.js').Action} Action
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} CardAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 * @typedef {import('./basics/Game.js').Game} Game
 */

/**
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
			const { giver, target, list } = action;
			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			this.interpret_clue(this, action);
			this.last_actions[giver] = action;

			state.dda = undefined;
			state.screamed_at = false;
			state.generated = false;

			// Remove the newly_clued flag
			for (const order of list) {
				const card = state.hands[target].findOrder(order);
				card.newly_clued = false;
			}

			// Clear the list of ignored cards
			this.next_ignore = [];
			this.next_finesse = [];
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { order, playerIndex, rank, suitIndex } = action;
			const card = state.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			Object.assign(this.players[playerIndex].thoughts[order], {suitIndex, rank});

			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			// Assume one cannot SDCM after being screamed at
			state.dda = undefined;
			state.screamed_at = false;
			state.generated = false;

			this.interpret_discard(this, action, card);
			this.last_actions[playerIndex] = Object.assign(action, { card });
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

			if (!state.options.speedrun) {
				// Update notes on cards
				for (const { order } of state.hands.flat()) {
					const card = this.common.thoughts[order];
					if (card.saved || card.called_to_discard) {
						const note = card.getNote();

						if (this.notes[order] === undefined)
							this.notes[order] = { last: '', turn: 0, full: '' };

						// Only write a new note if it's different from the last note and is a later turn
						if (note !== this.notes[order].last && state.turn_count > this.notes[order].turn) {
							this.notes[order].last = note;
							this.notes[order].turn = state.turn_count;

							if (this.notes[order].full !== '')
								this.notes[order].full += ' | ';

							this.notes[order].full += `t${state.turn_count}: ${note}`;

							if (!this.catchup && this.in_progress)
								Utils.sendCmd('note', { tableID: this.tableID, order, note: this.notes[order].full });
						}
					}
				}
			}

			this.update_turn(this, action);

			if (currentPlayerIndex === state.ourPlayerIndex && !this.catchup) {
				if (this.in_progress) {
					if (Utils.globals.manual === undefined)
						setTimeout(() => Utils.sendCmd('action', this.take_action(this)), state.options.speedrun ? 0 : 2000);
				}
				// Replaying a turn
				else {
					const suggested_action = this.take_action(this);
					logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action));
				}
			}
			break;
		}
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			const card = state.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			Object.assign(this.players[playerIndex].thoughts[order], {suitIndex, rank});

			logger.highlight('yellowb', `Turn ${state.turn_count}: ${logAction(action)}`);

			this.interpret_play(this, action);
			this.last_actions[playerIndex] = Object.assign(action, { card });
			state.dda = undefined;
			state.screamed_at = false;
			break;
		}
		case 'identify': {
			const { order, playerIndex, identities, infer = false } = action;
			const card = this.common.thoughts[order];

			if (state.hands[playerIndex].findOrder(order) === undefined)
				throw new Error('Could not find card to rewrite!');

			logger.info(`identifying card with order ${order} as ${identities.map(logCard)}, infer? ${infer}`);

			if (!infer) {
				if (identities.length === 1) {
					Object.assign(card, identities[0]);
					Object.assign(this.me.thoughts[order], identities[0]);
					Object.assign(state.hands[playerIndex].findOrder(order), identities[0]);
					Object.assign(state.deck[order], identities[0]);
				}
				else {
					card.rewind_ids = identities;
				}
			}
			else {
				card.inferred = card.inferred.intersect(identities);
			}
			card.rewinded = true;
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
