class Logger {
	constructor() {
		this.LEVELS = {
			DEBUG: 0,
			INFO: 1,
			WARN: 2,
			ERROR: 3
		};
		this.level = this.LEVELS.INFO;
	}

	setLevel(level) {
		this.level = level;
	}

	debug(...args) {
		if (this.level <= this.LEVELS.DEBUG) {
			console.log('\x1b[36m%s', ...args, '\x1b[0m');
		}
	}

	info(...args) {
		if (this.level <= this.LEVELS.INFO) {
			console.log(...args);
		}
	}

	warn(...args) {
		if (this.level <= this.LEVELS.WARN) {
			console.log('\x1b[33m%s', ...args, '\x1b[0m');
		}
	}

	error(...args) {
		if (this.level <= this.LEVELS.ERROR) {
			console.log('\x1b[35m%s', ...args, '\x1b[0m');
		}
	}
}

module.exports = { logger: new Logger() };