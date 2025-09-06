const mongoose = require('mongoose');
require('dotenv').config();

// Resource Schema
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

const resourceConfigs = {
    'room-1': {
        duration: 60,  // 1 hour slots
        startTime: '09:00',
        endTime: '17:00'
    },
    'room-2': {
        duration: 30,  // 30 minute slots
        startTime: '09:00',
        endTime: '17:00'
    },
    'projector-1': {
        duration: 120,  // 2 hour slots
        startTime: '10:00',
        endTime: '16:00'
    }
};

async function updateAllResources() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-calendar');
        console.log('Connected to MongoDB');

        // Update each resource
        for (const [resourceId, config] of Object.entries(resourceConfigs)) {
            const result = await Resource.updateOne(
                { resourceId },
                { $set: { bookingConfig: config } }
            );
            console.log(`Update result for ${resourceId}:`, result);
        }

        // Verify all updates
        const resources = await Resource.find({});
        console.log('\nUpdated resources:');
        resources.forEach(resource => {
            console.log(`\n${resource.name}:`, resource.bookingConfig);
        });

    } catch (error) {
        console.error('Error updating resources:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Run the updates
updateAllResources();
