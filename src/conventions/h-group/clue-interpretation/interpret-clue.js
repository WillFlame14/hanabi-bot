import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { Card } from '../../../basics/Card.js';
import { interpret_tcm, interpret_5cm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { find_own_finesses } from './connecting-cards.js';
import { bad_touch_possibilities, update_hypo_stacks, good_touch_elim } from '../../../basics/helper.js';
import { isBasicTrash, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';
import { cardCount } from '../../../variants.js';
import logger from '../../../logger.js';
import * as Basics from '../../../basics.js';
import * as Utils from '../../../util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 */

/**
 * Given a clue, recursively applies good touch principle to the target's hand.
 * @param {State} state
 * @param {ClueAction} action
 * @returns {boolean} Whether the clue was a fix clue or not.
 */
function apply_good_touch(state, action) {
	const { giver, list, target } = action;
	let fix = false;

	// Keep track of all cards that previously had inferences (i.e. not known trash)
	const had_inferences = state.hands[target].filter(card => card.inferred.length > 0).map(card => card.order);

	Basics.onClue(state, action);

	// Touched cards should also obey good touch principle
	let bad_touch = bad_touch_possibilities(state, giver, target);
	let bad_touch_len;

	// Recursively deduce information until no new information is learned
	do {
		bad_touch_len = bad_touch.length;
		for (const card of state.hands[target]) {
			if (card.inferred.length > 1 && (card.clued || card.chop_moved)) {
				card.subtract('inferred', bad_touch);
			}

			// Check for fix on retouched cards
			if (list.includes(card.order) && !card.newly_clued) {
				// Lost all inferences, revert to good touch principle (must not have been known trash)
				if (card.inferred.length === 0 && had_inferences.includes(card.order) && !card.reset) {
					fix = true;
					card.inferred = Utils.objClone(card.possible);
					card.subtract('inferred', bad_touch);
					card.reset = true;
					continue;
				}
				// Directly revealing a duplicated card in someone else's hand (if we're using an inference, the card must match the inference, unless it's unknown)
				else if (card.possible.length === 1) {
					const { suitIndex, rank } = card.possible[0];

					// The fix can be in anyone's hand except the giver's
					fix = state.hands.some((hand, index) =>
						index !== giver && hand.some(c => (c.clued || c.finessed) && c.matches(suitIndex, rank, { infer: true }) && c.order !== card.order)
					);
				}
			}
		}
		bad_touch = bad_touch_possibilities(state, giver, target, bad_touch);
	}
	while (bad_touch_len !== bad_touch.length);

	logger.debug('bad touch', bad_touch.map(c => Utils.logCard(c)).join(','));
	return fix;
}

/**
 * Interprets the given clue. First tries to look for inferred connecting cards, then attempts to find prompts/finesses.
 * @param {State} state
 * @param {ClueAction} action
 */
export function interpret_clue(state, action) {
	const { clue, giver, list, target, mistake = false, ignoreStall = false } = action;
	const fix = apply_good_touch(state, action);

	const { focused_card, chop } = determine_focus(state.hands[target], list);

	if (chop) {
		focused_card.chop_when_first_clued = true;
	}

	if (focused_card.inferred.length === 0) {
		focused_card.inferred = Utils.objClone(focused_card.possible);
		logger.warn('focused card had no inferences after applying good touch');
	}

	logger.debug('pre-inferences', focused_card.inferred.map(c => Utils.logCard(c)).join());

	if ((state.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focused_card.inferred.length === 1) {
			const { suitIndex, rank } = focused_card.inferred[0];
			update_hypo_stacks(state);
			team_elim(state, focused_card, giver, target, suitIndex, rank);
		}
		return;
	}

	// Check if the giver was in a stalling situation
	if (!ignoreStall && stalling_situation(state, action)) {
		logger.info('stalling situation');
		update_hypo_stacks(state);
		return;
	}

	// Check for chop moves at level 4+
	if (state.level >= LEVEL.BASIC_CM) {
		// Trash chop move
		if (focused_card.newly_clued &&
			focused_card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank, focused_card.order, { infer: false })) &&
			!(focused_card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0))
		) {
			interpret_tcm(state, target);
			return;
		}
		// 5's chop move - for now, 5cm cannot be done in early game.
		else if (clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !state.early_game) {
			if (interpret_5cm(state, target)) {
				return;
			}
		}
	}

	const focus_possible = find_focus_possible(state, action);
	logger.info(`focus possible: [${focus_possible.map(p => Utils.logCard(p)).join(',')}]`);

	const matched_inferences = focus_possible.filter(p => focused_card.inferred.some(c => c.matches(p.suitIndex, p.rank)));
	const matched_correct = target === state.ourPlayerIndex || matched_inferences.some(p => focused_card.matches(p.suitIndex, p.rank));

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_correct) {
		focused_card.intersect('inferred', focus_possible);

		for (const inference of matched_inferences) {
			const { suitIndex, rank, connections, save = false } = inference;

			if (!save) {
				if ((target === state.ourPlayerIndex || focused_card.matches(suitIndex, rank))) {
					assign_connections(state, connections, suitIndex);
				}

				// Only one inference, we can update hypo stacks
				if (matched_inferences.length === 1 && (connections.length === 0 || !['prompt', 'finesse'].includes(connections[0].type))) {
					team_elim(state, focused_card, giver, target, suitIndex, rank);
				}
				// Multiple inferences, we need to wait for connections
				else if (connections.length > 0/* && !connections[0].self*/) {
					state.waiting_connections.push({ connections, focused_card, inference: { suitIndex, rank } });
				}
			}
		}
	}
	// Card doesn't match any inferences
	else {
		logger.info(`card ${Utils.logCard(focused_card)} order ${focused_card.order} doesn't match any inferences!`);

		/** @type {{connections: Connection[], conn_suit: number}[]} */
		const all_connections = [];
		logger.info(`inferences ${focused_card.inferred.map(c => Utils.logCard(c)).join(',')}`);

		if (target === state.ourPlayerIndex) {
			// Only look for finesses if the card isn't trash
			if (focused_card.inferred.some(c => !isBasicTrash(state, c.suitIndex, c.rank))) {
				// We are the clue target, so we need to consider all the possibilities of the card
				let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;
				let self = true;

				for (const card of focused_card.inferred) {
					const { feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank);
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('feasible?', feasible, 'blind plays', blind_plays);

					if (feasible) {
						// Starts with self-finesse or self-prompt
						if (connections[0]?.self) {
							// TODO: This interpretation should always exist, but must wait for all players to ignore first
							if (self && blind_plays < min_blind_plays) {
								conn_save = { connections, conn_suit: card.suitIndex };
								min_blind_plays = blind_plays;
							}
						}
						// Doesn't start with self
						else {
							// Temp: if a connection with no self-component exists, don't consider any connection with a self-component
							self = false;
							all_connections.push({ connections, conn_suit: card.suitIndex });
						}
					}
				}

				if (self && conn_save !== undefined) {
					all_connections.push(conn_save);
				}
			}
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!isBasicTrash(state, focused_card.suitIndex, focused_card.rank)) {
			const { feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank);
			if (feasible) {
				all_connections.push({ connections, conn_suit: focused_card.suitIndex });
			}
		}

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			focused_card.reset = true;
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focused_card.inferred.map(c => Utils.logCard(c)));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focused_card.inferred;
				focused_card.intersect('inferred', focus_possible);

				if (focused_card.inferred.length === 0) {
					focused_card.inferred = saved_inferences;
				}
				logger.info('no inference on card (other), looks like', focused_card.inferred.map(c => Utils.logCard(c)).join(','));
			}
		}
		else {
			focused_card.inferred = [];

			for (const { connections, conn_suit } of all_connections) {
				assign_connections(state, connections, conn_suit);
				const inference_rank = state.play_stacks[conn_suit] + 1 + connections.filter(conn => !conn.hidden).length;

				// Add inference to focused card
				focused_card.union('inferred', [new Card(conn_suit, inference_rank)]);

				// Only one set of connections, so can elim safely
				if (all_connections.length === 1) {
					team_elim(state, focused_card, giver, target, conn_suit, inference_rank);
				}
				// Multiple possible sets, we need to wait for connections
				else if (connections.length > 0) {
					const inference = { suitIndex: conn_suit, rank: inference_rank };
					state.waiting_connections.push({ connections, focused_card, inference });
				}
			}

			state.hands.forEach(hand => hand.forEach(card => card.superposition = false));
		}
	}
	focused_card.focused = true;
	logger.highlight('blue', 'final inference on focused card', focused_card.inferred.map(c => Utils.logCard(c)).join(','));
	logger.debug('hand state after clue', Utils.logHand(state.hands[target]));
	update_hypo_stacks(state);
}

