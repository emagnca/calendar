const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { logMethodEntry, logMethodExit } = require('./utils/logger');

const Resource = require('./models/Resource');
const Event = require('./models/Event');
const User = require('./models/User');
const auth = require('./middleware/auth');

// Load environment variables
dotenv.config();

const app = express();
const apiRouter = express.Router();

// Middleware
app.use(cors());
app.use(express.json());

// Mount API router
app.use('/api', apiRouter);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-calendar', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Auth endpoints
apiRouter.post('/register', async (req, res) => {
    const methodName = 'register';
    logMethodEntry(methodName, { body: req.body });
    
    try {
        const { email, password, name } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        // Create new user
        const user = new User({ email, password, name });
        await user.save();
        
        // Generate token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        logMethodExit(methodName, { userId: user._id });
        res.status(201).json({
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(400).json({ error: error.message });
    }
});

apiRouter.post('/login', async (req, res) => {
    const methodName = 'login';
    logMethodEntry(methodName, { body: req.body });
    
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        logMethodExit(methodName, { userId: user._id });
        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(400).json({ error: error.message });
    }
});

// Protected Resource endpoints
apiRouter.get('/resources', auth, async (req, res) => {
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

apiRouter.post('/resources', async (req, res) => {
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
apiRouter.get('/events', auth, async (req, res) => {
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

apiRouter.post('/events', auth, async (req, res) => {
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

        // Create event with resource and user details
        const event = new Event({
            resourceId: req.body.resourceId,
            resourceName: resource.name, // Store resource name for easier retrieval
            userId: req.user.userId,
            userEmail: req.user.email,
            date: new Date(req.body.date),
            time: req.body.time,
            status: 'confirmed'
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
apiRouter.patch('/events/:id/cancel', auth, async (req, res) => {
    const methodName = 'cancelEvent';
    logMethodEntry(methodName, { params: req.params });
    
    try {
        const event = await Event.findById(req.params.id);
        if (!event) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Check if the user owns this booking
        if (event.userId.toString() !== req.user.userId) {
            return res.status(403).json({ error: 'You can only cancel your own bookings' });
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

// Get user's bookings
apiRouter.get('/events/my-bookings', auth, async (req, res) => {
    const methodName = 'getMyBookings';
    logMethodEntry(methodName, { user: req.user });
    
    try {
        const events = await Event.find({ 
            userId: req.user.userId,
            date: { $gte: new Date() } // Only future bookings
        }).sort({ date: 1, time: 1 }); // Sort by date and time
        
        logMethodExit(methodName, events);
        res.json(events);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to get booking config with defaults
function getBookingConfig(resource) {
    return {
        duration: resource.slot_length || 60,
        startTime: resource.earliest || '09:00',
        endTime: resource.latest || '17:00'
    };
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
apiRouter.get('/availability', auth, async (req, res) => {
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

        // Get existing bookings with user info
        const bookings = await Event.find({
            resourceId,
            date: new Date(date)
        }).populate('userId', 'email');

        // Filter confirmed bookings for availability check
        const confirmedBookings = bookings.filter(booking => booking.status === 'confirmed');

        // Get booking configuration with defaults
        const bookingConfig = getBookingConfig(resource);
        console.log('Using booking config:', bookingConfig);

        // Generate time slots based on resource configuration
        const timeSlots = generateTimeSlots(
            bookingConfig.startTime,
            bookingConfig.endTime,
            bookingConfig.duration
        );

        // Mark which slots are available and add booking info
        const availability = timeSlots.map(time => {
            const booking = bookings.find(b => b.time === time);
            return {
                time,
                isAvailable: !confirmedBookings.some(b => b.time === time),
                booking: booking ? {
                    id: booking._id,
                    userId: booking.userId?._id,
                    userEmail: booking.userEmail,
                    status: booking.status
                } : null
            };
        });

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
