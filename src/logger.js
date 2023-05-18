class Logger {
	LEVELS = /** @type {const} */ ({
		DEBUG: 0,
		INFO: 1,
		WARN: 2,
		ERROR: 3
	});
	level = 1;
	accumulate = false;

	/** @type {{colour: string, args: string[]}[]} */
	buffer = [];

	/**
	 * Sets the lowest level of logs that will be printed to console.
	 * 
	 * For example, setting the level to WARN will suppress DEBUG and INFO logs, and only print WARN and ERROR logs.
	 * @param {number} level 
	 */
	setLevel(level) {
		this.level = level;
	}

	wrapLevel(level, func) {
		const last_level = this.level;
		this.level = level;
		func();
		this.level = last_level;
	}

	log(colour, ...args) {
		if (this.accumulate) {
			this.buffer.push({ colour, args });
		}
		else {
			let colour_code = '';
			if (colour.endsWith('b')) {
				colour_code = `1;${COLOURS[colour.slice(0, colour.length - 1)]}`;
			}
			else {
				colour_code = COLOURS[colour];
			}
			console.log(`\x1b[${colour_code}m%s`, ...args, '\x1b[0m');
		}
	}

	debug(...args) {
		if (this.level <= this.LEVELS.DEBUG) {
			this.log('purple', ...args);
		}
	}

	info(...args) {
		if (this.level <= this.LEVELS.INFO) {
			this.log('white', ...args);
		}
	}

	highlight(colour, ...args) {
		if (this.level <= this.LEVELS.INFO && (COLOURS[colour] || (colour.endsWith('b') && COLOURS[colour.slice(0, colour.length - 1)]))) {
			this.log(colour, ...args);
		}
	}

	warn(...args) {
		if (this.level <= this.LEVELS.WARN) {
			this.log('cyan', ...args);
		}
	}

	error(...args) {
		if (this.level <= this.LEVELS.ERROR) {
			this.log('red', ...args);
		}
	}

	/**
	 * Starts collecting logs into a buffer (and does not print them immediately).
	 * Logs can be printed or discarded using flush().
	 */
	collect() {
		this.accumulate = true;
	}

	/**
	 * Flushes the log buffer.
	 * @param {boolean} print 	Whether to print the logs (true) or discard them (false).
	 */
	flush(print = true) {
		this.accumulate = false;

		if (print) {
			for (const log of this.buffer) {
				const { colour, args } = log;
				this.log(colour, ...args);
			}
		}

		this.buffer = [];
	}
}

const logger = new Logger();
export default logger;

const COLOURS = /** @type {const} */ ({
	gray: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	purple: 35,
	cyan: 36,
	white: 37
});
