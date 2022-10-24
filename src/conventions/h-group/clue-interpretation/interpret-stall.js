const { CLUE } = require('../../../constants.js');
const { determine_focus, stall_severity } = require('../hanabi-logic.js');
const { logger } = require('../../../logger.js');

function isStall(state, action, severity) {
	const { clue, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	// 5 Stall given
	if (clue.type === CLUE.RANK && clue.value === 5) {
		logger.info('5 stall!');
		return true;
	}

	if (severity >= 2) {
		// 5 Stall was available
		if (state.hands[target].some(c => c.rank === 5 && !c.clued)) {
			logger.info('5 stall was available but not given, so must not be stall');
			return false;
		}

		// Fill-in given
		// Tempo clue given

		if (severity >= 3) {
			// Tempo clue was available
			/*if (play_clues.some(clues => clues.some(clue => clue.bad_touch < 2))) {
				logger.info('tempo was available but not given, so must not be stall');
				return false;
			}*/

			// Locked hand stall given, not touching slot 1
			if (chop && state.hands[target].findIndex(c => c.order === focused_card.order) !== 0) {
				logger.info('locked hand stall!');
				return true;
			}

			if (severity === 4) {
				// 8 clue save given
				if (!list.includes(state.hands[target][0].order)) {
					logger.info('8 clue stall!');
					return true;
				}
				// 8 clue save was available
			}
			// Locked hand stall was available
		}
		// Fill-in was available

		// Hard burn given
		if (!focused_card.newly_clued) {
			logger.info('hard burn!');
			return true;
		}
	}
}

function stalling_situation(state, action) {
	const { giver } = action;
	const severity = stall_severity(state, giver);

	// Not a stalling situation
	if (severity === 0) {
		return false;
	}

	logger.info('severity', severity);

	// Check at the very end - only if the conditions are right for a stall, then see if a play/save could have been given
	// TODO: Add this back in. For now, it's causing a large number of infinite loops and isn't even correct most of the time.
	if (isStall(state, action, severity)) {
		/*const { play_clues, save_clues } = find_clues(state, { ignorePlayerIndex: giver, ignoreCM: true });

		// There was a play (no bad touch, not tempo) or save available
		if (play_clues.some(clues => clues.some(clue => clue.bad_touch === 0 && clue.result.new_touched > 0)) ||
			save_clues.some(clue => clue !== undefined)
		) {
			logger.info('play or save available, not interpreting stall');
			return false;
		}
		else {
			return true;
		}*/
		return true;
	}
	return false;
}

module.exports = { stalling_situation };
