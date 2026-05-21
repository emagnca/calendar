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
const { sendEmail } = require('../utils/messenger');

const JWT_SECRET = 'test-secret';

async function createUser(overrides = {}) {
    return User.create({
        email:    'user@test.se',
        name:     'Test User',
        role:     'user',
        groups:   [{ name: 'testgroup', role: 'user' }],
        isActive: true,
        ...overrides,
    });
}

beforeEach(async () => {
    await Group.create({ name: 'testgroup', public: false });
});

describe('POST /send-login-code', () => {
    it('returns 404 for unknown email', async () => {
        const res = await request(app)
            .post('/send-login-code')
            .send({ email: 'nobody@test.se' });
        expect(res.status).toBe(404);
    });

    it('sends a code and returns 200 for existing user', async () => {
        await createUser();
        const res = await request(app)
            .post('/send-login-code')
            .send({ email: 'user@test.se' });
        expect(res.status).toBe(200);
        expect(sendEmail).toHaveBeenCalledWith(
            'user@test.se',
            expect.stringContaining('inloggningskod'),
            expect.any(String)
        );
    });
});

describe('POST /login', () => {
    it('rejects invalid code', async () => {
        await createUser();
        await request(app).post('/send-login-code').send({ email: 'user@test.se' });
        const res = await request(app)
            .post('/login')
            .send({ email: 'user@test.se', code: '000000' });
        expect(res.status).toBe(401);
    });

    it('returns a JWT on correct code', async () => {
        await createUser();
        await request(app).post('/send-login-code').send({ email: 'user@test.se' });

        const user = await User.findOne({ email: 'user@test.se' });
        const res = await request(app)
            .post('/login')
            .send({ email: 'user@test.se', code: user.loginCode });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        const payload = jwt.verify(res.body.token, JWT_SECRET);
        expect(payload.email).toBe('user@test.se');
    });

    it('clears the login code after use', async () => {
        await createUser();
        await request(app).post('/send-login-code').send({ email: 'user@test.se' });
        const { loginCode } = await User.findOne({ email: 'user@test.se' });

        await request(app).post('/login').send({ email: 'user@test.se', code: loginCode });

        const user = await User.findOne({ email: 'user@test.se' });
        expect(user.loginCode).toBeUndefined();
    });

    it('rejects an expired code', async () => {
        const user = await createUser();
        user.loginCode       = '123456';
        user.loginCodeExpiry = new Date(Date.now() - 1000); // already expired
        await user.save();

        const res = await request(app)
            .post('/login')
            .send({ email: 'user@test.se', code: '123456' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/expired/i);
    });
});

describe('GET /users/me', () => {
    it('returns 401 without token', async () => {
        const res = await request(app).get('/users/me');
        expect(res.status).toBe(401);
    });

    it('returns user data with valid token', async () => {
        const user = await createUser();
        const token = jwt.sign(
            { _id: user._id, email: user.email, role: user.role, groups: user.groups },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        const res = await request(app)
            .get('/users/me')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('user@test.se');
        expect(res.body.loginCode).toBeUndefined(); // must be stripped
    });
});
