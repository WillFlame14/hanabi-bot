const { cardCount } = require('../variants.js');

function visibleFind(state, inferringPlayerIndex, suitIndex, rank, options = {}) {
	let found = [];
	for (let i = 0; i < state.numPlayers; i++) {
		if (options.ignore?.includes(i)) {
			continue;
		}

		const hand = state.hands[i];
		options.infer = options.infer ?? (i === inferringPlayerIndex || i === state.ourPlayerIndex);
		options.symmetric = (i === inferringPlayerIndex);
		found = found.concat(hand.findCards(suitIndex, rank, options));
	}
	return found;
}

function isCritical(state, suitIndex, rank) {
	return state.discard_stacks[suitIndex][rank - 1] === (cardCount(state.suits[suitIndex], rank) - 1);
}

function isBasicTrash(state, suitIndex, rank) {
	return rank <= state.play_stacks[suitIndex] || rank > state.max_ranks[suitIndex];
}

function isSaved(state, inferringPlayerIndex, suitIndex, rank, order = -1, options) {
	return visibleFind(state, inferringPlayerIndex, suitIndex, rank, options).some(c => {
		return c.order !== order && (c.finessed || c.clued || c.chop_moved);
	});
}

function isTrash(state, inferringPlayerIndex, suitIndex, rank, order, options) {
	return isBasicTrash(state, suitIndex, rank) || isSaved(state, inferringPlayerIndex, suitIndex, rank, order, options);
}

function playableAway(state, suitIndex, rank) {
	return rank - (state.play_stacks[suitIndex] + 1);
}

function getPace(state) {
	const currScore = state.play_stacks.reduce((acc, curr) => acc + curr);
	const maxScore = state.max_ranks.reduce((acc, curr) => acc + curr);
	return currScore + state.cards_left + state.numPlayers - maxScore;
}

module.exports = {
	visibleFind,
	isCritical, isBasicTrash, isSaved, isTrash,
	playableAway,
	getPace
};
