'use strict';

jest.mock('../utils/messenger', () => ({
    sendEmail: jest.fn().mockResolvedValue(undefined),
    sendSms:   jest.fn().mockResolvedValue(undefined),
}));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const { app }  = require('../handler');
const User     = require('../models/User');
const Group    = require('../models/Group');
const Resource = require('../models/Resource');
const Event    = require('../models/Event');

const JWT_SECRET   = 'test-secret';
const GROUP_NAME   = 'testgroup';
const RESOURCE_ID  = 'room-1';

// Tomorrow in local time — avoids UTC offset shifting the date back to today
function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

async function seedDb() {
    const group = await Group.create({ name: GROUP_NAME, public: false });
    const user  = await User.create({
        email:    'booker@test.se',
        name:     'Booker',
        role:     'user',
        groups:   [{ name: GROUP_NAME, role: 'user' }],
        isActive: true,
    });
    await Resource.create({
        resourceId:   RESOURCE_ID,
        name:         { sv: 'Rum 1', en: 'Room 1' },
        isActive:     true,
        slot_length:  60,
        earliest:     '08:00',
        latest:       '18:00',
        capacity:     2,
        group:        GROUP_NAME,
    });
    return { group, user };
}

function makeToken(user) {
    return jwt.sign(
        { _id: user._id, email: user.email, role: user.role, groups: user.groups },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
}

describe('POST /events', () => {
    it('creates a booking for an authenticated user', async () => {
        const { user } = await seedDb();
        const token = makeToken(user);

        const res = await request(app)
            .post('/events')
            .query({ group: GROUP_NAME })
            .set('Authorization', `Bearer ${token}`)
            .send({ resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' });

        expect(res.status).toBe(201);
        expect(res.body.resourceId).toBe(RESOURCE_ID);

        const event = await Event.findById(res.body._id);
        expect(event).not.toBeNull();
        expect(event.status).toBe('confirmed');
    });

    it('returns 401 without a token', async () => {
        await seedDb();
        const res = await request(app)
            .post('/events')
            .query({ group: GROUP_NAME })
            .send({ resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' });
        expect(res.status).toBe(401);
    });

    it('rejects double-booking the same slot by the same user', async () => {
        const { user } = await seedDb();
        const token = makeToken(user);
        const body = { resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' };

        await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${token}`).send(body);
        const res = await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${token}`).send(body);

        expect(res.status).toBe(409);
    });

    it('allows two different users to book the same slot when capacity=2', async () => {
        const { user } = await seedDb();
        const user2 = await User.create({
            email:    'other@test.se',
            name:     'Other',
            role:     'user',
            groups:   [{ name: GROUP_NAME, role: 'user' }],
            isActive: true,
        });

        const body = { resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' };
        const r1 = await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${makeToken(user)}`).send(body);
        const r2 = await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${makeToken(user2)}`).send(body);

        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);
    });

    it('rejects booking when slot is fully booked', async () => {
        const { user } = await seedDb();
        const u2 = await User.create({ email: 'u2@test.se', name: 'U2', role: 'user', groups: [{ name: GROUP_NAME, role: 'user' }], isActive: true });
        const u3 = await User.create({ email: 'u3@test.se', name: 'U3', role: 'user', groups: [{ name: GROUP_NAME, role: 'user' }], isActive: true });

        const body = { resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' };
        await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${makeToken(user)}`).send(body);
        await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${makeToken(u2)}`).send(body);
        const res = await request(app).post('/events').query({ group: GROUP_NAME }).set('Authorization', `Bearer ${makeToken(u3)}`).send(body);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/fully booked/i);
    });
});

describe('PATCH /events/:id/cancel', () => {
    it('allows a user to cancel their own booking', async () => {
        const { user } = await seedDb();
        const token = makeToken(user);

        const book = await request(app)
            .post('/events')
            .query({ group: GROUP_NAME })
            .set('Authorization', `Bearer ${token}`)
            .send({ resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' });

        const cancel = await request(app)
            .patch(`/events/${book.body._id}/cancel`)
            .set('Authorization', `Bearer ${token}`)
            .query({ group: GROUP_NAME });

        expect(cancel.status).toBe(200);
        const event = await Event.findById(book.body._id);
        expect(event).toBeNull(); // cancel deletes the booking
    });

    it('prevents a user from cancelling someone else\'s booking', async () => {
        const { user } = await seedDb();
        const other = await User.create({
            email:    'other@test.se',
            name:     'Other',
            role:     'user',
            groups:   [{ name: GROUP_NAME, role: 'user' }],
            isActive: true,
        });

        const book = await request(app)
            .post('/events')
            .query({ group: GROUP_NAME })
            .set('Authorization', `Bearer ${makeToken(user)}`)
            .send({ resourceId: RESOURCE_ID, date: tomorrowStr(), time: '10:00' });

        const cancel = await request(app)
            .patch(`/events/${book.body._id}/cancel`)
            .set('Authorization', `Bearer ${makeToken(other)}`)
            .query({ group: GROUP_NAME });

        expect(cancel.status).toBe(403);
    });
});
