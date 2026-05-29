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
 * Group model must have:
 *   to_pay   {Number}  price in smallest currency unit (e.g. öre / cents); 0 = free
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
const Group         = require('../models/Group');
const Resource      = require('../models/Resource');
const Event         = require('../models/Event');
const Payment       = require('../models/Payment');
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

        const grp = await Group.findOne({ name: group.toLowerCase() });
        if (!grp)                         return res.status(404).json({ error: 'Group not found' });
        if (!grp.to_pay || grp.to_pay <= 0)
            return res.status(400).json({ error: 'This group does not require payment' });

        // Resource and slot checks are only relevant for booking payments, not admin payments
        if (resourceId !== '_admin') {
            const resource = await Resource.findOne({ resourceId });
            if (!resource) return res.status(404).json({ error: 'Resource not found' });

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
        }

        const stripeClient = await getStripe();
        const userId    = req.user ? (req.user._id || req.user.userId || '') : '';
        const userEmail = req.user ? (req.user.email || '') : '';

        const intent = await stripeClient.paymentIntents.create({
            amount:   grp.to_pay,
            currency: grp.currency || 'sek',
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
            amount:       grp.to_pay,
            currency:     grp.currency || 'sek'
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
        const { group, userId, userEmail, bookerName } = intent.metadata;
        try {
            // Idempotency — ignore if already recorded
            const existing = await Payment.findOne({ paymentIntentId: intent.id });
            if (existing) return res.json({ received: true });

            // Store payment record
            await Payment.create({
                paymentIntentId: intent.id,
                group:           group || '',
                amount:          intent.amount,
                currency:        intent.currency,
                userId:          userId || null,
                userEmail:       userEmail || null,
                bookerName:      bookerName || null,
                status:          'paid',
                stripeEvent:     event.id
            });

            // Clear the group's pending payment
            if (group) {
                await Group.findOneAndUpdate(
                    { name: group.toLowerCase() },
                    { to_pay: 0 }
                );
            }

            console.log(`Payment recorded for group "${group}": ${intent.amount} ${intent.currency} (${intent.id})`);
        } catch (e) {
            console.error('Webhook payment recording error:', e.message);
            return res.status(500).json({ error: e.message });
        }
    }

    res.json({ received: true });
});

module.exports = router;
