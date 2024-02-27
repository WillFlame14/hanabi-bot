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
 * @typedef {import('./basics/State.js').State} State
 */

/**
 * @this State
 * @param {Action} 	action
 * @param {boolean} [catchup]	Whether the bot should take an action or not as a result of this action.
 */
export function handle_action(action, catchup = false) {
	this.actionList.push(action);

	if (['clue', 'discard', 'play'].includes(action.type))
		this.handHistory[this.turn_count] = Utils.objClone(this.hands[this.ourPlayerIndex]);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { giver, target, list } = action;
			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

			this.interpret_clue(this, action);
			this.last_actions[giver] = action;

			// Remove the newly_clued flag
			for (const order of list) {
				const card = this.hands[target].findOrder(order);
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
			const card = this.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			Object.assign(this.players[playerIndex].thoughts[order], {suitIndex, rank});

			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

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
			this.currentPlayerIndex = currentPlayerIndex;
			this.turn_count = num + 1;

			if (!catchup && !this.options.speedrun) {
				// Update notes on cards
				for (const { order } of this.hands.flat()) {
					const card = this.common.thoughts[order];
					if (card.saved || card.called_to_discard) {
						const note = card.getNote();

						if (this.notes[order] === undefined)
							this.notes[order] = { last: '', turn: 0, full: '' };

						// Only write a new note if it's different from the last note and is a later turn
						if (note !== this.notes[order].last && this.turn_count > this.notes[order].turn) {
							this.notes[order].last = note;
							this.notes[order].turn = this.turn_count;

							if (this.notes[order].full !== '')
								this.notes[order].full += ' | ';

							this.notes[order].full += `t${this.turn_count}: ${note}`;

							if (this.in_progress)
								Utils.sendCmd('note', { tableID: this.tableID, order, note: this.notes[order].full });
						}
					}
				}
			}

			this.update_turn(this, action);

			if (currentPlayerIndex === this.ourPlayerIndex && !catchup) {
				if (this.in_progress) {
					setTimeout(() => Utils.sendCmd('action', this.take_action(this)), this.options.speedrun ? 0 : 2000);
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
			const card = this.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			Object.assign(this.players[playerIndex].thoughts[order], {suitIndex, rank});

			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

			this.interpret_play(this, action);
			this.last_actions[playerIndex] = Object.assign(action, { card });
			break;
		}
		case 'identify': {
			const { order, playerIndex, suitIndex, rank, infer = false } = action;
			const card = this.common.thoughts[order];

			if (this.hands[playerIndex].findOrder(order) === undefined)
				throw new Error('Could not find card to rewrite!');

			logger.info(`identifying card with order ${order} as ${logCard({ suitIndex, rank })}, infer? ${infer}`);

			if (!infer) {
				Object.assign(card, { suitIndex, rank });
				Object.assign(this.me.thoughts[order], { suitIndex, rank });
				Object.assign(this.hands[playerIndex].findOrder(order), { suitIndex, rank });
			}
			else {
				card.intersect('inferred', [{ suitIndex, rank }]);
			}
			card.rewinded = true;
			team_elim(this);
			break;
		}
		case 'ignore': {
			const { playerIndex, conn_index, order } = action;

			this.next_ignore[conn_index] ??= [];

			// Ignore the card and all cards older than it
			for (const card of this.hands[playerIndex]) {
				if (card.order <= order)
					this.next_ignore[conn_index].push(card.order);
			}
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
