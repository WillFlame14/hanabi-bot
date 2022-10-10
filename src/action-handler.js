const { CLUE } = require('./constants.js');
const { Card } = require('./basics/Card.js');
const { good_touch_elim, remove_card_from_hand, update_hypo_stacks } = require('./basics/helper.js');
const { logger } = require('./logger.js');
const Basics = require('./basics.js');
const Utils = require('./util.js');

function handle_action(state, action, catchup = false) {
	state.actionList.push(action);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { giver, target, list, clue } = action;
			const [playerName, targetName] = [giver, target].map(index => state.playerNames[index]);
			let clue_value;

			if (clue.type === CLUE.COLOUR) {
				clue_value = ['red', 'yellow', 'green', 'blue', 'purple', 'teal'][clue.value];
			}
			else {
				clue_value = clue.value;
			}
			logger.warn(`${playerName} clues ${clue_value} to ${targetName}`);

			state.interpret_clue(state, action);
			state.last_actions[giver] = action;

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
			logger.warn(`${playerName} ${action.failed ? 'bombs' : 'discards'} ${card.toString()}`);

			Basics.onDiscard(state, action);
			state.interpret_discard(state, action, card);
			state.last_actions[playerIndex] = action;
			break;
		}
		case 'draw': {
			// { type: 'draw', playerIndex: 0, order: 2, suitIndex: 1, rank: 2 },
			Basics.onDraw(state, action);
			break;
		}
		case 'gameOver':
			logger.info('gameOver', action);
			break;
		case 'turn': {
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			const { currentPlayerIndex } = action;
			if (currentPlayerIndex === state.ourPlayerIndex && !catchup) {
				setTimeout(() => state.take_action(state), 2000);

				// Update notes on cards
				for (const card of state.hands[state.ourPlayerIndex]) {
					if (card.inferred.length <= 3) {
						Utils.writeNote(state.turn_count + 1, card, state.tableID);
					}
				}
			}

			state.update_turn(state, action);
			state.turn_count++;
			break;
		}
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			const card = Utils.findOrder(state.hands[playerIndex], order);
			const playerName = state.playerNames[playerIndex];

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			logger.warn(`${playerName} plays ${card.toString()}`);

			// If the card doesn't match any of our inferences, rewind to the reasoning and adjust
			if (!card.rewinded && playerIndex === state.ourPlayerIndex && (card.inferred.length > 1 || !card.matches_inferences())) {
				logger.info('all inferences', card.inferred.map(c => c.toString()));
				state.rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, false);
				return;
			}
			remove_card_from_hand(state.hands[playerIndex], order);

			state.play_stacks[suitIndex] = rank;

			// Apply good touch principle on remaining possibilities
			for (const hand of state.hands) {
				good_touch_elim(hand, [{suitIndex, rank}], { hard: true });
			}

			// Update hypo stacks
			update_hypo_stacks(state);

			state.last_actions[playerIndex] = action;

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
			card.inferred = [new Card(suitIndex, rank)];
			card.finessed = true;
			card.rewinded = true;
			break;
		}
		default:
			break;
	}
}

module.exports = { handle_action };
