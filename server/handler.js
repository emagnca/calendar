const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { logMethodEntry, logMethodExit } = require('./utils/logger');

const Resource = require('./models/Resource');
const Event = require('./models/Event');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-calendar', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Resource endpoints
app.get('/api/resources', async (req, res) => {
    const methodName = 'getResources';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const resources = await Resource.find({ isActive: true });
        logMethodExit(methodName, resources);
        res.json(resources);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/resources', async (req, res) => {
    const methodName = 'createResource';
    logMethodEntry(methodName, { body: req.body });
    
    try {
        const resource = new Resource(req.body);
        await resource.save();
        logMethodExit(methodName, resource);
        res.status(201).json(resource);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(400).json({ error: error.message });
    }
});

// Event (Booking) endpoints
app.get('/api/events', async (req, res) => {
    const methodName = 'getEvents';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const { startDate, endDate, resourceId } = req.query;
        const query = { status: 'confirmed' };
        
        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        
        if (resourceId) {
            query.resourceId = resourceId;
        }
        
        const events = await Event.find(query);
        logMethodExit(methodName, events);
        res.json(events);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/events', async (req, res) => {
    const methodName = 'createEvent';
    logMethodEntry(methodName, { body: req.body });
    
    try {
        // Check if the resource exists
        console.log("Checking resource")
        const resource = await Resource.findOne({ resourceId: req.body.resourceId });
        console.log("Resource checked", resource)
        if (!resource) {
            console.log("Resource not found")
            return res.status(404).json({ error: 'Resource not found' });
        }

        // Check if the time slot is available
        console.log("Checking availability")
        const existingBooking = await Event.findOne({
            resourceId: req.body.resourceId,
            date: new Date(req.body.date),
            time: req.body.time,
            status: 'confirmed'
        });
        console.log("Availability checked")

        if (existingBooking) {
            return res.status(409).json({ error: 'Time slot is already booked' });
        }

        // Create event with resource details
        const event = new Event({
            resourceId: req.body.resourceId,
            resourceName: resource.name, // Store resource name for easier retrieval
            date: new Date(req.body.date),
            time: req.body.time
        });

        console.log("Saving event")
        await event.save();
        console.log("Event saved")
        logMethodExit(methodName, event);
        res.status(201).json(event);
    } catch (error) {
        console.error(`
            in ${methodName}:`, error);
        res.status(400).json({ error: error.message });
    }
});

// Cancel booking
app.patch('/api/events/:id/cancel', async (req, res) => {
    const methodName = 'cancelEvent';
    logMethodEntry(methodName, { params: req.params });
    
    try {
        const event = await Event.findById(req.params.id);
        if (!event) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        event.status = 'cancelled';
        await event.save();
        logMethodExit(methodName, event);
        res.json(event);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(400).json({ error: error.message });
    }
});

// Default booking configurations for different resource types
const DEFAULT_BOOKING_CONFIG = {
    default: {
        duration: 60,     // 1 hour by default
        startTime: '09:00',
        endTime: '17:00'
    },
    'projector': {
        duration: 120,    // 2 hours for projectors
        startTime: '10:00',
        endTime: '16:00'
    },
    'room': {
        duration: 60,     // 1 hour for rooms
        startTime: '09:00',
        endTime: '17:00'
    }
};

// Helper function to get booking config with defaults
function getBookingConfig(resource) {
    if (resource.bookingConfig) {
        return resource.bookingConfig;
    }

    // Determine resource type from resourceId
    let type = 'default';
    if (resource.resourceId.includes('projector')) {
        type = 'projector';
    } else if (resource.resourceId.includes('room')) {
        type = 'room';
    }

    return DEFAULT_BOOKING_CONFIG[type];
}

// Helper function to generate time slots
function generateTimeSlots(startTime, endTime, duration) {
    const slots = [];
    
    // Convert times to minutes since midnight
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const startInMinutes = startHours * 60 + startMinutes;
    const endInMinutes = endHours * 60 + endMinutes;
    
    for (let time = startInMinutes; time < endInMinutes; time += duration) {
        const hours = Math.floor(time / 60);
        const minutes = time % 60;
        slots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    }
    
    return slots;
}

// Check availability
app.get('/api/availability', async (req, res) => {
    const methodName = 'checkAvailability';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const { date, resourceId } = req.query;
        
        if (!date || !resourceId) {
            return res.status(400).json({ error: 'Date and resourceId are required' });
        }

        // Get resource configuration
        const resource = await Resource.findOne({ resourceId });
        if (!resource) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        // Get existing bookings
        const bookings = await Event.find({
            resourceId,
            date: new Date(date),
            status: 'confirmed'
        });

        // Get booking configuration with defaults
        const bookingConfig = getBookingConfig(resource);
        console.log('Using booking config:', bookingConfig);

        // Generate time slots based on resource configuration
        const timeSlots = generateTimeSlots(
            bookingConfig.startTime,
            bookingConfig.endTime,
            bookingConfig.duration
        );

        // Mark which slots are available
        const availability = timeSlots.map(time => ({
            time,
            isAvailable: !bookings.some(booking => booking.time === time)
        }));

        logMethodExit(methodName, availability);
        res.json({
            resource: {
                name: resource.name,
                description: resource.description,
                bookingConfig: getBookingConfig(resource)
            },
            availability
        });
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
