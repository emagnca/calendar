'use strict';

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { logMethodEntry, logMethodExit } = require('./utils/logger');
const { sendEmail } = require('./utils/messenger');

const Resource = require('./models/Resource');
const Event = require('./models/Event');
const User = require('./models/User');
const Group = require('./models/Group');
const auth = require('./middleware/auth');

class ApiCalendar {

    // ── Middleware ────────────────────────────────────────────────────────────

    groupAccess = async (req, res, next) => {
        const groupName = (req.query.group || '').toLowerCase();
        if (!groupName) return res.status(400).json({ error: 'group parameter required' });

        const group = await Group.findOne({ name: groupName });
        if (!group) return res.status(404).json({ error: 'Group not found' });

        if (!group.public) {
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
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    getBookingConfig = (resource) => ({
        duration: resource.slot_length || 60,
        startTime: resource.earliest || '09:00',
        endTime: resource.latest || '17:00'
    });

    generateTimeSlots = (startTime, endTime, duration) => {
        const slots = [];
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const start = sh * 60 + sm;
        const end   = eh * 60 + em;
        for (let t = start; t < end; t += duration) {
            slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
        }
        return slots;
    };

    // ── Routes ────────────────────────────────────────────────────────────────

    expose = (app) => {
        const router = express.Router();

        // Auth
        router.post('/register', async (req, res) => {
            const methodName = 'register';
            logMethodEntry(methodName, { body: req.body });
            try {
                const { email, password, name } = req.body;
                const existingUser = await User.findOne({ email });
                if (existingUser) return res.status(400).json({ error: 'Email already registered' });

                const user = new User({ email, password, name });
                await user.save();
                const token = jwt.sign({ _id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
                logMethodExit(methodName, { userId: user._id });
                res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name } });
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(400).json({ error: error.message });
            }
        });

        router.post('/send-login-code', async (req, res) => {
            const methodName = 'send-login-code';
            logMethodEntry(methodName, { body: req.body });
            try {
                const { email } = req.body;
                const user = await User.findOne({ email });
                if (!user) return res.status(404).json({ error: 'No account found with that email' });

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

        router.post('/login', async (req, res) => {
            const methodName = 'login';
            logMethodEntry(methodName, { body: req.body });
            try {
                const { email, code } = req.body;
                const user = await User.findOne({ email });
                if (!user) return res.status(401).json({ error: 'Invalid credentials' });
                if (!user.loginCode || user.loginCode !== code) return res.status(401).json({ error: 'Invalid or expired code' });
                if (!user.loginCodeExpiry || user.loginCodeExpiry < new Date()) return res.status(401).json({ error: 'Code has expired' });

                user.loginCode = undefined;
                user.loginCodeExpiry = undefined;
                await user.save();
                const token = jwt.sign({ _id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
                logMethodExit(methodName, { userId: user._id });
                res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(400).json({ error: error.message });
            }
        });

        // Groups
        router.get('/groups/:name', async (req, res) => {
            try {
                const group = await Group.findOne({ name: req.params.name.toLowerCase() });
                if (!group) return res.status(404).json({ error: 'Group not found' });
                res.json(group);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/groups', async (req, res) => {
            try {
                const group = new Group(req.body);
                await group.save();
                res.status(201).json(group);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // Resources
        router.get('/resources', this.groupAccess, async (req, res) => {
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

        router.post('/resources', auth, async (req, res) => {
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

        // Events — my-bookings must be before /:id/cancel to avoid route shadowing
        router.get('/events/my-bookings', this.groupAccess, auth, async (req, res) => {
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

        router.get('/events', this.groupAccess, async (req, res) => {
            const methodName = 'getEvents';
            logMethodEntry(methodName, { query: req.query });
            try {
                const { startDate, endDate, resourceId } = req.query;
                const query = { status: 'confirmed', group: req.group.name };
                if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
                if (resourceId) query.resourceId = resourceId;
                const events = await Event.find(query);
                logMethodExit(methodName, events);
                res.json(events);
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/events', this.groupAccess, auth, async (req, res) => {
            const methodName = 'createEvent';
            logMethodEntry(methodName, { body: req.body });
            try {
                const bookingDate = new Date(req.body.date);
                bookingDate.setHours(0, 0, 0, 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (bookingDate < today) {
                    return res.status(400).json({ error: 'Cannot book events in the past' });
                }
                if (bookingDate.getTime() === today.getTime() && req.body.time) {
                    const [h, m] = req.body.time.split(':').map(Number);
                    const slotMinutes = h * 60 + m;
                    const now = new Date();
                    const nowMinutes = now.getHours() * 60 + now.getMinutes();
                    if (slotMinutes <= nowMinutes) {
                        return res.status(400).json({ error: 'Cannot book a time slot that has already passed' });
                    }
                }

                const resource = await Resource.findOne({ resourceId: req.body.resourceId });
                if (!resource) return res.status(404).json({ error: 'Resource not found' });

                const existingBooking = await Event.findOne({
                    resourceId: req.body.resourceId,
                    date: new Date(req.body.date),
                    time: req.body.time,
                    status: 'confirmed'
                });
                if (existingBooking) return res.status(409).json({ error: 'Time slot is already booked' });

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
                await event.save();
                logMethodExit(methodName, event);
                res.status(201).json(event);
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(400).json({ error: error.message });
            }
        });

        router.patch('/events/:id/cancel', this.groupAccess, auth, async (req, res) => {
            const methodName = 'cancelEvent';
            logMethodEntry(methodName, { params: req.params });
            try {
                const event = await Event.findById(req.params.id);
                if (!event) return res.status(404).json({ error: 'Booking not found' });
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

        // Availability
        router.get('/availability', this.groupAccess, async (req, res) => {
            const methodName = 'checkAvailability';
            logMethodEntry(methodName, { query: req.query });
            try {
                const { date, resourceId } = req.query;
                if (!date || !resourceId) return res.status(400).json({ error: 'date and resourceId are required' });

                const resource = await Resource.findOne({ resourceId, group: req.group.name });
                if (!resource) return res.status(404).json({ error: 'Resource not found' });

                const bookings = await Event.find({
                    resourceId,
                    group: req.group.name,
                    date: new Date(date)
                }).populate('userId', 'email');

                const confirmedBookings = bookings.filter(b => b.status === 'confirmed');
                const bookingConfig = this.getBookingConfig(resource);
                const timeSlots = this.generateTimeSlots(bookingConfig.startTime, bookingConfig.endTime, bookingConfig.duration);

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
                        bookingConfig
                    },
                    availability
                });
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(500).json({ error: error.message });
            }
        });

        app.use('/api', router);

        // Serve SPA for /<groupname> routes
        app.get('/:group', async (req, res, next) => {
            const groupName = req.params.group.toLowerCase();
            const group = await Group.findOne({ name: groupName });
            if (!group) return next();
            res.sendFile(path.join(__dirname, '../client/index.html'));
        });
    };
}

module.exports = ApiCalendar;
