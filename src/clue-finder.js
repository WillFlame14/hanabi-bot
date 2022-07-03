const { ACTION } = require('./action-helper.js');
const { determine_clue } = require('./clue-helper.js');
const { find_chop } = require('./hanabi-logic.js');
const Utils = require('./util.js');

function find_clues(state) {
	const play_clues = [];
	const save_clues = [];

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

		// Play clue
		for (let cardIndex = chopIndex; cardIndex >= 0; cardIndex--) {
			const card = hand[cardIndex];
			const { suitIndex, rank } = card;

			if (!card.clued) {
				const next_playable_rank = state.hypo_stacks[suitIndex] + 1;
				console.log('giving play clue. suitIndex', suitIndex, 'play stack:', state.play_stacks[suitIndex], 'hypo stack:', state.hypo_stacks[suitIndex]);

				if (next_playable_rank === rank) {
					// console.log('found playable card to clue', card);
					const clue = determine_clue(state, target, card);
					if (clue !== undefined) {
						play_clues[target].push(clue);

						if (cardIndex === chopIndex) {
							save_clues[target] = clue;
						}
					}
				}

				// Save clue
				if (cardIndex === chopIndex) {
					const chop = hand[chopIndex];
					// TODO: See if someone else can save
					if (Utils.isCritical(state, chop.suitIndex, chop.rank)) {
						console.log('saving critical card', Utils.cardToString(chop));
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
							if(!state.hands[state.ourPlayerIndex].some(c => c.inferred.length === 1 && Utils.cardMatch(c.inferred[0], suitIndex, rank))) {
								save_clues[target] = { type: ACTION.RANK, value: 2, target };
							}
							else {
								console.log('condition not met for 2 save: inferred in hand');
							}
						}
						else {
							console.log('condition not met for 2 save: play stack', state.play_stacks[chop.suitIndex] === 0,
								'visible:', Utils.visibleFind(state, target, chop.suitIndex, 2).length);
						}
					}
					else {
						console.log('chop card', Utils.cardToString(chop), 'is not critical');
					}
				}
			}
		}
	}

	console.log('found play clues', play_clues);
	console.log('found save clues', save_clues);
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
			if (card.clued && card.inferred.length > 1 && state.hypo_stacks[card.suitIndex] + 1 === card.rank) {
				const clue = determine_clue(state, target, card);
				if (clue !== undefined) {
					console.log('found tempo clue to', state.playerNames[target], clue);
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
				console.log(`found 5 stall to ${state.playerNames[target]}`);
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

	console.log('all stall clues', stall_clues);

	// Go through each priority
	for (const clues of stall_clues) {
		if (clues.length > 0) {
			return clues[0];
		}
	}
}

module.exports = { find_clues, find_tempo_clues, find_stall_clue };
