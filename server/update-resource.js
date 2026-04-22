const mongoose = require('mongoose');
require('dotenv').config();

// Resource Schema (matching the one in handler.js)
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
            default: 60,
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
}, { timestamps: true });

const Resource = mongoose.model('Resource', resourceSchema);

async function updateResource() {
    try {
        const _raw = process.env.CAL_MONGODB || 'mongodb://localhost:27018/booking-calendar';
        let _uri;
        try { const _m = JSON.parse(_raw); _uri = (_m.usr && _m.pwd) ? (() => { const _b = new URL(_m.url); _b.username = _m.usr; _b.password = _m.pwd; return _b.toString(); })() : _m.url; } catch { _uri = _raw; }
        await mongoose.connect(_uri);
        console.log('Connected to MongoDB');

        // Update the projector resource
        const result = await Resource.updateOne(
            { resourceId: 'projector-1' },
            {
                $set: {
                    bookingConfig: {
                        duration: 120,  // 2 hour slots
                        startTime: '10:00',
                        endTime: '16:00'
                    }
                }
            }
        );

        console.log('Update result:', result);

        // Verify the update
        const resource = await Resource.findOne({ resourceId: 'projector-1' });
        console.log('Updated resource:', resource);

    } catch (error) {
        console.error('Error updating resource:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Run the update
updateResource();
