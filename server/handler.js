'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const serverless = require('serverless-http');
const ApiCalendar = require('./api');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-calendar')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Serve client static files (must be before SPA catch-all routes)
app.use(express.static(path.join(__dirname, '../client')));

// Mount API
new ApiCalendar().expose(app);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const handler = async (event, context) => {
    return serverless(app)(event, context);
};

module.exports = { app, calendar: handler };
