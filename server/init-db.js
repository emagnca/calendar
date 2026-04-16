const mongoose = require('mongoose');
require('dotenv').config();

// Group Schema
const groupSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, lowercase: true },
    public: { type: Boolean, default: false }
}, { timestamps: true });
const Group = mongoose.model('Group', groupSchema);

// Resource Schema (matching the one in handler.js)
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
    slot_length: {
        type: Number,
        default: 60
    },
    earliest: {
        type: String,
        default: '09:00'
    },
    latest: {
        type: String,
        default: '17:00'
    },
    group: { type: String, trim: true, lowercase: true, default: null }
}, { timestamps: true });

const Resource = mongoose.model('Resource', resourceSchema);

const GROUP_NAME = 'brf8';

// Initial resources to create
const initialResources = [
    {
        resourceId: 'washing-machine-1',
        name: { sv: 'Tvättmaskin 1', en: 'Washing machine 1' },
        description: { sv: 'Den vänstra tvättmaskinen', en: 'The left washing machine' },
        isActive: true,
        slot_length: 60,
        earliest: '09:00',
        latest: '17:00',
        group: GROUP_NAME
    },
    {
        resourceId: 'washing-machine-2',
        name: { sv: 'Tvättmaskin 2', en: 'Washing machine 2' },
        description: { sv: 'Den högra tvättmaskinen', en: 'The right washing machine' },
        isActive: true,
        slot_length: 30,
        earliest: '09:00',
        latest: '17:00',
        group: GROUP_NAME
    },
    {
        resourceId: 'stair-cleaning-1',
        name: { sv: 'Trapprengöring', en: 'Stair cleaning' },
        description: { sv: 'Städning av trapphuset', en: 'Cleaning of the stairwell' },
        isActive: true,
        slot_length: 120,
        earliest: '10:00',
        latest: '16:00',
        group: GROUP_NAME
    }
];

// Connect to MongoDB and initialize resources
async function initializeResources() {
    try {
        await mongoose.connect(process.env.MONGODB_DEV_URI || 'mongodb://localhost:27018/booking-calendar');
        console.log('Connected to MongoDB');

        // Seed group
        await Group.deleteMany({});
        await Group.create({ name: GROUP_NAME, public: false });
        console.log(`Created group: ${GROUP_NAME}`);

        // Clear existing resources
        await Resource.deleteMany({});
        console.log('Cleared existing resources');

        // Create new resources
        await Resource.create(initialResources);
        console.log('Created resources');

        console.log('Database initialization complete!');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Run the initialization
initializeResources();
