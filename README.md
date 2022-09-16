# hanabi-bot
A deterministic NodeJS bot that plays on the [hanab.live](https://hanab.live/) interface. Basic structure and ideas were taken from [Zamiell's example bot](https://github.com/Zamiell/hanabi-live-bot) (Python).

Currently, it plays around level 3 of H-Group. The goal of the bot is to play with humans, so it should be able to handle suboptimal play within reason. However, it still expects that the conventions are followed (in terms of focus, chop, etc.) and does not perform any "learning".

https://user-images.githubusercontent.com/25177576/190633432-57b527da-786e-4c24-92d0-e1d01291986e.mp4

## Running locally
- You'll need to have NodeJS v16 or above. You can download it [here](https://nodejs.org/en/download/).
- Clone the repository to your own computer. There are lots of tutorials online on using Git if you don't know how that works.
- Navigate to the cloned repository in a terminal and run `npm install` to install required dependencies.
- Export the environment variables `HANABI_USERNAME` and `HANABI_PASSWORD` for the bot to log in.
    - You'll need to create its account on hanab.live first.
- Run `npm start` to start the bot.
    - If you want to run multiple bot accounts using one env file, export environment variables with a number at the end (like `HANABI_USERNAME2`) and use `npm start -- index=2`.

## Supported commands
Send a PM to the bot on hanab.live to interact with it.
- `/join [password]` to join your current lobby.
- `/rejoin <tableID> [password]` to rejoin a game that has already started.
- `/leave <tableID>` to kick the bot from a table.
- `/create <name> <maxPlayers> <password>` to have the bot create a table. The name can't have spaces.
- `/start <tableId>` to have the bot start the game (only works if it created the table).

Feel free to report any issues [here](https://github.com/WillFlame14/hanabi-bot/issues)!
