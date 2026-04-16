#!/usr/bin/env node
/**
 * Usage:
 *   node bin/create-user.js --email user@example.com --name "Alice" --group brf8 [--password secret]
 */
process.env.MONGOMS_VERSION = '7.0.14';

const path = require('path');
// Resolve modules from server/node_modules
const serverDir = path.join(__dirname, '../server');
require('dotenv').config({ path: path.join(serverDir, '.env') });
const mongoose = require(path.join(serverDir, 'node_modules/mongoose'));
const User = require(path.join(serverDir, 'models/User'));

function arg(flag) {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
}

const email    = arg('--email');
const name     = arg('--name');
const group    = arg('--group');
const password = arg('--password');

if (!email || !name || !group) {
    console.error('Usage: node bin/create-user.js --email <email> --name <name> --group <group> [--password <password>]');
    process.exit(1);
}

async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27018/booking-calendar';
    await mongoose.connect(uri);
    console.log('Connected to', uri);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
        existing.name  = name;
        existing.group = group.toLowerCase();
        if (password) existing.password = password;
        await existing.save();
        console.log(`Updated existing user: ${existing.email} → group=${existing.group}`);
    } else {
        const user = new User({ email, name, group: group.toLowerCase(), password: password || undefined });
        await user.save();
        console.log(`Created user: ${user.email} (${user.name}) → group=${user.group}`);
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
