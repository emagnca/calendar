'use strict';

module.exports = {
    testEnvironment:     'node',
    testMatch:           ['**/tests/**/*.test.js'],
    globalSetup:         './tests/globalSetup.js',
    globalTeardown:      './tests/globalTeardown.js',
    setupFilesAfterEnv:  ['./tests/setup.js'],
    testTimeout:         30000,
};
