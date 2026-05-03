'use strict';

/**
 * Stripe payment middleware
 *
 * Exposes two routes (mounted at /payment in handler.js):
 *   POST /payment/create-intent   – validate slot, create Stripe PaymentIntent
 *   POST /payment/webhook         – receive Stripe events, confirm booking
 *
 * Required secrets (via getSecret / .env):
 *   CAL_STRIPE_SECRET_KEY      – Stripe secret key  (sk_live_… / sk_test_…)
 *   CAL_STRIPE_WEBHOOK_SECRET  – Stripe webhook signing secret (whsec_…)
 *
 * Resource model must have:
 *   price    {Number}  price in smallest currency unit (e.g. öre / cents); 0 = free
 *   currency {String}  ISO 4217 lowercase (default 'sek')
 *
 * Event model must have:
 *   paymentIntentId {String}  Stripe PaymentIntent id
 *   paymentStatus   {String}  'free' | 'pending' | 'paid'
 */

const express       = require('express');
const Stripe        = require('stripe');
const { getSecret } = require('../utils/utils');
const auth          = require('./auth');
const Resource      = require('../models/Resource');
const Event         = require('../models/Event');
const BlockedPeriod = require('../models/BlockedPeriod');

const router = express.Router();

// Lazy-initialised Stripe client
let _stripe = null;
async function getStripe() {
    if (_stripe) return _stripe;
    const key = await getSecret('cal_stripe_secret_key');
    _stripe = Stripe(key.secret || key);
    return _stripe;
}

// ── GET /payment/config ──────────────────────────────────────────────────────
// Public endpoint — returns the Stripe publishable key for Stripe.js initialisation.
router.get('/config', async (req, res) => {
    try {
        const key = await getSecret('cal_stripe_publishable_key');
        res.json({ publishableKey: key.secret || key });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /payment/create-intent ──────────────────────────────────────────────
// Called by the client before showing the Stripe payment form.
// Returns a PaymentIntent client_secret the client uses with Stripe.js.
//
// Body: { group, resourceId, date, time, bookerName }
// Auth: Bearer JWT (same token used for booking)
router.post('/create-intent', auth, async (req, res) => {
    try {
        const { group, resourceId, date, time, bookerName } = req.body;
        if (!group || !resourceId || !date || !time) {
            return res.status(400).json({ error: 'group, resourceId, date and time are required' });
        }

        const resource = await Resource.findOne({ resourceId });
        if (!resource)            return res.status(404).json({ error: 'Resource not found' });
        if (!resource.price || resource.price <= 0)
            return res.status(400).json({ error: 'This resource does not require payment' });

        // Check not blocked
        const bookingDate = new Date(date);
        bookingDate.setHours(0, 0, 0, 0);
        const blocks = await BlockedPeriod.find({
            group,
            startDate: { $lte: bookingDate },
            endDate:   { $gte: bookingDate },
            $or: [{ resourceId: null }, { resourceId }]
        });
        const isBlocked = blocks.some(bp =>
            !bp.startTime || (time >= bp.startTime && time < bp.endTime)
        );
        if (isBlocked)
            return res.status(409).json({ error: 'This date/time is blocked by the administrator' });

        // Check slot is not already full
        const bookingCount = await Event.countDocuments({
            resourceId,
            date: new Date(date),
            time,
            status: 'confirmed'
        });
        if (bookingCount >= (resource.capacity || 1))
            return res.status(409).json({ error: 'Time slot is fully booked' });

        const stripeClient = await getStripe();
        const userId    = req.user ? (req.user._id || req.user.userId || '') : '';
        const userEmail = req.user ? (req.user.email || '') : '';

        const intent = await stripeClient.paymentIntents.create({
            amount:   resource.price,
            currency: resource.currency || 'sek',
            metadata: {
                group,
                resourceId,
                date,
                time,
                userId:     String(userId),
                userEmail,
                bookerName: bookerName || ''
            }
        });

        res.json({
            clientSecret: intent.client_secret,
            intentId:     intent.id,
            amount:       resource.price,
            currency:     resource.currency || 'sek'
        });
    } catch (e) {
        console.error('create-intent error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /payment/webhook ────────────────────────────────────────────────────
// Stripe calls this URL when payment events occur.
// IMPORTANT: This route must receive the raw body — see handler.js for setup.
router.post('/webhook', async (req, res) => {
    let event;
    try {
        const stripeClient   = await getStripe();
        const webhookSecret  = await getSecret('cal_stripe_webhook_secret');
        const secret         = webhookSecret.secret || webhookSecret;
        const sig            = req.headers['stripe-signature'];
        const rawBody        = req.rawBody;     // captured by verify callback in handler.js

        if (!rawBody) {
            console.error('Stripe webhook: raw body missing — ensure express.json verify callback is set in handler.js');
            return res.status(400).json({ error: 'Raw body unavailable' });
        }

        event = stripeClient.webhooks.constructEvent(rawBody, sig, secret);
    } catch (e) {
        console.error('Stripe webhook signature error:', e.message);
        return res.status(400).json({ error: `Webhook error: ${e.message}` });
    }

    if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        const { group, resourceId, date, time, userId, userEmail, bookerName } = intent.metadata;
        try {
            // Idempotency — ignore if booking was already created
            const existing = await Event.findOne({ paymentIntentId: intent.id });
            if (existing) return res.json({ received: true });

            const resource = await Resource.findOne({ resourceId });
            await Event.create({
                resourceId,
                resourceName:     resource ? resource.name : resourceId,
                userId:           userId || null,
                userEmail:        userEmail || null,
                bookerName:       bookerName || null,
                date:             new Date(date),
                time,
                group,
                status:           'confirmed',
                paymentIntentId:  intent.id,
                paymentStatus:    'paid'
            });
            console.log(`Booking created via webhook: ${resourceId} ${date} ${time} (${intent.id})`);
        } catch (e) {
            console.error('Webhook booking creation error:', e.message);
            return res.status(500).json({ error: e.message });
        }
    }

    res.json({ received: true });
});

module.exports = router;
