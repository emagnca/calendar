const mongoose = require('mongoose');
const Resource = require('./Resource');

// Helper function to validate time format
function validateTimeFormat(time) {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

// Helper function to convert time to minutes
function timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

// Helper function to validate time slot against resource config
async function validateTimeSlot(time, resourceId) {
    // First check time format
    if (!validateTimeFormat(time)) {
        return { isValid: false, error: 'Invalid time format' };
    }

    try {
        // Get resource configuration from database
        const resource = await Resource.findOne({ resourceId });
        if (!resource) {
            return { isValid: false, error: 'Resource not found' };
        }

        const timeInMinutes = timeToMinutes(time);
        const startTimeInMinutes = timeToMinutes(resource.earliest || '09:00');
        const endTimeInMinutes = timeToMinutes(resource.latest || '17:00');

        // Check if time is within bounds
        if (timeInMinutes < startTimeInMinutes || timeInMinutes >= endTimeInMinutes) {
            return { 
                isValid: false, 
                error: `Time must be between ${resource.earliest} and ${resource.latest}` 
            };
        }

        // Check if time aligns with slot duration
        const slotLength = resource.slot_length || 60; // Default to 60 minutes if not set
        if ((timeInMinutes - startTimeInMinutes) % slotLength !== 0) {
            return { 
                isValid: false, 
                error: `Time must align with ${slotLength} minute intervals` 
            };
        }

        return { isValid: true };
    } catch (error) {
        return { isValid: false, error: 'Error validating time slot' };
    }
}

// Event schema definition
const eventSchema = new mongoose.Schema({
    resourceId: {
        type: String,
        required: true
    },
    resourceName: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        default: null
    },
    userEmail: {
        type: String,
        required: false,
        default: null
    },
    bookerName: {
        type: String,
        required: false,
        default: null
    },
    date: {
        type: Date,
        required: true
    },
    time: {
        type: String,
        required: true,
        validate: {
            validator: async function(time) {
                const result = await validateTimeSlot(time, this.resourceId);
                if (!result.isValid) {
                    this.invalidate('time', result.error);
                    return false;
                }
                return true;
            },
            message: props => props.reason || 'Invalid time slot'
        }
    },
    group: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },
    status: {
        type: String,
        enum: { 
            values: ['confirmed', 'cancelled'],
            message: 'Invalid status'
        },
        default: 'confirmed'
    }
}, {
    timestamps: true
});

// Compound index for fast availability lookups (uniqueness enforced at application level via capacity)
eventSchema.index({ resourceId: 1, date: 1, time: 1 });

module.exports = mongoose.model('Event', eventSchema, 'cal_events');
