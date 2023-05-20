# hanabi-bot
A deterministic NodeJS bot that plays on the [hanab.live](https://hanab.live/) interface. Basic structure and ideas were taken from [Zamiell's example bot](https://github.com/Zamiell/hanabi-live-bot) (Python).

It follows [H-Group](https://hanabi.github.io/) conventions. The goal of the bot is to play with humans, so it can handle suboptimal play within reason. However, it still expects that the conventions are followed (in terms of focus, chop, etc.) and does not perform any "learning" during a game.

https://user-images.githubusercontent.com/25177576/190633432-57b527da-786e-4c24-92d0-e1d01291986e.mp4

## Bot features
- Can play at different levels of the H-Group convention set. Currently, levels 1-5 are supported.
- Takes notes during the game on cards in its own hand.
- Internally rewinds to relevant turns to understand mistakes.
- Can create and start games on its own (i.e. for playing bot-only games).
- Can replay completed games on hanab.live and offer suggestions.

## Running locally
- You'll need to have NodeJS v16 or above. You can download it [here](https://nodejs.org/en/download/).
- Clone the repository to your own computer. There are lots of tutorials online on using Git if you don't know how that works.
- Navigate to the cloned repository in a terminal and run `npm install` to install required dependencies.
- Export the environment variables `HANABI_USERNAME` and `HANABI_PASSWORD` for the bot to log in.
    - You'll need to create its account on hanab.live first.
- Run `npm start` to start the bot.
    - If you want to run multiple bot accounts using one env file, export environment variables with a number at the end (like `HANABI_USERNAME2`) and use `npm start -- index=2`. See `.env.template` for an example.
- Debug logs will show up in the console, providing more information about what the bot thinks about every action.
    - `hand <playerName>` will display the bot's information on that player's hand.
    - `state <attribute>` will display the internal value of the state's attribute (i.e. `state[attribute]`).

## Supported commands
Send a PM to the bot on hanab.live (`/pm <HANABI_USERNAME> <message>`) to interact with it.
- `/join [password]` to join your current lobby. The bot will remain in your table until it is kicked with `/leave`.
- `/rejoin` to rejoin a game that has already started (e.g. if it crashed).
- `/leave` to kick the bot from your table.
- `/create <name> <maxPlayers> <password>` to have the bot create a table. The name can't have spaces.
- `/start` to have the bot start the game (only works if it created the table).
- `/settings [conventions=HGroup] [level]` to set or view the bot's conventions and level. The bot plays with H-Group conventions at level 1 by default.
- `/restart` and `remake` to perform the corresponding actions in the current room after the game has finished.

Some commands can be sent inside a room to affect all bots that have joined.
- `/setall [conventions=HGroup] [level]` to set conventions and level for all bots.
- `/leaveall` to kick all bots from the table.

## Watching replays
A replay from hanab.live can be simulated using `npm run replay -- id=<id>`. Additional options `index=0` (the index of the player the bot will simulate as) and `level=1` (the H-Group level) can be provided.

In a replay, the following commands are also supported:
- `navigate <turn>` to travel to a specific turn.
    - If it is the bot's turn, it will provide a suggestion on what it would do.
    - Instead of a turn number, `+` (next turn), `++` (next turn of the same player), `-`, and `--` can also be used.

Feel free to report any issues [here](https://github.com/WillFlame14/hanabi-bot/issues)!
