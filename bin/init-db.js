#!/usr/bin/env node
/**
 * Usage: node bin/init-db.js
 * Initializes the database with a default group, resources and one admin user.
 */

const path = require('path');
const serverDir = path.join(__dirname, '../server');
require('dotenv').config({ path: path.join(serverDir, '.env') });

const mongoose = require(path.join(serverDir, 'node_modules/mongoose'));
const Group    = require(path.join(serverDir, 'models/Group'));
const Resource = require(path.join(serverDir, 'models/Resource'));
const User     = require(path.join(serverDir, 'models/User'));

// ── Configuration ─────────────────────────────────────────────────────────────

const GROUP_NAME = 'brf8';

const DEFAULT_USER = {
    email: 'admin@brf8.se',
    name:  'Admin',
    group: GROUP_NAME,
    role:  'admin',
    // password: 'changeme'   // uncomment to set an initial password
};

const RESOURCES = [
    {
        resourceId: 'washing-machine-1',
        name:        { sv: 'Tvättmaskin 1', en: 'Washing machine 1' },
        description: { sv: 'Den vänstra tvättmaskinen', en: 'The left washing machine' },
        isActive:    true,
        slot_length: 60,
        earliest:    '09:00',
        latest:      '17:00',
        group:       GROUP_NAME
    },
    {
        resourceId: 'washing-machine-2',
        name:        { sv: 'Tvättmaskin 2', en: 'Washing machine 2' },
        description: { sv: 'Den högra tvättmaskinen', en: 'The right washing machine' },
        isActive:    true,
        slot_length: 30,
        earliest:    '09:00',
        latest:      '20:00',
        group:       GROUP_NAME
    },
    {
        resourceId: 'stair-cleaning-1',
        name:        { sv: 'Trapprengöring', en: 'Stair cleaning' },
        description: { sv: 'Städning av trapphuset', en: 'Cleaning of the stairwell' },
        isActive:    true,
        slot_length: 120,
        earliest:    '10:00',
        latest:      '16:00',
        group:       GROUP_NAME
    }
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const raw = process.env.CAL_MONGODB || 'mongodb://localhost:27018/booking-calendar';
    //const raw = '{"url":"mongodb+srv://cluster-mmdok-shared.ic2fz.mongodb.net/booking-calendar","usr":"mmadmin","pwd":"q1BsBbxJquriFlk7"}';
    console.log("raw", raw);
    let uri;
    try {
        const m = JSON.parse(raw);
        if (m.usr && m.pwd) {
            const base = new URL(m.url);
            base.username = m.usr; base.password = m.pwd;
            uri = base.toString();
        } else {
            uri = m.url;
        }
    } catch {
        uri = raw;
    }
    await mongoose.connect(uri);
    console.log('Connected to', uri);

    // Group
    await Group.deleteMany({});
    await Group.create({ name: GROUP_NAME, public: false });
    console.log(`Created group: ${GROUP_NAME}`);

    // Resources
    await Resource.deleteMany({});
    await Resource.create(RESOURCES);
    console.log(`Created ${RESOURCES.length} resources`);

    // Default user (upsert — preserve existing if already present)
    const existing = await User.findOne({ email: DEFAULT_USER.email });
    if (existing) {
        console.log(`User already exists: ${existing.email} — skipping`);
    } else {
        const user = new User(DEFAULT_USER);
        await user.save();
        console.log(`Created default user: ${user.email} (${user.name}) → group=${user.group}`);
    }

    console.log('Database initialization complete!');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
