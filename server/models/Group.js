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
    languages:  { type: [String], default: ['sv', 'en'] }
}, {
    timestamps: true
});

module.exports = mongoose.model('Group', groupSchema, 'cal_groups');
