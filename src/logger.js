class Logger {
	constructor() {
		this.LEVELS = {
			DEBUG: 0,
			INFO: 1,
			WARN: 2,
			ERROR: 3
		};
		this.level = this.LEVELS.INFO;
		this.accumulate = false;
		this.buffer = [];
	}

	setLevel(level) {
		this.level = level;
	}

	log (...args) {
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

	collect() {
		this.accumulate = true;
	}

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

module.exports = { logger: new Logger() };