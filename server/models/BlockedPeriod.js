'use strict';

const mongoose = require('mongoose');

const blockedPeriodSchema = new mongoose.Schema({
    group:      { type: String, required: true, lowercase: true, trim: true },
    resourceId: { type: String, default: null },   // null = all resources in group
    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },
    startTime:  { type: String, default: null },   // null = full-day block
    endTime:    { type: String, default: null },
    reason:     { type: String, default: '', trim: true }
}, { timestamps: true });

module.exports = mongoose.model('BlockedPeriod', blockedPeriodSchema, 'cal_blocked_periods');
