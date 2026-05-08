'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const Event = require('./models/Event');
const { getSecret } = require('./utils/utils');

async function rebuildIndexes() {
    try {
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

        // Drop the old index if it exists
        console.log('Dropping old indexes...');
        try {
            await Event.collection.dropIndex('resourceId_1_date_1_time_1');
            console.log('✓ Dropped old resourceId_1_date_1_time_1 index');
        } catch (e) {
            if (e.message.includes('index not found')) {
                console.log('✓ Old index does not exist (already dropped)');
            } else {
                console.warn('Warning dropping old index:', e.message);
            }
        }

        // Rebuild indexes from schema
        console.log('Rebuilding indexes from schema...');
        await Event.collection.dropIndexes();
        await Event.syncIndexes();
        console.log('✓ Indexes rebuilt successfully');

        // List all indexes
        console.log('\nCurrent indexes:');
        const indexes = await Event.collection.getIndexes();
        Object.entries(indexes).forEach(([name, spec]) => {
            console.log(`  - ${name}:`, spec);
        });

        console.log('\n✓ Index rebuild complete');
        process.exit(0);
    } catch (error) {
        console.error('Error rebuilding indexes:', error);
        process.exit(1);
    }
}

rebuildIndexes();
