const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { logMethodEntry, logMethodExit } = require('./utils/logger');
const { sendEmail } = require('./utils/messenger');

const Resource = require('./models/Resource');
const Event = require('./models/Event');
const User = require('./models/User');
const Group = require('./models/Group');
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

// Serve client static files
app.use(express.static(path.join(__dirname, '../client')));

// Serve SPA for /<groupname> routes
app.get('/:group', async (req, res, next) => {
    const groupName = req.params.group.toLowerCase();
    const group = await Group.findOne({ name: groupName });
    if (!group) return next();
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

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
            { _id: user._id, email: user.email },
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

apiRouter.post('/send-login-code', async (req, res) => {
    const methodName = 'send-login-code';
    logMethodEntry(methodName, { body: req.body });

    try {
        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'No account found with that email' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.loginCode = code;
        user.loginCodeExpiry = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();

        await sendEmail(email, `Din inloggningskod är: <strong>${code}</strong>`, 'Din inloggningskod');

        logMethodExit(methodName, { userId: user._id });
        res.json({ message: 'Code sent' });
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/login', async (req, res) => {
    const methodName = 'login';
    logMethodEntry(methodName, { body: req.body });
    
    try {
        const { email, code } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.loginCode || user.loginCode !== code) {
            return res.status(401).json({ error: 'Invalid or expired code' });
        }

        if (!user.loginCodeExpiry || user.loginCodeExpiry < new Date()) {
            return res.status(401).json({ error: 'Code has expired' });
        }

        user.loginCode = undefined;
        user.loginCodeExpiry = undefined;
        await user.save();
        
        const token = jwt.sign(
            { _id: user._id, email: user.email },
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

// Group middleware: resolves group from query param and enforces access
async function groupAccess(req, res, next) {
    const groupName = (req.query.group || '').toLowerCase();
    if (!groupName) return res.status(400).json({ error: 'group parameter required' });

    const group = await Group.findOne({ name: groupName });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    if (!group.public) {
        // Private group: require auth and group membership
        return auth(req, res, async () => {
            if (!req.user) return res.status(401).json({ error: 'Authentication required' });
            const user = await User.findById(req.user._id || req.user.userId);
            if (!user || user.group !== groupName) {
                return res.status(403).json({ error: 'Not a member of this group' });
            }
            req.group = group;
            next();
        });
    }
    req.group = group;
    next();
}

// Group endpoints
apiRouter.get('/groups/:name', async (req, res) => {
    try {
        const group = await Group.findOne({ name: req.params.name.toLowerCase() });
        if (!group) return res.status(404).json({ error: 'Group not found' });
        res.json(group);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/groups', async (req, res) => {
    try {
        const group = new Group(req.body);
        await group.save();
        res.status(201).json(group);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Resource endpoints
apiRouter.get('/resources', groupAccess, async (req, res) => {
    const methodName = 'getResources';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const resources = await Resource.find({ isActive: true, group: req.group.name });
        logMethodExit(methodName, resources);
        res.json(resources);
    } catch (error) {
        console.error(`Error in ${methodName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/resources', auth, async (req, res) => {
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
apiRouter.get('/events', groupAccess, async (req, res) => {
    const methodName = 'getEvents';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const { startDate, endDate, resourceId } = req.query;
        const query = { status: 'confirmed', group: req.group.name };
        
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

apiRouter.post('/events', groupAccess, auth, async (req, res) => {
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
            resourceName: resource.name,
            userId: req.user._id || req.user.userId,
            userEmail: req.user.email,
            date: new Date(req.body.date),
            time: req.body.time,
            group: req.group.name,
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
apiRouter.patch('/events/:id/cancel', groupAccess, auth, async (req, res) => {
    const methodName = 'cancelEvent';
    logMethodEntry(methodName, { params: req.params });
    
    try {
        const event = await Event.findById(req.params.id);
        if (!event) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Check if the user owns this booking
        const userIdFromToken = req.user._id || req.user.userId;
if (event.userId.toString() !== userIdFromToken.toString()) {
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
apiRouter.get('/events/my-bookings', groupAccess, auth, async (req, res) => {
    const methodName = 'getMyBookings';
    logMethodEntry(methodName, { user: req.user });
    
    try {
        const events = await Event.find({ 
            userId: req.user._id || req.user.userId,
            group: req.group.name,
            date: { $gte: new Date() }
        }).sort({ date: 1, time: 1 });
        
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
apiRouter.get('/availability', groupAccess, async (req, res) => {
    const methodName = 'checkAvailability';
    logMethodEntry(methodName, { query: req.query });
    
    try {
        const { date, resourceId } = req.query;
        
        if (!date || !resourceId) {
            return res.status(400).json({ error: 'Date and resourceId are required' });
        }

        // Get resource configuration
        const resource = await Resource.findOne({ resourceId, group: req.group.name });
        if (!resource) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        // Get existing bookings with user info
        const bookings = await Event.find({
            resourceId,
            group: req.group.name,
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
