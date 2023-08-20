/**
 * @typedef ChatMessage
 * @property {string} msg
 * @property {string} who
 * @property {string} room
 * @property {string} recipient
 * 
 * @typedef Self
 * @property {number} userID
 * @property {string} username
 * @property {number[]} playingAtTables
 * @property {string} randomTableName
 * 
 * @typedef Spectator
 * @property {string} name
 * @property {number} shadowingPlayerIndex
 * 
 * @typedef Table
 * @property {number} id
 * @property {string} name
 * @property {boolean} passwordProtected
 * @property {boolean} joined
 * @property {number} numPlayers
 * @property {boolean} owned
 * @property {boolean} running
 * @property {string} variant
 * @property {TableOptions} options
 * @property {boolean} sharedReplay
 * @property {number} progress
 * @property {string[]} players
 * @property {Spectator[]} spectators
 * @property {number} maxPlayers
 * 
 * @typedef TableOptions
 * @property {number} numPlayers
 * @property {number} startingPlayer
 * @property {string} variantName
 * @property {boolean} deckPlays
 * @property {boolean} emptyClues
 * @property {boolean} oneExtraCard
 * @property {boolean} oneLessCard
 * @property {boolean} allOrNothing
 * @property {boolean} detrimentalCharacters
 * 
 * @typedef InitData
 * @property {number} tableID
 * @property {string[]} playerNames
 * @property {number} ourPlayerIndex
 * @property {boolean} replay
 * @property {string} seed
 * @property {TableOptions} options
 * 
 */

export {};
