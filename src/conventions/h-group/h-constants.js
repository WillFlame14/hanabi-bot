export const LEVEL = /** @type {const} */ ({
	FIX: 3,
	SARCASTIC: 3,
	BASIC_CM: 4,
	INTERMEDIATE_FINESSES: 5,
	TEMPO_CLUES: 6,
	LAST_RESORTS: 7,
	STALLING: 9,
	BLUFFS: 11,
	CONTEXT: 12,
});

export const ACTION_PRIORITY = /** @type {const} */ ({
	UNLOCK: 0,
	ONLY_SAVE: 1,
	TRASH_FIX: 2,
	URGENT_FIX: 3,
	PLAY_OVER_SAVE: 4
});

export const CLUE_INTERP = /** @type {const} */ ({
	NONE: 'none',
	MISTAKE: 'mistake',
	PLAY: 'play',
	SAVE: 'save',
	STALL_5: '5 stall',
	STALL_TEMPO: 'tempo stall',
	STALL_LOCKED: 'locked save',
	STALL_FILLIN: 'fill-in',
	STALL_8CLUES: '8cs',
	STALL_BURN: 'hard burn',
	FIX: 'fix',
	CM_TRASH: 'trash cm',
	CM_5: '5cm',
	CM_TEMPO: 'tempo cm'
});

export const PLAY_INTERP = /** @type {const} */ ({
	NONE: 'none',
	CM_ORDER: 'order cm'
});

export const DISCARD_INTERP = /** @type {const} */ ({
	NONE: 'none',
	SARCASTIC: 'sarcastic',
	SCREAM: 'scream',
	SHOUT: 'shout',
	GENERATION: 'gen'
});
