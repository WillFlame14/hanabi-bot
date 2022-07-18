# hanabi-bot
A NodeJS bot that plays on the [hanab.live](https://hanab.live/) interface. Basic structure and ideas were taken from [Zamiell's example bot](https://github.com/Zamiell/hanabi-live-bot).

Currently, the bot plays around level 2 of H-Group. It can accept some mistakes, but will eventually get confused if you don't play using the conventions.

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
