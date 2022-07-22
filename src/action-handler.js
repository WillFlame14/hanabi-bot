const { Card } = require('./basics/Card.js')
const { CLUE, good_touch_elim, remove_card_from_hand, update_hypo_stacks } = require('./basics/helper.js');
const { LEVELS, logger } = require('./logger.js');
const Basics = require('./basics.js')
const Utils = require('./util.js');

let rewind_depth = 0;

function handle_action(state, action, tableID, catchup = false) {
	state.actionList.push(action);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { giver, target, list, clue } = action;

			const playerName = state.playerNames[giver];
			const targetName = state.playerNames[target];
			let clue_value;

			if (clue.type === CLUE.COLOUR) {
				clue_value = ['red', 'yellow', 'green', 'blue', 'purple'][clue.value];
			}
			else {
				clue_value = clue.value;
			}
			logger.info(`${playerName} clues ${clue_value} to ${targetName}`);

			action.mistake = action.mistake || false;
			Basics.onClue(state, action);
			state.interpret_clue(state, action);

			// Remove the newly_clued flag
			for (const order of list) {
				const card = Utils.findOrder(state.hands[target], order);
				card.newly_clued = false;
			}
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { order, playerIndex, rank, suitIndex } = action;
			const card = Utils.findOrder(state.hands[playerIndex], order);
			const playerName = state.playerNames[action.playerIndex];

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			logger.info(`${playerName} ${action.failed ? 'bombs' : 'discards'} ${card.toString()}`);

			Basics.onDiscard(state, action);

			// If the card doesn't match any of our inferences, rewind to the reasoning and adjust
			if (!card.rewinded && card.inferred.length > 0 && !card.inferred.some(c => c.matches(suitIndex, rank))) {
				logger.info('all inferences', card.inferred.map(c => c.toString()));
				rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, true, tableID);
				return;
			}

			// Discarding a useful card (for whatever reason)
			if (state.hypo_stacks[suitIndex] >= rank && state.play_stacks[suitIndex] < rank) {
				const duplicates = Utils.visibleFind(state, playerIndex, suitIndex, rank);

				// Mistake discard or sarcastic discard (but unknown transfer location)
				if (duplicates.length === 0 || duplicates[0].inferred.length > 1) {
					logger.info(`${state.playerNames[playerIndex]} discarded useful card ${card.toString()}, setting hypo stack ${rank - 1}`);
					state.hypo_stacks[suitIndex] = rank - 1;
				}
			}
			break;
		}
		case 'draw': {
			// { type: 'draw', playerIndex: 0, order: 2, suitIndex: 1, rank: 2 },
			Basics.onDraw(state, action);
			break;
		}
		case 'gameOver':
			logger.info('gameOver', action);
			Utils.sendCmd('tableUnattend', { tableID });
			break;
		case 'turn':
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			if (action.currentPlayerIndex === state.ourPlayerIndex && !catchup) {
				setTimeout(() => state.take_action(state, tableID), 2000);

				// Update notes on cards
				for (const card of state.hands[state.ourPlayerIndex]) {
					if (card.inferred.length < 5) {
						setTimeout(() => Utils.writeNote(card, tableID), Math.random() * 5000);
					}
				}
			}
			state.turn_count++;
			break;
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			const card = Utils.findOrder(state.hands[playerIndex], order);
			const playerName = state.playerNames[playerIndex];

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			logger.info(`${playerName} plays ${card.toString()}`);

			// If the card doesn't match any of our inferences, rewind to the reasoning and adjust
			if (!card.rewinded && !card.inferred.some(c => c.matches(suitIndex, rank))) {
				logger.info('all inferences', card.inferred.map(c => c.toString()));
				rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, false, tableID);
				return;
			}
			remove_card_from_hand(state.hands[playerIndex], order);

			state.play_stacks[suitIndex] = rank;

			// Apply good touch principle on remaining possibilities
			for (const hand of state.hands) {
				good_touch_elim(hand, [{suitIndex, rank}]);
			}

			// Update hypo stacks
			logger.debug('updating hypo stack (play)');
			update_hypo_stacks(state, playerIndex, suitIndex, rank);

			// Get a clue token back for playing a 5
			if (rank === 5 && state.clue_tokens < 8) {
				state.clue_tokens++;
			}
			break;
		}
		case 'rewind': {
			const { order, playerIndex, suitIndex, rank } = action;

			const card = Utils.findOrder(state.hands[playerIndex], order);
			if (card === undefined) {
				throw new Error('Could not find card to rewrite!');
			}
			card.possible = [new Card(suitIndex, rank)];
			card.finessed = true;
			card.rewinded = true;
			break;
		}
		default:
			break;
	}
}

function rewind(state, action_index, playerIndex, order, suitIndex, rank, bomb, tableID) {
	if (rewind_depth > 2) {
		throw new Error('attempted to rewind too many times!');
	}
	rewind_depth++;

	logger.info(`expected ${Utils.logCard(suitIndex, rank)}, rewinding to action_index ${action_index}`);
	const new_state = Utils.objClone(state.blank);
	new_state.blank = Utils.objClone(new_state);
	const history = state.actionList.slice(0, action_index);

	logger.setLevel(LEVELS.WARN);

	// Get up to speed
	for (const action of history) {
		handle_action(new_state, action, tableID, true);
	}

	logger.setLevel(LEVELS.INFO);

	// Rewrite and save as a rewind action
	const known_action = { type: 'rewind', order, playerIndex, suitIndex, rank };
	handle_action(new_state, known_action, tableID, true);
	logger.warn('Rewriting order', order, 'to', Utils.logCard(suitIndex, rank));

	const pivotal_action = state.actionList[action_index];
	pivotal_action.mistake = bomb || rewind_depth > 1;
	logger.info('pivotal action', pivotal_action);
	handle_action(new_state, pivotal_action, tableID, true);

	// Redo all the following actions
	const future = state.actionList.slice(action_index + 1);
	for (const action of future) {
		handle_action(new_state, action, tableID, true);
	}

	// Overwrite state
	Object.assign(state, new_state);
	rewind_depth = 0;
}

module.exports = { handle_action };
