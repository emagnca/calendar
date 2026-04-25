'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    groupName:      { type: String, required: true, trim: true, lowercase: true },
    adminName:      { type: String, required: true, trim: true },
    adminEmail:     { type: String, required: true, trim: true, lowercase: true },
    adminPhone:     { type: String, required: true, trim: true },
    regToken:       { type: String, required: true },
    emailCode:      { type: String, required: true },
    smsCode:        { type: String, required: true },
    isPublic:       { type: Boolean, default: false },
    status:         { type: String, enum: ['pending', 'complete'], default: 'pending' },
    createdAt:      { type: Date, default: Date.now, expires: 86400 }
});

module.exports = mongoose.model('GroupRegistration', schema, 'cal_group_registrations');
