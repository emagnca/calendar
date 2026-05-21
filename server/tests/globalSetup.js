'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
    const server = await MongoMemoryServer.create({
        instance: { launchTimeout: 120000 },
    });
    const uri    = server.getUri();

    // Store server for globalTeardown (same Jest main-process context)
    global.__MONGOD__ = server;

    // Env vars set here are inherited by the test worker (--runInBand = same process)
    process.env.MONGO_URI      = uri;
    process.env.CAL_MONGODB    = JSON.stringify({ url: uri });
    process.env.CAL_PLATFORM   = '';
    process.env.CAL_JWT_SECRET = JSON.stringify({ secret: 'test-secret' });
    process.env.CAL_ENV        = 'test';
};
