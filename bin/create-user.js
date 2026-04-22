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
const role     = arg('--role');

if (!email || !name || !group) {
    console.error('Usage: node bin/create-user.js --email <email> --name <name> --group <group> [--password <password>] [--role user|admin|superadmin]');
    process.exit(1);
}

async function main() {
    const raw = process.env.CAL_MONGODB || 'mongodb://localhost:27018/booking-calendar';
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

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
        existing.name  = name;
        existing.group = group.toLowerCase();
        if (password) existing.password = password;
        if (role) existing.role = role;
        await existing.save();
        console.log(`Updated existing user: ${existing.email} → group=${existing.group}, role=${existing.role}`);
    } else {
        const user = new User({ email, name, group: group.toLowerCase(), password: password || undefined, role: role || 'user' });
        await user.save();
        console.log(`Created user: ${user.email} (${user.name}) → group=${user.group}, role=${user.role}`);
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
