const mongoose = require('mongoose');

// Default booking configurations (same as in handler.js)
const DEFAULT_BOOKING_CONFIG = {
    default: {
        duration: 60,
        startTime: '09:00',
        endTime: '17:00'
    },
    'projector': {
        duration: 120,
        startTime: '10:00',
        endTime: '16:00'
    },
    'room': {
        duration: 60,
        startTime: '09:00',
        endTime: '17:00'
    }
};

// Helper function to get booking config
function getBookingConfig(resourceId) {
    let type = 'default';
    if (resourceId.includes('projector')) {
        type = 'projector';
    } else if (resourceId.includes('room')) {
        type = 'room';
    }
    return DEFAULT_BOOKING_CONFIG[type];
}

// Helper function to validate time format and slot
function validateTimeSlot(time, resourceId) {
    // First check time format
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
        return false;
    }

    const config = getBookingConfig(resourceId);
    const [hours, minutes] = time.split(':').map(Number);
    const timeInMinutes = hours * 60 + minutes;

    // Convert config times to minutes
    const [startHours, startMinutes] = config.startTime.split(':').map(Number);
    const [endHours, endMinutes] = config.endTime.split(':').map(Number);
    const startTimeInMinutes = startHours * 60 + startMinutes;
    const endTimeInMinutes = endHours * 60 + endMinutes;

    // Check if time is within bounds
    if (timeInMinutes < startTimeInMinutes || timeInMinutes >= endTimeInMinutes) {
        return false;
    }

    // Check if time aligns with slot duration
    return (timeInMinutes - startTimeInMinutes) % config.duration === 0;
}

const eventSchema = new mongoose.Schema({
    resourceId: {
        type: String,
        required: true
    },
    resourceName: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    time: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return validateTimeSlot(v, this.resourceId);
            },
            message: props => {
                const config = getBookingConfig(this.resourceId);
                return `${props.value} is not a valid time slot. Must be between ${config.startTime} and ${config.endTime} with ${config.duration} minute intervals.`;
            }
        }
    },
    status: {
        type: String,
        enum: ['confirmed', 'cancelled'],
        default: 'confirmed'
    }
}, {
    timestamps: true,
    indexes: [
        // Compound index for checking availability
        { resourceId: 1, date: 1, time: 1 }
    ]
});

// Add a unique compound index to prevent double bookings
eventSchema.index({ resourceId: 1, date: 1, time: 1 }, { unique: true });

module.exports = mongoose.model('Event', eventSchema);
