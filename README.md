# Resursbokning

A resource booking calendar application with email-code login.

## Stack

- **Frontend:** Vanilla JS, Axios
- **Backend:** Node.js / Express
- **Database:** MongoDB (Mongoose)
- **Email:** AWS SES

---

## Setup

1. Install server dependencies:
   ```bash
   cd server && npm install
   ```

2. Configure `server/.env`:
   ```
   JWT_SECRET=your-secret
   MONGODB_URI=mongodb://localhost:27017/booking-calendar
   PORT=3000
   EMAIL_REGION=eu-north-1
   EMAIL_ACCESS_KEY=your-aws-access-key
   EMAIL_SECRET_KEY=your-aws-secret-key
   ```

3. Start the server:
   ```bash
   node handler.js
   ```

4. Open `client/index.html` in a browser.

---

## Adding Resources

Resources are stored in the MongoDB `resources` collection. Each resource has:

| Field | Type | Description |
|---|---|---|
| `resourceId` | String | Unique identifier, e.g. `room-1` |
| `name` | String | Display name |
| `description` | String | Optional description |
| `isActive` | Boolean | Whether it appears in the UI |
| `slot_length` | Number | Booking slot duration in minutes (default: 60) |
| `earliest` | String | Earliest bookable time, e.g. `09:00` |
| `latest` | String | Latest bookable time, e.g. `17:00` |

### Option 1 — REST API (recommended)

Requires a valid JWT token (log in first to obtain one).

```bash
curl -X POST http://localhost:3000/api/resources \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "resourceId": "room-3",
    "name": "Konferensrum 3",
    "description": "Litet rum, max 4 personer",
    "isActive": true,
    "slot_length": 30,
    "earliest": "08:00",
    "latest": "18:00"
  }'
```

### Option 2 — init-db.js script

Edit the `initialResources` array in `server/init-db.js`, then run:

```bash
cd server && node init-db.js
```

> **Warning:** This deletes all existing resources before inserting the new ones.

### Option 3 — MongoDB directly

Insert a document into the `resources` collection:

```js
db.resources.insertOne({
  resourceId: "room-3",
  name: "Konferensrum 3",
  description: "Litet rum, max 4 personer",
  isActive: true,
  slot_length: 30,
  earliest: "08:00",
  latest: "17:00"
})
```

---

## Login Flow

1. Enter your email address and click **Skicka kod till e-post**.
2. A 6-digit code is sent to your email (valid for 10 minutes).
3. Enter the code and click **Logga in**.

---

## Booking Flow

1. Click a resource card to select it.
2. Click a day in the calendar — the day view opens with the resource pre-selected.
3. Click **Boka** next to an available time slot.
