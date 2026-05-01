'use strict';


const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { logMethodEntry, logMethodExit } = require('./utils/logger');
const { sendEmail, sendSms } = require('./utils/messenger');
const { getSecret } = require('./utils/utils');

const crypto = require('crypto');
const fs = require('fs');
const clientRoot = fs.existsSync(path.join(__dirname, 'client'))
    ? path.join(__dirname, 'client')
    : path.join(__dirname, '../client');

const Resource = require('./models/Resource');
const Event = require('./models/Event');
const User = require('./models/User');
const Group = require('./models/Group');
const GroupRegistration = require('./models/GroupRegistration');
const PublicUser = require('./models/PublicUser');
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
        // Public group — decode JWT if present (public or private user), but don't require it
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (token) {
            try {
                const jwtSecret = await getSecret('cal_jwt_secret');
                req.user = jwt.verify(token, jwtSecret.secret || jwtSecret);
            } catch (_) { /* invalid/expired token — treat as anonymous */ }
        }
        req.group = group;
        next();
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    getBookingConfig = (resource) => ({
        duration: resource.slot_length || 60,
        startTime: resource.earliest || '09:00',
        endTime: resource.latest || '17:00',
        bookableDays: resource.bookableDays && resource.bookableDays.length ? resource.bookableDays : [0,1,2,3,4,5,6]
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Called when both email and SMS are confirmed
    async finalizeRegistration(reg) {
        const existing = await Group.findOne({ name: reg.groupName });
        if (!existing) {
            await Group.create({
                name:       reg.groupName,
                public:     reg.isPublic || false,
                adminName:  reg.adminName,
                adminEmail: reg.adminEmail,
                adminPhone: reg.adminPhone
            });
        }
        const existingUser = await User.findOne({ email: reg.adminEmail });
        if (!existingUser) {
            const user = new User({
                email:   reg.adminEmail,
                name:    reg.adminName,
                group:   reg.groupName,
                role:    'admin',
                isActive: true
            });
            await user.save();
        }
        reg.status = 'complete';
        await reg.save();
    }

    // ── Routes ────────────────────────────────────────────────────────────────

    expose = (app) => {
        const router = express.Router();

        // Group self-registration
        router.post('/group-registration', async (req, res) => {
            try {
                const { groupName, adminName, adminEmail, adminPhone, isPublic } = req.body;
                if (!groupName || !adminName || !adminEmail || !adminPhone)
                    return res.status(400).json({ error: 'All fields are required' });

                const name = groupName.trim().toLowerCase().replace(/\s+/g, '-');
                if (await Group.findOne({ name }))
                    return res.status(400).json({ error: 'Group name already taken' });
                if (await GroupRegistration.findOne({ groupName: name, status: 'pending' }))
                    return res.status(400).json({ error: 'A pending registration already exists for this group' });

                const regToken  = crypto.randomBytes(16).toString('hex');
                const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
                const smsCode   = Math.floor(100000 + Math.random() * 900000).toString();

                await GroupRegistration.create({
                    groupName: name, adminName, adminEmail, adminPhone,
                    isPublic: !!isPublic, regToken, emailCode, smsCode
                });

                await sendEmail(
                    adminEmail,
                    `Din verifieringskod för EasyBooking är: <strong>${emailCode}</strong>`,
                    'Din verifieringskod – EasyBooking'
                ).catch(e => console.warn('sendEmail failed (non-fatal):', e.message));
                await sendSms(adminPhone, 'EasyBooking', `Din verifieringskod är: ${smsCode}`)
                    .catch(e => console.warn('sendSms failed (non-fatal):', e.message));

                res.json({ token: regToken });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        router.post('/group-registration/confirm', async (req, res) => {
            try {
                const { token, emailCode, smsCode } = req.body;
                const reg = await GroupRegistration.findOne({ regToken: token, status: 'pending' });
                if (!reg) return res.status(404).json({ error: 'Invalid or expired token' });

                const errors = {};
                if (reg.emailCode !== emailCode) errors.email = 'Felaktig e-postkod';
                if (reg.smsCode   !== smsCode)   errors.sms   = 'Felaktig SMS-kod';
                if (Object.keys(errors).length)  return res.status(400).json({ error: errors });

                await this.finalizeRegistration(reg);
                const adminUser = await User.findOne({ email: reg.adminEmail });
                const jwtSecret = await getSecret('cal_jwt_secret');
                const adminToken = jwt.sign(
                    { _id: adminUser._id, email: adminUser.email, role: adminUser.role, group: adminUser.group },
                    jwtSecret.secret || jwtSecret,
                    { expiresIn: '24h' }
                );
                res.json({ groupName: reg.groupName, adminToken });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        // Health
        router.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                platform: process.env.CAL_PLATFORM || 'local',
                timestamp: new Date().toISOString()
            });
        });

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
                const jwtSecret = await getSecret('cal_jwt_secret');
                const token = jwt.sign({ _id: user._id, email: user.email, role: user.role }, jwtSecret.secret || jwtSecret, { expiresIn: '24h' });
                logMethodExit(methodName, { userId: user._id });
                res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
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
                await sendEmail(email, `Din inloggningskod är: <strong>${code}</strong>`, 'Din inloggningskod')
                    .catch(e => console.warn('sendEmail failed (non-fatal):', e.message));
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
                const jwtSecret = await getSecret('cal_jwt_secret');
                const token = jwt.sign({ _id: user._id, email: user.email, role: user.role }, jwtSecret.secret || jwtSecret, { expiresIn: '24h' });
                logMethodExit(methodName, { userId: user._id });
                res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(400).json({ error: error.message });
            }
        });

        // Public calendar self-auth (no admin pre-registration required)
        router.post('/public-auth/send-code', async (req, res) => {
            try {
                const { name, email, group } = req.body;
                if (!name || !email || !group) return res.status(400).json({ error: 'name, email and group are required' });
                const grp = await Group.findOne({ name: group.toLowerCase() });
                if (!grp || !grp.public) return res.status(403).json({ error: 'Group not found or not public' });

                const code = Math.floor(100000 + Math.random() * 900000).toString();
                await PublicUser.findOneAndUpdate(
                    { email: email.toLowerCase(), group: group.toLowerCase() },
                    { name: name.trim(), loginCode: code, loginCodeExpiry: new Date(Date.now() + 10 * 60 * 1000), lastSeen: new Date() },
                    { upsert: true, new: true }
                );
                await sendEmail(email, `Din inloggningskod är: <strong>${code}</strong>`, 'Din inloggningskod')
                    .catch(e => console.warn('sendEmail failed (non-fatal):', e.message));
                res.json({ message: 'Code sent' });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        router.post('/public-auth/verify-code', async (req, res) => {
            try {
                const { email, code, group } = req.body;
                if (!email || !code || !group) return res.status(400).json({ error: 'email, code and group are required' });
                const pu = await PublicUser.findOne({ email: email.toLowerCase(), group: group.toLowerCase() });
                if (!pu) return res.status(401).json({ error: 'No pending login for this email' });
                if (!pu.loginCode || pu.loginCode !== code) return res.status(401).json({ error: 'Invalid code' });
                if (!pu.loginCodeExpiry || pu.loginCodeExpiry < new Date()) return res.status(401).json({ error: 'Code has expired' });

                pu.loginCode = undefined;
                pu.loginCodeExpiry = undefined;
                pu.lastSeen = new Date();
                await pu.save();

                const jwtSecret = await getSecret('cal_jwt_secret');
                const token = jwt.sign(
                    { email: pu.email, name: pu.name, group: pu.group, isPublic: true, role: 'user' },
                    jwtSecret.secret || jwtSecret,
                    { expiresIn: '30d' }
                );
                res.json({ token, user: { email: pu.email, name: pu.name, group: pu.group, isPublic: true } });
            } catch (e) { res.status(500).json({ error: e.message }); }
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
                const events = await Event.find(query).select('-userId -userEmail');
                logMethodExit(methodName, events);
                res.json(events);
            } catch (error) {
                console.error(`Error in ${methodName}:`, error);
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/events', this.groupAccess, async (req, res) => {
            const methodName = 'createEvent';
            logMethodEntry(methodName, { body: req.body });
            if (!req.user) return res.status(401).json({ error: 'Authentication required' });
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

                const bookableDays = resource.bookableDays && resource.bookableDays.length ? resource.bookableDays : [0,1,2,3,4,5,6];
                if (!bookableDays.includes(new Date(req.body.date).getDay())) {
                    return res.status(400).json({ error: 'Resource is not bookable on this day' });
                }

                const bookingCount = await Event.countDocuments({
                    resourceId: req.body.resourceId,
                    date: new Date(req.body.date),
                    time: req.body.time,
                    status: 'confirmed'
                });
                if (bookingCount >= (resource.capacity || 1)) {
                    return res.status(409).json({ error: 'Time slot is fully booked' });
                }

                const userId = req.user ? (req.user._id || req.user.userId) : null;
                const userEmail = req.user ? req.user.email : null;
                if (userId || userEmail) {
                    const userFilter = {
                        resourceId: req.body.resourceId,
                        date: new Date(req.body.date),
                        time: req.body.time,
                        status: 'confirmed',
                        ...(userId ? { userId } : { userEmail })
                    };
                    const alreadyBooked = await Event.exists(userFilter);
                    if (alreadyBooked) {
                        return res.status(409).json({ error: 'You have already booked this time slot' });
                    }
                }

                const event = new Event({
                    resourceId: req.body.resourceId,
                    resourceName: resource.name,
                    userId: (req.user && (req.user._id || req.user.userId)) ? (req.user._id || req.user.userId) : null,
                    userEmail: req.user ? req.user.email : null,
                    bookerName: (req.user && req.user.isPublic) ? req.user.name : null,
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
                const role = req.user.role || 'user';

                if (role === 'superadmin') {
                    // can cancel any booking
                } else if (role === 'admin') {
                    // can cancel any booking within their group
                    if (event.group !== req.group.name) {
                        return res.status(403).json({ error: 'Admins can only cancel bookings within their group' });
                    }
                } else {
                    // regular user: own bookings only
                    if (event.userId.toString() !== userIdFromToken.toString()) {
                        return res.status(403).json({ error: 'You can only cancel your own bookings' });
                    }
                }

                await event.deleteOne();
                logMethodExit(methodName, { id: req.params.id });
                res.json({ message: 'Booking removed' });
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

                const bookingConfig = this.getBookingConfig(resource);
                const requestedDay = new Date(date).getDay();
                if (!bookingConfig.bookableDays.includes(requestedDay)) {
                    return res.json({ resource: { name: resource.name, description: resource.description, bookingConfig }, availability: [], notBookableDay: true });
                }

                const bookings = await Event.find({
                    resourceId,
                    group: req.group.name,
                    date: new Date(date)
                }).populate('userId', 'email');

                const capacity = resource.capacity || 1;
                const timeSlots = this.generateTimeSlots(bookingConfig.startTime, bookingConfig.endTime, bookingConfig.duration);

                const availability = timeSlots.map(time => {
                    const slotBookings = bookings.filter(b => b.time === time);
                    const spotsLeft = capacity - slotBookings.length;
                    return {
                        time,
                        isAvailable: spotsLeft > 0,
                        spotsLeft,
                        capacity,
                        bookings: slotBookings.map(b => ({
                            id: b._id,
                            userId: b.userId?._id,
                            userEmail: b.userEmail,
                            bookerName: b.bookerName,
                            status: b.status
                        }))
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

        // ── Admin API ─────────────────────────────────────────────────────────

        const requireRole = (...roles) => async (req, res, next) => {
            await auth(req, res, async () => {
                if (!req.user) return res.status(401).json({ error: 'Authentication required' });
                const user = await User.findById(req.user._id || req.user.userId);
                if (!user) return res.status(401).json({ error: 'User not found' });
                if (!roles.includes(user.role)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                req.adminUser = user;
                next();
            });
        };

        const adminGroupScope = async (req, res, next) => {
            // Resolves which group this admin can operate on
            const groupName = (req.query.group || req.body.group || '').toLowerCase();
            if (!groupName) return res.status(400).json({ error: 'group parameter required' });
            if (req.adminUser.role !== 'superadmin' && req.adminUser.group !== groupName) {
                return res.status(403).json({ error: 'Admins can only manage their own group' });
            }
            const group = await Group.findOne({ name: groupName });
            if (!group) return res.status(404).json({ error: 'Group not found' });
            req.group = group;
            next();
        };

        const adminRouter = express.Router();

        adminRouter.use((req, res, next) => {
            res.on('finish', () => {
                const user = req.adminUser ? `${req.adminUser.email} (${req.adminUser.role})` : 'unauthenticated';
                console.log(`→ admin:${req.method} ${req.path} [${res.statusCode}] — ${user}`);
            });
            next();
        });

        // Groups (superadmin only)
        adminRouter.get('/groups', requireRole('superadmin'), async (req, res) => {
            try {
                const groups = await Group.find().sort('name');
                res.json(groups);
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        adminRouter.post('/groups', requireRole('superadmin'), async (req, res) => {
            try {
                const group = await Group.create({ name: req.body.name.toLowerCase().trim(), public: !!req.body.public });
                res.status(201).json(group);
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.patch('/groups/:name', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const name = req.params.name.toLowerCase();
                if (req.adminUser.role !== 'superadmin' && req.adminUser.group !== name) {
                    return res.status(403).json({ error: 'Admins can only edit their own group' });
                }
                const update = { public: !!req.body.public };
                if (Array.isArray(req.body.languages) && req.body.languages.length) {
                    update.languages = req.body.languages;
                }
                const group = await Group.findOneAndUpdate(
                    { name },
                    update,
                    { new: true }
                );
                if (!group) return res.status(404).json({ error: 'Group not found' });
                res.json(group);
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.delete('/groups/:name', requireRole('superadmin'), async (req, res) => {
            try {
                await Group.deleteOne({ name: req.params.name.toLowerCase() });
                res.json({ message: 'Group deleted' });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        // Resources (admin+)
        adminRouter.get('/resources', requireRole('admin', 'superadmin'), adminGroupScope, async (req, res) => {
            try {
                const resources = await Resource.find({ group: req.group.name }).sort('resourceId');
                res.json(resources);
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        adminRouter.post('/resources', requireRole('admin', 'superadmin'), adminGroupScope, async (req, res) => {
            try {
                let { resourceId } = req.body;
                if (!resourceId) {
                    const name = req.body.name;
                    const raw = (typeof name === 'object' ? (name.en || name.sv) : name) || 'resource';
                    const base = raw.toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9\s-]/g, '').trim()
                        .replace(/\s+/g, '-').replace(/-+/g, '-');
                    resourceId = base;
                    let n = 2;
                    while (await Resource.exists({ resourceId, group: req.group.name })) {
                        resourceId = `${base}-${n++}`;
                    }
                }
                const resource = await Resource.create({ ...req.body, resourceId, group: req.group.name });
                res.status(201).json(resource);
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.put('/resources/:id', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const resource = await Resource.findById(req.params.id);
                if (!resource) return res.status(404).json({ error: 'Resource not found' });
                if (req.adminUser.role !== 'superadmin' && resource.group !== req.adminUser.group) {
                    return res.status(403).json({ error: 'Admins can only edit resources in their group' });
                }
                Object.assign(resource, req.body);
                await resource.save();
                res.json(resource);
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.delete('/resources/:id', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const resource = await Resource.findById(req.params.id);
                if (!resource) return res.status(404).json({ error: 'Resource not found' });
                if (req.adminUser.role !== 'superadmin' && resource.group !== req.adminUser.group) {
                    return res.status(403).json({ error: 'Admins can only delete resources in their group' });
                }
                await resource.deleteOne();
                res.json({ message: 'Resource deleted' });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        // Bookings (admin+)
        adminRouter.get('/events', requireRole('admin', 'superadmin'), adminGroupScope, async (req, res) => {
            try {
                const { startDate, endDate, resourceId } = req.query;
                const query = { group: req.group.name };
                if (startDate) query.date = { $gte: new Date(startDate) };
                if (endDate)   query.date = { ...query.date, $lte: new Date(endDate) };
                if (resourceId) query.resourceId = resourceId;
                const events = await Event.find(query).sort({ date: -1, time: 1 });
                res.json(events);
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        adminRouter.delete('/events/:id', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const event = await Event.findById(req.params.id);
                if (!event) return res.status(404).json({ error: 'Booking not found' });
                if (req.adminUser.role !== 'superadmin' && event.group !== req.adminUser.group) {
                    return res.status(403).json({ error: 'Admins can only delete bookings in their group' });
                }
                await event.deleteOne();
                res.json({ message: 'Booking deleted' });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        // Users (admin+)
        adminRouter.get('/users', requireRole('admin', 'superadmin'), adminGroupScope, async (req, res) => {
            try {
                const users = await User.find({ group: req.group.name }).select('-password -loginCode -loginCodeExpiry').sort('email');
                res.json(users);
            } catch (e) { res.status(500).json({ error: e.message }); }
        });

        adminRouter.post('/users', requireRole('admin', 'superadmin'), adminGroupScope, async (req, res) => {
            try {
                const { email, name, role, password } = req.body;
                if (req.adminUser.role === 'admin' && role === 'superadmin') {
                    return res.status(403).json({ error: 'Admins cannot create superadmins' });
                }
                const user = new User({ email, name, group: req.group.name, role: role || 'user', password: password || undefined });
                await user.save();
                res.status(201).json({ _id: user._id, email: user.email, name: user.name, role: user.role, group: user.group, isActive: user.isActive });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.put('/users/:id', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const user = await User.findById(req.params.id);
                if (!user) return res.status(404).json({ error: 'User not found' });
                if (req.adminUser.role !== 'superadmin' && user.group !== req.adminUser.group) {
                    return res.status(403).json({ error: 'Admins can only edit users in their group' });
                }
                if (req.adminUser.role === 'admin' && req.body.role === 'superadmin') {
                    return res.status(403).json({ error: 'Admins cannot assign superadmin role' });
                }
                const { email, name, role, isActive, password } = req.body;
                if (email) user.email = email;
                if (name)  user.name  = name;
                if (role)  user.role  = role;
                if (isActive !== undefined) user.isActive = isActive;
                if (password) user.password = password;
                await user.save();
                res.json({ _id: user._id, email: user.email, name: user.name, role: user.role, group: user.group, isActive: user.isActive });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        adminRouter.delete('/users/:id', requireRole('admin', 'superadmin'), async (req, res) => {
            try {
                const user = await User.findById(req.params.id);
                if (!user) return res.status(404).json({ error: 'User not found' });
                if (req.adminUser.role !== 'superadmin' && user.group !== req.adminUser.group) {
                    return res.status(403).json({ error: 'Admins can only delete users in their group' });
                }
                await user.deleteOne();
                res.json({ message: 'User deleted' });
            } catch (e) { res.status(400).json({ error: e.message }); }
        });

        app.use(router);
        app.use('/api/admin', adminRouter);

        // Serve landing page at root
        app.get('/', (req, res) => {
            res.sendFile(path.join(clientRoot, 'index.html'));
        });

        // Serve group registration page
        app.get('/register', (req, res) => {
            res.sendFile(path.join(clientRoot, 'register/index.html'));
        });
        app.get('/register/confirm-email', (req, res) => {
            res.sendFile(path.join(clientRoot, 'register/index.html'));
        });

        // Serve SPA for /<groupname> routes
        app.get('/:group', async (req, res, next) => {
            const groupName = req.params.group.toLowerCase();
            if (groupName === 'admin') return next();
            const group = await Group.findOne({ name: groupName });
            if (!group) return next();
            res.sendFile(path.join(clientRoot, 'index.html'));
        });

        // Serve admin SPA
        app.get('/admin/:group', (req, res) => {
            res.sendFile(path.join(clientRoot, 'admin/index.html'));
        });
    };
}

module.exports = ApiCalendar;
