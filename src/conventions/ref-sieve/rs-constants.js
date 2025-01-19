export const CLUE_INTERP = /** @type {const} */ ({
	NONE: 'none (clue)',
	MISTAKE: 'mistake',
	REF_PLAY: 'ref play',
	REF_DC: 'ref dc',
	LOCK: 'lock',
	REVEAL: 'reveal',
	RECLUE: 'reclue',
	STALL: 'stall'
});

export const PLAY_INTERP = /** @type {const} */ ({
	NONE: 'none (play)',
	CM_ORDER: 'order cm'
});

export const DISCARD_INTERP = /** @type {const} */ ({
	NONE: 'none (dc)',
	SARCASTIC: 'sarcastic',
	SCREAM: 'scream',
	SHOUT: 'shout',
	GENERATION: 'gen',
	POS_DISCARD: 'pos dc',
	POS_MISPLAY: 'pos misplay',
	GENTLEMANS: 'gd',
	BATON: 'baton'
});
