# hanabi-bot
A NodeJS bot that plays on the [hanab.live](https://hanab.live/) interface.

Currently, the bot plays at around level 0.5 of H-Group. It can handle direct play clues, save clues, clue focus, and some general ideas of Good Touch Principle.

## Running locally
- You'll need to have NodeJS v16 or above.
- Run `npm install` to install required dependencies.
- Export the environment variables `HANABI_USERNAME` and `HANABI_PASSWORD` for the bot to log in. (You'll need to create its account on hanab.live first.)
- Run `node src/hanabi-bot.js` to start the bot.

## Supported commands
Send a PM to the bot on hanab.live to get it to respond.
- `/join [password]` to join your current lobby
- `/rejoin <tableID> [password]` to rejoin a game that has already started
- `/leave <tableID>` to kick the bot from a table)
