const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    public: {
        type: Boolean,
        default: false
    },
    adminName:  { type: String, trim: true, default: null },
    adminEmail: { type: String, trim: true, lowercase: true, default: null },
    adminPhone: { type: String, trim: true, default: null },
    languages:  { type: [String], default: ['sv', 'en'] },
    to_pay:     { type: Number,  default: 0, min: 0 },   // 0 = free; otherwise smallest currency unit (e.g. öre / cents)
    currency:   { type: String,  default: 'sek', lowercase: true, trim: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('Group', groupSchema, 'cal_groups');
