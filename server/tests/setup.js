'use strict';

const mongoose = require('mongoose');

beforeAll(async () => {
    // Reuse connection if already open (multiple test files share the server started in globalSetup)
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    await Promise.all(Object.values(collections).map(c => c.deleteMany({})));
});
