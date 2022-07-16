const LEVELS = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3
};

class Logger {
	constructor() {
		this.level = LEVELS.INFO;
	}

	setLevel(level) {
		this.level = level;
	}

	debug(...args) {
		if (this.level <= LEVELS.DEBUG) {
			console.log('\x1b[36m%s', ...args, '\x1b[0m');
		}
	}

	info(...args) {
		if (this.level <= LEVELS.INFO) {
			console.log(...args);
		}
	}

	warn(...args) {
		if (this.level <= LEVELS.WARN) {
			console.log('\x1b[33m%s', ...args, '\x1b[0m');
		}
	}

	error(...args) {
		if (this.level <= LEVELS.ERROR) {
			console.log('\x1b[35m%s', ...args, '\x1b[0m');
		}
	}
}

module.exports = { LEVELS, logger: new Logger() };