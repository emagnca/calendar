'use strict';

jest.mock('../utils/messenger', () => ({
    sendEmail: jest.fn().mockResolvedValue(undefined),
    sendSms:   jest.fn().mockResolvedValue(undefined),
}));

const request             = require('supertest');
const { app }             = require('../handler');
const Group               = require('../models/Group');
const User                = require('../models/User');
const GroupRegistration   = require('../models/GroupRegistration');

const VALID_BODY = {
    groupName:  'newgroup',
    adminName:  'Alice',
    adminEmail: 'alice@test.se',
    adminPhone: '0701234567',
    isPublic:   false,
};

describe('POST /group-registration', () => {
    it('creates a pending registration and returns a token', async () => {
        const res = await request(app).post('/group-registration').send(VALID_BODY);
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();

        const reg = await GroupRegistration.findOne({ groupName: 'newgroup' });
        expect(reg).not.toBeNull();
        expect(reg.status).toBe('pending');
        expect(reg.regToken).toBe(res.body.token);
    });

    it('rejects missing fields', async () => {
        const res = await request(app).post('/group-registration').send({ groupName: 'x' });
        expect(res.status).toBe(400);
    });

    it('rejects duplicate group name (existing group)', async () => {
        await Group.create({ name: 'newgroup', public: false });
        const res = await request(app).post('/group-registration').send(VALID_BODY);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/taken/i);
    });

    it('rejects duplicate pending registration for the same group', async () => {
        await request(app).post('/group-registration').send(VALID_BODY);
        const res = await request(app).post('/group-registration').send(VALID_BODY);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/pending/i);
    });
});

describe('POST /group-registration/confirm', () => {
    let token, reg;

    beforeEach(async () => {
        const res = await request(app).post('/group-registration').send(VALID_BODY);
        token = res.body.token;
        reg   = await GroupRegistration.findOne({ regToken: token });
    });

    it('confirms with correct codes and creates the group + user', async () => {
        const res = await request(app).post('/group-registration/confirm').send({
            token,
            emailCode: reg.emailCode,
            smsCode:   reg.smsCode,
        });
        expect(res.status).toBe(200);

        const group = await Group.findOne({ name: 'newgroup' });
        expect(group).not.toBeNull();

        const user = await User.findOne({ email: 'alice@test.se' });
        expect(user).not.toBeNull();
        expect(user.groups.some(g => g.name === 'newgroup' && g.role === 'admin')).toBe(true);

        const updated = await GroupRegistration.findOne({ regToken: token });
        expect(updated.status).toBe('complete');
    });

    it('rejects wrong email code', async () => {
        const res = await request(app).post('/group-registration/confirm').send({
            token,
            emailCode: '000000',
            smsCode:   reg.smsCode,
        });
        expect(res.status).toBe(400);
        expect(res.body.error.email).toMatch(/felaktig/i);
    });

    it('rejects wrong sms code', async () => {
        const res = await request(app).post('/group-registration/confirm').send({
            token,
            emailCode: reg.emailCode,
            smsCode:   '000000',
        });
        expect(res.status).toBe(400);
        expect(res.body.error.sms).toMatch(/felaktig/i);
    });

    it('rejects invalid token', async () => {
        const res = await request(app).post('/group-registration/confirm').send({
            token:     'bad-token',
            emailCode: reg.emailCode,
            smsCode:   reg.smsCode,
        });
        expect(res.status).toBe(404);
    });
});

describe('POST /group-registration/resume', () => {
    it('resends codes and returns the existing token', async () => {
        const initRes = await request(app).post('/group-registration').send(VALID_BODY);
        const originalToken = initRes.body.token;

        const res = await request(app)
            .post('/group-registration/resume')
            .send({ adminEmail: VALID_BODY.adminEmail });
        expect(res.status).toBe(200);
        expect(res.body.token).toBe(originalToken);
    });

    it('returns 404 for unknown email', async () => {
        const res = await request(app)
            .post('/group-registration/resume')
            .send({ adminEmail: 'nobody@test.se' });
        expect(res.status).toBe(404);
    });
});
