const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    resourceId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    description: {
        type: mongoose.Schema.Types.Mixed,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    },
    group: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },
    slot_length: {
        type: Number,
        default: 60,  // Duration in minutes
        min: 15,
        max: 480
    },
    earliest: {
        type: String,
        default: '09:00'
    },
    latest: {
        type: String,
        default: '17:00'
    },
    bookableDays: {
        type: [Number],
        default: [0, 1, 2, 3, 4, 5, 6]
    },
    capacity: {
        type: Number,
        default: 1,
        min: 1
    },
    price: {
        type: Number,
        default: 0,     // 0 = free; otherwise smallest currency unit (e.g. öre / cents)
        min: 0
    },
    currency: {
        type: String,
        default: 'sek',
        lowercase: true,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Resource', resourceSchema, 'cal_resources');
