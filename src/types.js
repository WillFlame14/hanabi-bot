// @ts-nocheck

/**
 * @typedef Clue
 * @property {number} type
 * @property {number} target
 * @property {number} value
 * @property {ClueResult} [result]
 * 
 * @typedef {Clue & {urgent: boolean, trash: boolean}} FixClue
 * 
 * @typedef ClueResult
 * @property {Clue} clue
 * @property {Card[]} touch
 * @property {Card[]} interpret
 * @property {number} elim
 * @property {number} new_touched
 * @property {number} bad_touch
 * @property {number} trash
 * @property {number} finesses
 * @property {({playerIndex: number, card: Card})[]} playables
 * 
 * 
 * @typedef ClueAction
 * @property {string} 	type
 * @property {number} 	giver
 * @property {number} 	target
 * @property {number[]} list
 * @property {Clue} 	clue
 * @property {boolean}  [mistake]
 * @property {boolean}  [ignoreStall]
 * 
 * @typedef CardAction
 * @property {string} type
 * @property {number} order
 * @property {number} playerIndex
 * @property {number} suitIndex
 * @property {number} rank
 * 
 * @typedef {CardAction & {failed: boolean}} DiscardAction
 * 
 * @typedef TurnAction
 * @property {string} type
 * @property {number} [currentPlayerIndex]
 * 
 * @typedef {{type: string} & Partial<(ClueAction & DiscardAction & TurnAction)>} Action
 * 
 * @typedef PerformAction
 * @property {number} tableID`
 * @property {number} type
 * @property {number} target
 * @property {number} [value]
 * 
 * @typedef Connection
 * @property {'known' | 'playable' | 'prompt' | 'finesse'} type
 * @property {number} reacting
 * @property {Card} card
 * @property {boolean} [self]
 * 
 * @typedef WaitingConnection
 * @property {Connection[]} connections
 * @property {Card} focused_card
 * @property {{suitIndex: number, rank: number}} inference
 * 
 */

export {};
