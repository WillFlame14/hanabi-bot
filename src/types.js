// @ts-nocheck

/**
 * @typedef BasicCard
 * @property {number} suitIndex
 * @property {number} rank 
 * 
 * @typedef BaseClue
 * @property {number} type
 * @property {number} value
 * 
 * @typedef {BaseClue & {target: number, result?: ClueResult}} Clue
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
 * @property {number} remainder
 * @property {({playerIndex: number, card: Card})[]} playables
 * 
 * @typedef StatusAction
 * @property {'status'} type
 * @property {number}   clues
 * @property {number}   score
 * @property {number}   maxScore
 * 
 * @typedef TurnAction
 * @property {'turn'}   type
 * @property {number}   num
 * @property {number}   currentPlayerIndex
 * 
 * @typedef ClueAction
 * @property {'clue'}   type
 * @property {number} 	giver
 * @property {number} 	target
 * @property {number[]} list
 * @property {BaseClue} clue
 * @property {boolean}  [mistake]
 * @property {boolean}  [ignoreStall]
 * 
 * @typedef CardAction
 * @property {number} order
 * @property {number} playerIndex
 * @property {number} suitIndex
 * @property {number} rank
 * 
 * @typedef {CardAction & {type: 'draw'}} DrawAction
 * @typedef {CardAction & {type: 'play'}} PlayAction
 * @typedef {CardAction & {type: 'identify'}} IdentifyAction
 * @typedef {{type: 'ignore', playerIndex: number, order: number}} IgnoreAction
 * @typedef {CardAction & {type: 'discard', failed: boolean}} DiscardAction
 * 
 * @typedef GameOverAction
 * @property {'gameOver'}   type
 * @property {number}       endCondition
 * @property {number}       playerIndex
 * @property {any}          votes
 * 
 * @typedef {StatusAction | TurnAction | ClueAction | DrawAction | DiscardAction | PlayAction | GameOverAction | IdentifyAction | IgnoreAction} Action
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
