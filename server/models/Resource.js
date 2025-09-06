const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    resourceId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    },
    bookingConfig: {
        duration: {
            type: Number,
            required: true,
            default: 60,  // Duration in minutes
            min: 15,
            max: 480
        },
        startTime: {
            type: String,
            default: '09:00'
        },
        endTime: {
            type: String,
            default: '17:00'
        }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Resource', resourceSchema);
