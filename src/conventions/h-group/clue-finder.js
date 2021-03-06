const { determine_clue } = require('./clue-helper.js');
const { find_chop, find_finesse_pos } = require('./hanabi-logic.js');
const { ACTION } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function valid_play(state, target, card) {
	const { suitIndex, rank } = card;

	const finesses = state.hands.map(_ => 0);

	const known_cards = state.hands.map(hand => hand.filter(card => card.possible.length === 1 || card.inferred.length === 1)).flat();
	const p_cards = [], f_cards = [];

	// Cannot prompt or finesse on self
	for (let i = 1; i < state.numPlayers; i++) {
		const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;
		const hand = state.hands[playerIndex];

		p_cards.push(hand.find(c => c.clued));
		f_cards.push(hand[find_finesse_pos(hand)]);
	}

	logger.debug('known', known_cards.map(c => c.toString()));
	logger.debug('promptable', p_cards.filter(c => c !== undefined).map(c => c.toString()));
	logger.debug('finessable', f_cards.filter(c => c !== undefined).map(c => c.toString()));

	for (let conn_rank = state.hypo_stacks[suitIndex] + 1; conn_rank < rank; conn_rank++) {
		logger.debug('looking for connecting', Utils.logCard(suitIndex, conn_rank).toString());
		const all_cards = known_cards.concat(p_cards).concat(f_cards).filter(c => c !== undefined);

		if (!all_cards.some(c => c.matches(suitIndex, conn_rank))) {
			return { valid: false };
		}

		const finessedPlayer = f_cards.findIndex(c => c !== undefined && c.matches(suitIndex, conn_rank));
		if (finessedPlayer !== -1) {
			finesses[finessedPlayer]++;

			const f_hand = state.hands[finessedPlayer];
			f_cards.splice(finessedPlayer, 1, f_hand[find_finesse_pos(f_hand, finesses[finessedPlayer])]);
		}
	}
	logger.debug(card.toString(),'is a valid play clue!');
	return { valid: true, finesses: finesses.reduce((sum, curr) => sum + curr, 0) };
}

function find_clues(state) {
	const play_clues = [], save_clues = [];

	logger.info('play/hypo/max stacks in clue finder:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];
		save_clues[target] = undefined;

		// Ignore our own hand
		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		const chopIndex = find_chop(hand);

		for (let cardIndex = chopIndex; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank } = card;

			// Clued, finessed, trash or visible elsewhere
			if (card.clued || card.finessed || rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex] ||
				Utils.visibleFind(state, target, suitIndex, rank).some(c => c.clued)) {
				continue;
			}

			const { valid, finesses } = valid_play(state, target, card);

			if (valid) {
				// Play clue
				const clue = determine_clue(state, target, card);
				if (clue !== undefined) {
					play_clues[target].push(Object.assign(clue, {finesses}));

					if (cardIndex === chopIndex) {
						save_clues[target] = clue;
					}
				}
			}
			else if (cardIndex === chopIndex && !card.finessed) {
				// Save clue
				const chop = hand[chopIndex];
				// TODO: See if someone else can save
				if (Utils.isCritical(state, chop.suitIndex, chop.rank)) {
					logger.warn('saving critical card', chop.toString());
					if (chop.rank === 5) {
						save_clues[target] = { type: ACTION.RANK, value: 5, target };
					}
					else {
						// The card is on chop, so it can always be focused
						save_clues[target] = determine_clue(state, target, card);
					}
				}
				else if (chop.rank === 2) {
					// Play stack hasn't started and other copy of 2 isn't visible (to us)
					if (state.play_stacks[chop.suitIndex] === 0 && Utils.visibleFind(state, state.ourPlayerIndex, chop.suitIndex, 2).length === 1) {
						// Also check if not reasonably certain in our hand
						if(!state.hands[state.ourPlayerIndex].some(c => c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank))) {
							save_clues[target] = { type: ACTION.RANK, value: 2, target };
						}
					}
				}
				else {
					logger.debug('not saving card', chop.toString(), 'on chop');
				}
			}
		}
	}

	logger.info('found play clues', play_clues);
	logger.info('found save clues', save_clues);
	return { play_clues, save_clues };
}

function find_tempo_clues(state) {
	const tempo_clues = [];

	for (let target = 0; target < state.numPlayers; target++) {
		tempo_clues[target] = [];

		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];
		for (const card of hand) {
			// Card must be clued and playable
			if (card.clued && state.hypo_stacks[card.suitIndex] + 1 === card.rank) {
				// Card is known playable
				if (card.inferred.every(c => state.play_stacks[c.suitIndex] + 1 === c.rank)) {
					continue;
				}
				const clue = determine_clue(state, target, card);
				if (clue !== undefined) {
					tempo_clues[target].push(clue);
				}
			}
		}
	}
	return tempo_clues;
}

/**
 * Finds a stall clue to give. Always finds a clue if severity is greater than 1 (hard burn).
 */
function find_stall_clue(state, severity) {
	const stall_clues = [[], [], [], []];
	stall_clues[1] = find_tempo_clues(state).flat();

	for (let target = 0; target < state.numPlayers; target++) {
		if (target === state.ourPlayerIndex) {
			continue;
		}

		const hand = state.hands[target];

		// Early game
		if (severity > 0) {
			// 5 Stall (priority 0)
			if (hand.some(c => c.rank === 5 && !c.clued)) {
				stall_clues[0].push({ type: ACTION.RANK, target, value: 5 });
				break;
			}
		}

		// Double discard/Scream discard
		if (severity > 1) {
			// Tempo clue (priority 1) is already covered

			// Fill-in (priority 2)

			// Hard burn (priority 3)
			const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
			stall_clues[3].push({ type: ACTION.RANK, target: nextPlayerIndex, value: state.hands[nextPlayerIndex].at(-1).rank });
		}

		// Locked hand
		if (severity > 2) {
			// Locked hand save (priority 2)
		}

		// 8 clues
		if (severity > 3) {
			// 8 clue save (priority 2)
		}
	}

	logger.info('all stall clues', stall_clues);

	// Go through each priority
	for (const clues of stall_clues) {
		if (clues.length > 0) {
			return clues[0];
		}
	}
}

module.exports = { find_clues, find_tempo_clues, find_stall_clue };
