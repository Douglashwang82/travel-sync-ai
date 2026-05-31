# Mobile App Plan

Native iOS + Android app for TravelSync, built with **Expo / React Native**,
reusing the existing `/api/app/*` backend and `lib/` domain types.

## Why Expo (vs. Capacitor / Flutter)

- **Native UX** on both platforms (the stated priority) — real native widgets,
  gestures, 60fps via Reanimated.
- **Code & type reuse** — same React + TypeScript + Zod as the web app; shared
  contracts live in `packages/shared`.
- Capacitor (WebView wrap) was rejected for UX; Flutter for zero reuse of the
  existing TS/Zod layer.

## Repo shape (target: full workspace)

```
apps/web/         # the existing Next.js app (move is a staged follow-up)
apps/mobile/      # Expo app  ✅ scaffolded
packages/shared/  # API contracts + typed client  ✅ scaffolded
```

`apps/` and `packages/` are currently excluded from the web root's
`tsconfig`/ESLint so they don't affect `npm run build` / `lint`. Enabling npm
workspaces and moving `app/ → apps/web/` is the remaining restructure step.

## The auth blocker (SOLVED in Phase 0)

The web `/app` authenticates with an HttpOnly `ts_app_user` cookie, which native
clients can't use. Fixed at the single chokepoint:

- `lib/app-tokens.ts` — stateless HMAC-SHA256 access/refresh JWTs (`node:crypto`,
  no new dependency), signed with `APP_JWT_SECRET`.
- `lib/app-server.ts#resolveSessionLineUserId` accepts a `Bearer` token **or**
  the cookie; `requireAppUser` uses it, so all ~85 endpoints accept mobile
  tokens with no per-route changes.
- `app/api/app/auth/mobile/{login,refresh,line}` issue/rotate tokens (email +
  LINE PKCE).

## Phased roadmap

- **Phase 0 — Foundations** ✅ token auth + Expo/shared scaffold + sign-in →
  trips-list loop. Remaining: enable workspaces, install via `expo install`,
  add `mobile-ci` (typecheck/lint + EAS preview).
- **Phase 1 — Read-only MVP** LINE PKCE sign-in; trip overview + board +
  itinerary (read).
- **Phase 2 — Collaboration** votes, expenses, packing (optimistic UI); push
  notifications wired into `services/notifications` (+ `device_push_tokens`).
- **Phase 3 — Discovery & AI** templates/fork, AI itinerary, chat threads,
  places + maps.
- **Phase 4 — Polish & ship** deep links, offline cache, haptics/animations,
  a11y, store assets → TestFlight + Play internal → production.

## UX commitments

Native tab bar + stack headers, Reanimated (UI-thread) animations, FlashList
for long lists, optimistic mutations via TanStack Query, skeletons + offline
cache, dark mode + dynamic type, safe areas, shared design tokens with web.

## Build & release

EAS Build/Submit for both stores; EAS Update for OTA JS fixes. Profiles in
`apps/mobile/eas.json`. App config (API base URL, LINE channel) via
`app.config.ts` + EAS secrets.
