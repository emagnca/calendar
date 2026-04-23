'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs   = require('fs');

const serverless = require('serverless-http');
const ApiCalendar = require('./api');
const { getSecret } = require('./utils/utils');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve client static files (must be before SPA catch-all routes)
const clientRoot = fs.existsSync(path.join(__dirname, 'client'))
    ? path.join(__dirname, 'client')
    : path.join(__dirname, '../client');
app.use(express.static(clientRoot));

// Mount API
new ApiCalendar().expose(app);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Lazy init — resolved once per Lambda cold start
let initPromise = null;

async function init() {
    const mongoSecret = await getSecret('cal_mongodb');
    let uri;
    if (mongoSecret && typeof mongoSecret === 'object') {
        const baseUrl = mongoSecret.url || mongoSecret.uri;
        if (mongoSecret.usr && mongoSecret.pwd) {
            const base = new URL(baseUrl);
            base.username = mongoSecret.usr;
            base.password = mongoSecret.pwd;
            uri = base.toString();
        } else {
            uri = baseUrl;
        }
    } else {
        uri = mongoSecret;
    }
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
}

const handler = async (event, context) => {
    if (!initPromise) initPromise = init();
    await initPromise;
    return serverless(app)(event, context);
};

module.exports = { app, calendar: handler, init };
