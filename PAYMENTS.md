# Stripe Payment Integration

## Required secrets

Add these to `.env` (local) or AWS Secrets Manager (production):

```
CAL_STRIPE_PUBLISHABLE_KEY=pk_test_…
CAL_STRIPE_SECRET_KEY=sk_test_…
CAL_STRIPE_WEBHOOK_SECRET=whsec_…
```

Secret names in Secrets Manager follow the existing pattern, e.g. `{env}/cal_stripe_secret_key`.

---

## Making a resource require payment

Set `price` (in smallest currency unit, e.g. öre / cents) and `currency` on the resource document in MongoDB:

```js
// 150.00 SEK
db.cal_resources.updateOne(
  { resourceId: 'resource1' },
  { $set: { price: 15000, currency: 'sek' } }
)
```

Setting `price: 0` (or leaving it unset) makes the resource free — no payment is required.

---

## End-to-end payment flow

```
User clicks "Book"
  │
  ▼
handleInlineBooking() checks resource.price > 0
  │
  ├─ price = 0 ──► POST /events  (direct booking, existing flow)
  │
  └─ price > 0 ──► showPaymentModal()
                     │
                     ├─ GET /payment/config        → publishable key
                     ├─ Stripe.js card form shown
                     │
                     └─ User clicks "Pay X.XX SEK"
                          │
                          ├─ POST /payment/create-intent  → clientSecret
                          ├─ stripe.confirmCardPayment()  → Stripe charges card
                          │
                          └─ Stripe webhook ──► POST /payment/webhook
                                                  │
                                                  └─ Event created in MongoDB
                                                     (booking confirmed)
```

---

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/payment/config` | None | Returns Stripe publishable key |
| POST | `/payment/create-intent` | Bearer JWT | Validates slot, creates PaymentIntent |
| POST | `/payment/webhook` | Stripe signature | Confirms booking on successful payment |

### POST /payment/create-intent

Request body:
```json
{
  "group": "mygroup",
  "resourceId": "resource1",
  "date": "2026-05-10",
  "time": "10:00",
  "bookerName": "Anna Svensson"
}
```

Response:
```json
{
  "clientSecret": "pi_…_secret_…",
  "intentId": "pi_…",
  "amount": 15000,
  "currency": "sek"
}
```

---

## Stripe webhook setup

Register the webhook in the Stripe dashboard (Developers → Webhooks):

- **URL:** `https://yourdomain.com/payment/webhook`
- **Event:** `payment_intent.succeeded`

Copy the signing secret (`whsec_…`) to `CAL_STRIPE_WEBHOOK_SECRET`.

---

## Booking model fields added

| Model | Field | Type | Notes |
|-------|-------|------|-------|
| Resource | `price` | Number | Smallest currency unit; 0 = free |
| Resource | `currency` | String | ISO 4217 lowercase (default: `sek`) |
| Event | `paymentIntentId` | String | Stripe PaymentIntent id |
| Event | `paymentStatus` | String | `free` / `pending` / `paid` |
