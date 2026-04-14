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
        resourceId: 'washing-machine-1',
        name: { sv: 'Tvättmaskin 1', en: 'Washing machine 1' },
        description: { sv: 'Den vänstra tvättmaskinen', en: 'The left washing machine' },
        isActive: true,
        bookingConfig: {
            duration: 60,
            startTime: '09:00',
            endTime: '17:00'
        }
    },
    {
        resourceId: 'washing-machine-2',
        name: { sv: 'Tvättmaskin 2', en: 'Washing machine 2' },
        description: { sv: 'Den högra tvättmaskinen', en: 'The right washing machine' },
        isActive: true,
        bookingConfig: {
            duration: 30,
            startTime: '09:00',
            endTime: '17:00'
        }
    },
    {
        resourceId: 'stair-cleaning-1',
        name: { sv: 'Trapprengöring', en: 'Stair cleaning' },
        description: { sv: 'Städning av trapphuset', en: 'Cleaning of the stairwell' },
        isActive: true,
        bookingConfig: {
            duration: 120,
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
