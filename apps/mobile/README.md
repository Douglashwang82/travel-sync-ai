# TravelSync Mobile (Expo / React Native)

Native iOS + Android client for TravelSync. It reuses the existing
`/api/app/*` backend; the only backend addition for mobile is **bearer-token
auth** (`/api/app/auth/mobile/*`, see `lib/app-tokens.ts`), since native
clients can't use the web's HttpOnly session cookie.

> **Status: Phase 0 scaffold.** Auth foundation + project skeleton + a
> sign-in → trips-list loop. Not yet installed/built in CI. See
> `docs/MOBILE_APP_PLAN.md` for the full roadmap.

## Layout

```
apps/mobile/
  app/                 # expo-router screens (file-based routing)
    _layout.tsx        # providers (QueryClient, Auth) + auth gate
    sign-in.tsx        # email/password sign-in (LINE PKCE = Phase 1)
    (tabs)/            # native bottom tabs
      index.tsx        # Trips list  → GET /api/app/session
      inbox.tsx        # Notifications (Phase 2)
  src/
    api/client.ts      # ApiClient instance (base URL from app.config extra)
    api/secure-store.ts# TokenStore backed by expo-secure-store (keychain)
    auth/auth-context.tsx
```

Shared API contracts + the token-aware `ApiClient` live in
`packages/shared` (`@travel-sync/shared`).

## First-time setup

This package is a scaffold; pin the Expo-compatible dependency versions on a
machine with network access:

```bash
cd apps/mobile
npx expo install        # reconciles RN/Expo peer versions in package.json
npx expo start          # Metro dev server (press i / a for simulators)
```

Configure the API target and LINE Login channel via env (or EAS secrets):

```bash
export EXPO_PUBLIC_API_BASE_URL=https://staging.travelsync.ai
export EXPO_PUBLIC_LINE_LOGIN_CHANNEL_ID=1234567890
```

## Build & release (EAS)

```bash
eas build --profile preview --platform all      # internal test builds
eas build --profile production --platform all   # store builds
eas submit --profile production                 # App Store / Play submission
eas update --branch production                  # OTA JS-only update
```

Profiles are defined in `eas.json`.

## Auth flow

1. `signInWithEmail` / `signInWithLine` → `POST /api/app/auth/mobile/{login,line}`
   returns `{ accessToken, refreshToken }`, stored in the device keychain.
2. `ApiClient` attaches `Authorization: Bearer <accessToken>` to every request.
3. On a `401`, it does a one-shot `POST /api/app/auth/mobile/refresh` and
   replays the request; if refresh fails it clears tokens and the `AuthGate`
   bounces to `sign-in`.
