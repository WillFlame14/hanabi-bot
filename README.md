# hanabi-bot
A deterministic NodeJS bot that plays on the [hanab.live](https://hanab.live/) interface. Basic structure and ideas were taken from [Zamiell's example bot](https://github.com/Zamiell/hanabi-live-bot) (Python). You can play with it by inviting any of the `will-bot`'s to your table.

It can play with [H-Group](https://hanabi.github.io/) and [Playful Sieve](https://hackmd.io/@sodiumdebt/playful_sieve) conventions. The goal of the bot is to play with humans, so it can handle suboptimal play within reason. However, it still expects that the conventions are followed (in terms of focus, chop, etc.) and does not perform any "learning" during a game.

A demo game at H-Group level 3:

https://user-images.githubusercontent.com/25177576/190633432-57b527da-786e-4c24-92d0-e1d01291986e.mp4

A game played at H-Group level 5 can be seen [here](https://github.com/WillFlame14/hanabi-bot/assets/25177576/1aa4f67e-aa66-4704-ba75-fe6edf403bfa).

## Bot features
- Can play with different conventions! Currently, Playful Sieve (2p only) and HGroup levels 1 through 9 (and 11) are supported.
    - Note that HGroup level 10 isn't supported; the bot will play at level 9 if set to this level.
- Takes notes during the game on what it thinks each player knows about their own hand.
- Internally rewinds to relevant turns to understand mistakes.
- Can create and start games on its own (i.e. for playing bot-only games).
- Can replay completed games on hanab.live and offer suggested actions.

If you're interested in understanding how the bot works, I've written [some documentation](https://docs.google.com/document/d/1JMXtNnv3Bw_4Lf6uW_KIllp-Eb7d2wqa_vFaPJzWbDw/edit?usp=sharing).

## Running locally
- You'll need to have NodeJS v20 or above. You can download it [here](https://nodejs.org/en/download/).
- Clone the repository to your own computer. There are lots of tutorials online on using Git if you don't know how that works.
- Navigate to the cloned repository in a terminal and run `npm install` to install required dependencies.
- If you want to run on an alternate hanabi-live server, export the server hostname as `HANABI_HOSTNAME`.
- Export the environment variables `HANABI_USERNAME` and `HANABI_PASSWORD` for the bot to log in.
    - You'll need to create its account on hanab.live first.
- Run `npm start` to start the bot.
    - If you want to run multiple bot accounts using one env file, export environment variables with a number at the end (like `HANABI_USERNAME2`) and use `npm start -- index=2`. See `.env.template` for an example.
- Debug logs will show up in the console, providing more information about what the bot thinks about every action.
    - `hand <playerName> [observerIndex]` will display the information on that player's hand from a particular perspective.
        - If no observer index is provided, the hand will be logged from the common knowledge perspective.
    - `state <attribute>` will display the internal value of the state's attribute (i.e. `state[attribute]`).

## Supported commands
Send a PM to the bot on hanab.live (`/pm <HANABI_USERNAME> <message>`) to interact with it.
- `/join [password]` to join your current lobby. The bot will remain in your table until it is kicked with `/leave`.
- `/rejoin` to rejoin a game that has already started (e.g. if it crashed).
- `/leave` to kick the bot from your table.
- `/create <name> <maxPlayers> <password>` to have the bot create a table. The name can't have spaces.
- `/start` to have the bot start the game (only works if it is the table leader).
- `/settings [conventions=HGroup,PlayfulSieve] [level]` to set the bot's conventions. To view the current settings, provide no parameters. The bot remembers its settings between games, but plays with H-Group conventions at level 1 on first boot.
    - If only a level is provided (without a convention set), H-Group is assumed.
- `/restart` and `/remake` to have the bot perform the corresponding room actions after the game has finished (only works if it is the table leader).

Some commands can be sent inside a room to affect all bots that have joined.
- `/setall [conventions=HGroup, PlayfulSieve] [level]` to set conventions and level for all bots.
- `/leaveall` to kick all bots from the table.

## Watching replays
A replay from hanab.live or from a file (in JSON) can be simulated using `npm run replay [-- <options>]`. Possible options:
- `id=<id>` indicates the ID of the hanab.live replay to load
- `file=<filePath>` indicates the path to the JSON replay to load (relative from the root directory)
- `index=<index>` sets the index of the player the bot will simulate as (defaults to 0)
- `convention=<HGroup, PlayfulSieve>` sets the conventions for the bot (defaults to HGroup)
- `level=<level>` sets the HGroup level for the bot (defaults to 1)

In a replay, the following commands are also supported (in addition to `hand` and `state`):
- `navigate <turn>` to travel to a specific turn.
    - If it is the bot's turn, it will provide a suggestion on what it would do.
    - Instead of a turn number, `+` (next turn), `++` (next turn of the same player), `-`, and `--` can also be used.

## Self-play
The bot can play games with copies of itself using `npm run self-play [-- <options>]`. Possible options:
- `players=<numPlayers>` sets the number of players (defaults to 2, max of 6 players)
- `games=<numGames>` sets the number of games to play (defaults to 10)
- `seed=<seed>` sets the seed of the first game to be played (defaults to 0)
    - The seeding algorithm is different from the one used on hanab.live.
- `variant=<variantName>` sets the variant to be played for all games (defaults to No Variant)
- `convention=<HGroup, PlayfulSieve>` sets the conventions for the bot (defaults to HGroup)
- `level=<level>` sets the HGroup level for the bot (defaults to 1)

The final score for each seed as well as how each game terminated are logged to the console. JSON replays of each game are saved to a `seeds` folder, which can be loaded into hanab.live for viewing.


Feel free to report any issues [here](https://github.com/WillFlame14/hanabi-bot/issues)!