/**
 * Eliminates the given suitIndex and rank on clued cards from the team, following good touch principle.
 * @param {State} state
 * @param {Card} focused_card
 * @param {number} giver 		The clue receiver. They can elim only if they know/infer the focused card's identity.
 * @param {number} target 		The clue giver. They cannot elim on any of their own clued cards.
 * @param {number} suitIndex
 * @param {number} rank
 */
function team_elim(state, focused_card, giver, target, suitIndex, rank) {
	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		// Giver cannot elim own cards unless all identities can be seen
		if (i === giver) {
			const count = state.discard_stacks[suitIndex][rank - 1] + (state.play_stacks[suitIndex] >= rank ? 1 : 0) + visibleFind(state, giver, suitIndex, rank).length;
			if (count < cardCount(state.suits[suitIndex], rank)) {
				continue;
			}
		}

		// Target can elim only if inference is known, everyone else can elim
		if (i !== target || focused_card.inferred.length === 1) {
			// Don't elim on the focused card
			good_touch_elim(hand, [{ suitIndex, rank }], {ignore: [focused_card.order], hard: true});
		}
	}
}

/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {State} state
 * @param {Connection[]} connections
 * @param {number} suitIndex
 */
function assign_connections(state, connections, suitIndex) {
	let next_rank = state.play_stacks[suitIndex] + 1;
	for (const connection of connections) {
		const { type, reacting, self, hidden } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = state.hands[reacting].findOrder(connection.card.order);

		logger.info(`connecting on ${Utils.logCard(card)} order ${card.order} type ${type}`);

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		card.old_inferred = Utils.objClone(card.inferred);

		if (type === 'finesse') {
			card.finessed = true;
		}

		if (!hidden) {
			// There are multiple possible connections on this card
			if (card.superposition) {
				card.union('inferred', [new Card(suitIndex, next_rank)]);
			}
			else {
				card.inferred = [new Card(suitIndex, next_rank)];
				card.superposition = true;
			}
			next_rank++;
		}

		// Updating notes not on our turn
		// TODO: Examine why this originally had self only?
		if (self || true) {
			// There might be multiple possible inferences on the same card from a self component
			if (card.reasoning.at(-1) !== state.actionList.length - 1) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}
		}
	}
}
