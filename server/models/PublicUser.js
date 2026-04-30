'use strict';

const mongoose = require('mongoose');

const publicUserSchema = new mongoose.Schema({
    name:            { type: String, required: true, trim: true },
    email:           { type: String, required: true, trim: true, lowercase: true },
    group:           { type: String, required: true, trim: true, lowercase: true },
    loginCode:       { type: String },
    loginCodeExpiry: { type: Date },
    lastSeen:        { type: Date, default: Date.now },
});

publicUserSchema.index({ email: 1, group: 1 }, { unique: true });
publicUserSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('PublicUser', publicUserSchema, 'cal_public_users');
