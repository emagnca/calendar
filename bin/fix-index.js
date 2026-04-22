const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Event = require('../models/Event');

dotenv.config();

async function fixIndex() {
    try {
        const _raw = process.env.CAL_MONGODB || 'mongodb://localhost:27018/booking-calendar';
        let _uri;
        try { const _m = JSON.parse(_raw); _uri = (_m.usr && _m.pwd) ? (() => { const _b = new URL(_m.url); _b.username = _m.usr; _b.password = _m.pwd; return _b.toString(); })() : _m.url; } catch { _uri = _raw; }
        await mongoose.connect(_uri);
        console.log('Connected to MongoDB');

        
        // Drop the existing index
        await Event.collection.dropIndex('resourceId_1_date_1_time_1');
        console.log('Dropped old index');

        // Create new partial index
        await Event.collection.createIndex(
            { resourceId: 1, date: 1, time: 1 },
            { 
                unique: true,
                partialFilterExpression: { status: 'confirmed' }
            }
        );
        console.log('Created new partial index');

        await mongoose.disconnect();
        console.log('Done');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

fixIndex();
