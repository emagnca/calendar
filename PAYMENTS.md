# Stripe Payment Integration

## Overview

Payments are triggered at the **group level**, not per resource. When `Group.to_pay > 0` the user is required to pay before proceeding. After a successful payment the Stripe webhook sets `Group.to_pay` back to `0` and records the transaction in the `cal_payments` collection.

There are two payment triggers:
- **Admin login** — if `Group.to_pay > 0` when the admin logs in, a payment modal is shown before the admin UI is revealed.
- **Booking** — if `Group.to_pay > 0` when a user books a slot, a payment modal is shown before the booking is created.

---

## Required secrets

Add these to `.env` (local) or AWS Secrets Manager (production):

```
CAL_STRIPE_PUBLISHABLE_KEY=pk_test_…
CAL_STRIPE_SECRET_KEY=sk_test_…
CAL_STRIPE_WEBHOOK_SECRET=whsec_…
```

Secret names in Secrets Manager follow the pattern `{env}/cal_stripe_secret_key` etc.

---

## Setting a payment amount on a group

Set `to_pay` (smallest currency unit, e.g. öre / cents) and `currency` directly on the group document in MongoDB:

```js
// Require a payment of 50.00 SEK before next admin login or booking
db.cal_groups.updateOne(
  { name: 'mygroup' },
  { $set: { to_pay: 5000, currency: 'sek' } }
)
```

Setting `to_pay: 0` (the default) disables the payment gate entirely.

---

## End-to-end flow

```
Group.to_pay is set to 5000 (50.00 SEK)
  │
  ├─ Admin logs in
  │    └─ bootApp() fetches group info
  │         └─ to_pay > 0 ──► showAdminPaymentModal()
  │                              │
  │                              ├─ GET /payment/config  → publishable key
  │                              ├─ Stripe.js card form shown
  │                              └─ Admin clicks "Pay 50.00 SEK"
  │                                   │
  │                                   ├─ POST /payment/create-intent (resourceId: '_admin')
  │                                   ├─ stripe.confirmCardPayment()
  │                                   └─ Payment succeeds → admin UI shown
  │
  └─ User books a slot
       └─ handleInlineBooking() checks to_pay > 0
            └─ to_pay > 0 ──► showPaymentModal()
                               │
                               ├─ GET /payment/config  → publishable key
                               ├─ Stripe.js card form shown
                               └─ User clicks "Pay 50.00 SEK"
                                    │
                                    ├─ POST /payment/create-intent (resourceId: actual resource)
                                    └─ stripe.confirmCardPayment()

After payment succeeds (either trigger):
  Stripe sends POST /payment/webhook
    └─ payment_intent.succeeded
         ├─ Payment document created in cal_payments
         └─ Group.to_pay set to 0
```

---

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/payment/config` | None | Returns Stripe publishable key |
| POST | `/payment/create-intent` | Bearer JWT | Validates group `to_pay`, creates PaymentIntent |
| POST | `/payment/webhook` | Stripe signature | Records payment, clears `Group.to_pay` |

### POST /payment/create-intent — request body

```json
{
  "group": "mygroup",
  "resourceId": "resource1",
  "date": "2026-05-10",
  "time": "10:00",
  "bookerName": "Anna Svensson"
}
```

Use `"resourceId": "_admin"` for admin login payments (skips slot validation).

### Response

```json
{
  "clientSecret": "pi_…_secret_…",
  "intentId": "pi_…",
  "amount": 5000,
  "currency": "sek"
}
```

---

## Data model changes

| Model | Field | Type | Notes |
|-------|-------|------|-------|
| Group | `to_pay` | Number | Smallest currency unit; 0 = free (default) |
| Group | `currency` | String | ISO 4217 lowercase (default: `sek`) |
| Payment | `paymentIntentId` | String | Stripe PaymentIntent id (unique) |
| Payment | `group` | String | Group name |
| Payment | `amount` | Number | Amount charged (smallest unit) |
| Payment | `currency` | String | ISO 4217 lowercase |
| Payment | `userId` | ObjectId | Paying user (if known) |
| Payment | `userEmail` | String | |
| Payment | `bookerName` | String | |
| Payment | `status` | String | `pending` / `paid` / `failed` |
| Payment | `stripeEvent` | String | Stripe event id (for tracing) |

---

## Testing locally

### 1. Install the Stripe CLI

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

### 2. Start the local webhook forwarder

Run this in a separate terminal and **keep it running**:

```bash
stripe listen --forward-to localhost:3000/payment/webhook
```

It prints a signing secret — copy it to `.env`:

```
CAL_STRIPE_WEBHOOK_SECRET=whsec_…
```

### 3. Set a test amount on a group

```js
db.cal_groups.updateOne({ name: 'mygroup' }, { $set: { to_pay: 5000, currency: 'sek' } })
```

### 4. Trigger a payment in the browser

Log in to the admin page for that group. The payment modal should appear. Use a test card (see below).

### 5. Verify

Check the Stripe CLI terminal — you should see:
```
--> payment_intent.succeeded   [evt_…]
<-- [200] POST http://localhost:3000/payment/webhook
```

Check MongoDB:
```js
db.cal_payments.find().sort({ createdAt: -1 }).limit(1)   // payment recorded
db.cal_groups.findOne({ name: 'mygroup' }, { to_pay: 1 }) // should be 0
```

### 6. Trigger a synthetic test event (no browser needed)

```bash
stripe trigger payment_intent.succeeded
```

---

## Test cards

All test cards use any future expiry (e.g. `12/34`), any 3-digit CVC, any postal code. No real money is charged.

| Card number | Result |
|---|---|
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 9995` | Declined — insufficient funds |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |
| `4000 0000 0000 0002` | Declined — generic decline |

Full list: https://stripe.com/docs/testing#cards

---

## Production webhook setup

Register the endpoint in the Stripe Dashboard → Developers → Webhooks:

- **URL:** `https://yourdomain.com/payment/webhook`
- **Events to listen for:** `payment_intent.succeeded`

Copy the signing secret to `CAL_STRIPE_WEBHOOK_SECRET` in AWS Secrets Manager.
