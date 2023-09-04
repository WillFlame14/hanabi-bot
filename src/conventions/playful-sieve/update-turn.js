import { update_hypo_stacks } from '../../basics/helper.js';

/**
 * @typedef {import('../../basics/State.js').State} State
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').TurnAction} TurnAction
 * @typedef {import('../../types.js').Connection} Connection
 */

/**
 * Performs relevant updates after someone takes a turn.
 * @param {State} state
 * @param {TurnAction} _action
 */
export function update_turn(state, _action) {
	update_hypo_stacks(state);
}
