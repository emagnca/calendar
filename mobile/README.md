# EasyBooking — Mobile (Capacitor)

This directory contains the Capacitor wrapper that turns the EasyBooking webapp into a native iOS/Android app.

## How it works

`build.sh` copies `../client/` into `www/` and applies three patches:

| Patch | What changes |
|-------|-------------|
| Remove `<base href="/">` | Prevents broken relative-URL resolution inside Capacitor |
| `axios.defaults.baseURL` | Changed from `/api` to the absolute Lambda URL |
| `currentGroup` detection | `window._mobileGroup` (from localStorage) is checked first, so the app remembers the last group across app restarts |

`www/mobile-patch.js` is injected before `script.js` and handles:
- Restoring the stored group via `window._mobileGroup`
- Intercepting the landing page "Go to Group" button to save the group to `localStorage` and reload instead of navigating by URL

## First-time setup

```bash
cd mobile
npm install
npx cap add ios      # first time only
npx cap add android  # first time only
```

## Build and sync

```bash
npm run sync:ios      # build → cap sync ios
npm run sync:android  # build → cap sync android
```

Or manually:
```bash
bash build.sh
npx cap sync
```

## Open in Xcode / Android Studio

```bash
npm run open:ios
npm run open:android
```

## Backend URL

The Lambda URL is set in `build.sh`:
```
API_URL="https://mr3xmgyqnxzrszocyvutnjknty0eodkp.lambda-url.eu-north-1.on.aws"
```

Update this if the Lambda URL ever changes.

## CORS

The Lambda/Express backend must allow `capacitor://localhost` as an origin.
In `server/handler.js`, update the `cors()` call:

```js
app.use(cors({
    origin: ['https://your-domain.com', 'capacitor://localhost', 'http://localhost']
}));
```
