class Logger {
	LEVELS = Object.freeze({
		DEBUG: 0,
		INFO: 1,
		WARN: 2,
		ERROR: 3
	});
	level = this.LEVELS.INFO;
	accumulate = false;

	/** @type {any[][]} */
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

	log(...args) {
		if (this.accumulate) {
			this.buffer.push(args);
		}
		else {
			console.log(...args);
		}
	}

	debug(...args) {
		if (this.level <= this.LEVELS.DEBUG) {
			this.log('\x1b[36m%s', ...args, '\x1b[0m');
		}
	}

	info(...args) {
		if (this.level <= this.LEVELS.INFO) {
			this.log(...args);
		}
	}

	warn(...args) {
		if (this.level <= this.LEVELS.WARN) {
			this.log('\x1b[33m%s', ...args, '\x1b[0m');
		}
	}

	error(...args) {
		if (this.level <= this.LEVELS.ERROR) {
			this.log('\x1b[35m%s', ...args, '\x1b[0m');
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
		if (print) {
			for (const args of this.buffer) {
				console.log(...args);
			}
		}
		this.accumulate = false;
		this.buffer = [];
	}
}

export default new Logger();
