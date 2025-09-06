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
    }
}, { timestamps: true });

const Resource = mongoose.model('Resource', resourceSchema);

// Initial resources to create
const initialResources = [
    {
        resourceId: 'room-1',
        name: 'Meeting Room 1',
        description: 'Main conference room',
        isActive: true,
        bookingConfig: {
            duration: 60,  // 1 hour slots
            startTime: '09:00',
            endTime: '17:00'
        }
    },
    {
        resourceId: 'room-2',
        name: 'Meeting Room 2',
        description: 'Small meeting room',
        isActive: true,
        bookingConfig: {
            duration: 30,  // 30 minute slots
            startTime: '09:00',
            endTime: '17:00'
        }
    },
    {
        resourceId: 'projector-1',
        name: 'Projector',
        description: 'Portable projector',
        isActive: true,
        bookingConfig: {
            duration: 120,  // 2 hour slots
            startTime: '10:00',
            endTime: '16:00'
        }
    }
];

// Connect to MongoDB and initialize resources
async function initializeResources() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-calendar');
        console.log('Connected to MongoDB');

        // Clear existing resources
        await Resource.deleteMany({});
        console.log('Cleared existing resources');

        // Create new resources
        const createdResources = await Resource.create(initialResources);
        console.log('Created resources:', createdResources);

        console.log('Database initialization complete!');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Run the initialization
initializeResources();
