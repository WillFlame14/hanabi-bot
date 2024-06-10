# hanabi-bot testing

The complete test suite can be run with `npm run test`.

## Debugging tests

By default, tests disable logging. However, for diagnostic purposes if the `LOG_LEVEL` is set this will be used as the logging level. E.g. to run all tests with INFO level logging:

```
LOG_LEVEL=1 npm run test
```

Individual test suites can be run with `node --test test/path/file.js`.

## Running individual tests

Often when working on a particular failure it can be useful to run that single test. Here is an example of running an individual test from the h-group level-1 suite with DEBUG logging:

```
LOG_LEVEL=1 node --test --test-name-pattern "does not finesse from a 2 Save" test/h-group/level-1.js
```
