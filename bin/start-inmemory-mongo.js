#!/usr/bin/env node

// scripts/start-inmemory-mongo.js

// MongoDB 8.x requires macOS 14+; pin to 7.x for macOS 13 (Ventura) compatibility
process.env.MONGOMS_VERSION = '7.0.14';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');

(async () => {
  // Start mongodb-memory-server on a fixed port (27018)
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27018,
    },
  });
  const uri = mongod.getUri();
  console.log('MongoMemoryServer URI:', uri);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('mmdok');
  console.log('Connected to in-memory MongoDB');

  // ... do stuff with db ...

  // Cleanup when finished
  //await client.close();
  //await mongod.stop();
})();
