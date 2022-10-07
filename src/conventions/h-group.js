const { interpret_clue } = require('./h-group/clue-interpretation/interpret-clue.js');
const { interpret_discard } = require('./h-group/interpret-discard.js');
const { take_action } = require('./h-group/take-action.js');
const { update_turn } = require('./h-group/update-turn.js');

module.exports = {
	interpret_clue,
	interpret_discard,
	take_action,
	update_turn
};
