import { types } from 'node:util';
import { ActualCard } from './basics/Card.js';
import * as Utils from './tools/util.js';
import { State } from './basics/State.js';

const PROXY_STATE = Symbol();

const objectTraps = {
	get: (state, prop) => {
		// Getting the non-proxied state from a proxied state
		if (prop === PROXY_STATE)
			return state;

		// If state has been modified, we need to use the copy instead of the base
		if (state.modified) {
			const value = state.copy[prop];

			// Value is already modified, proxied or primitive
			if (value !== state.base[prop] || !isProxyable(value))
				return value;

			// Make a nested proxy so we can continue monitoring changes
			state.copy[prop] = createProxy(state, value);
			return state.copy[prop];
		}

		// Value is already proxied
		if (state.proxies[prop] !== undefined)
			return state.proxies[prop];

		const value = state.base[prop];

		if (!isProxyable(value))
			return value;

		state.proxies[prop] = createProxy(state, value);
		return state.proxies[prop];
	},
	set: (state, prop, value) => {
		if (!state.modified) {
			// No change
			if (state.base[prop] === value || state.proxies[prop] === value)
				return true;

			// This state and all parents have now been modified
			state.markChanged();
		}

		state.copy[prop] = value;
		return true;
	},
	has: (state, prop) => prop in state.source,
	ownKeys: (state) => Reflect.ownKeys(state.source),
	apply: (target, thisArg, argumentsList) => {
		return Reflect.apply(target, thisArg, argumentsList);
	}
};

const arrayTraps = {};
for (const [key, fn] of Object.entries(objectTraps)) {
	arrayTraps[key] = function() {
		arguments[0] = arguments[0][0];
		return fn.apply(this, arguments);
	};
}

function isProxyable(value) {
	return !types.isProxy(value) && typeof value === 'object';
}

/**
 * @template T
 */
class StateProxy {
	modified = false;
	finalized = false;

	/** @type {T} */
	copy;

	/** @type {Record<string, StateProxy>} */
	proxies = {};

	/**
	 * @param {StateProxy} parent
	 * @param {T} base
	 */
	constructor(parent, base) {
		this.parent = parent;
		this.base = base;
	}

	get source() {
		return this.modified ? this.copy : this.base;
	}

	markChanged() {
		if (this.modified)
			return;

		this.modified = true;
		this.copy = Utils.shallowCopy(this.base);

		Object.assign(this.copy, this.proxies);

		if (this.base instanceof ActualCard)
			changed_cards[this.base.order] = this.copy;

		// Propagate modified status to parents
		if (this.parent)
			this.parent.markChanged();
	}
}

let revokes = [];
let changed_cards = {};

/**
 * @template T
 * @param {StateProxy} parent
 * @param {T} base
 */
function createProxy(parent, base) {
	const state = new StateProxy(parent, base);
	const { proxy, revoke } = Array.isArray(base) ? Proxy.revocable([state], arrayTraps) : Proxy.revocable(state, objectTraps);

	revokes.push(revoke);
	return proxy;
}

/**
 * @template T
 * @param {T} base
 * @param {(draft: T) => undefined} producer
 */
export function produce(base, producer) {
	// Save old revokes/cards in case we're nesting produce() calls
	const old_revokes = revokes;
	const old_changed_cards = changed_cards;
	revokes = [];
	changed_cards = {};

	const rootClone = createProxy(undefined, base);
	producer(rootClone);
	const res = finalize(rootClone);

	// Revoke all proxies created
	for (const revoke of revokes)
		revoke();

	revokes = old_revokes;
	changed_cards = old_changed_cards;

	return res;
}

/** @param {StateProxy} base */
function finalize(base) {
	if (types.isProxy(base)) {
		const state = base[PROXY_STATE];
		if (!state.modified)
			return state.base;

		if (state.finalized)
			return state.copy;

		state.finalized = true;
		return finalizeObject(state);
	}

	finalizeNonProxiedObject(base);
	return base;
}

/** @param {StateProxy} state */
function finalizeObject(state) {
	const { base, copy } = state;

	for (const [key, value] of Object.entries(copy)) {
		if (value !== base[key])
			copy[key] = finalize(value);
	}

	// At least one ActualCard changed -- we need to update players
	if (copy instanceof State && Object.keys(changed_cards).length !== 0)
		finalizeState(copy);

	return Object.freeze(copy);
}

/**
 * Finalizes any nested proxies.
 * @template T
 * @param {T} state
 */
function finalizeNonProxiedObject(state) {
	if (!isProxyable(state) || Object.isFrozen(state))
		return;

	for (const [key, value] of Object.entries(state)) {
		if (types.isProxy(value))
			state[key] = finalize(value);
		else
			finalizeNonProxiedObject(value);

	}
	Object.freeze(state);
}

/** @param {State} state */
function finalizeState(state) {
	state.players = state.players.map(p => {
		const player = p.shallowCopy();

		// If any ActualCards were changed, re-link all the associated Cards
		for (const [order, copy] of Object.entries(changed_cards)) {
			const card_copy = player.thoughts[order].shallowCopy();
			card_copy.actualCard = copy;

			const thoughts_copy = Utils.shallowCopy(player.thoughts);
			thoughts_copy[order] = card_copy;

			player.thoughts = thoughts_copy;
		}
		return player;
	});
}
