export const ACTION =  /** @type {const} */ ({
	PLAY: 0,
	DISCARD: 1,
	COLOUR: 2,
	RANK: 3,
	END_GAME: 4
});

export const CLUE = /** @type {const} */ ({ COLOUR: 0, RANK: 1 });

export const END_CONDITION = /** @type {const} */ ({
	IN_PROGRESS: 0,
	NORMAL: 1,
	STRIKEOUT: 2,
	TIMEOUT: 3,
	TERMINATED: 4,
	SPEEDRUN_FAIL: 5,
	IDLE_TIMEOUT: 6,
	CHARACTER_SOFTLOCK: 7,
	ALL_OR_NOTHING_FAIL: 8,
	ALL_OR_NOTHING_SOFTLOCK: 9,
	TERMINATED_BY_VOTE: 10
});
