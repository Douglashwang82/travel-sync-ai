# LINE Login for the browser /app workspace

The `/app` web workspace uses **LINE Login** (not LIFF) to let travelers sign
in from any browser. This doc walks through the one-time setup in the LINE
Developers console and the env vars the app expects.

## Why a separate channel?

- **LIFF** (`LIFF_CHANNEL_ID`) authenticates the mobile webview inside the
  LINE app. LIFF tokens are short-lived and tied to the LINE app's host.
- **LINE Login** authenticates a standard browser via OAuth2 / OIDC. It's
  the right choice for desktop and non-LINE mobile browsers.

Both channels live under the same **Provider**, but they are different
channels with different IDs and secrets.

## 1. Create the channel

1. Go to <https://developers.line.biz/console/> and open your provider.
2. **Create a new channel** → **LINE Login**.
3. Fill in the required fields:
   - **Channel name** — e.g. "TravelSync Web".
   - **App types** — enable **Web app**.
   - **Region** — match your LINE bot channel.

## 2. Configure callback URLs

Under **LINE Login** → **Callback URL**, add every origin the app will run on:

```
http://localhost:3000/api/app/auth/line/callback
https://<preview>.vercel.app/api/app/auth/line/callback
https://app.example.com/api/app/auth/line/callback
```

All origins you'll test from must be whitelisted — LINE rejects any URL
that's not on this list.

## 3. Configure scopes

Under **OpenID Connect** → enable:

- `profile`
- `openid`
- optional: `email` (not used today but useful later)

## 4. Copy secrets into env

From the **Basic settings** tab:

```bash
# .env.local
LINE_LOGIN_CHANNEL_ID=1234567890
LINE_LOGIN_CHANNEL_SECRET=abcd...

# Optional: pin the callback so preview deploys don't drift.
# LINE_LOGIN_REDIRECT_URI=https://app.example.com/api/app/auth/line/callback
```

When both variables are set, the sign-in page automatically switches from
the dev member picker to a real **Continue with LINE** button. The dev
picker endpoints (`/api/app/sign-in`) respond with 404 in production when
LINE Login is configured, so the impersonation backdoor is closed.

## 5. Test the flow

1. `npm run dev` → visit `http://localhost:3000/app`.
2. You should be redirected to `/app/sign-in` and see the green
   **Continue with LINE** button.
3. Click it → you'll be bounced to `access.line.me` to authorize, then back
   to `/api/app/auth/line/callback`, which verifies the id_token and sets
   the session cookie.
4. You'll land on `/app` (or whatever `?next=` was requested).

## Troubleshooting

| Error param on redirect                   | Meaning                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `?error=not_configured`                   | The two env vars are missing; the /start route refused.                  |
| `?error=cancelled`                        | User tapped **Cancel** on LINE's consent screen.                         |
| `?error=state_mismatch`                   | CSRF check failed — probably an expired login attempt, try again.        |
| `?error=token_exchange_failed`            | The authorization code couldn't be redeemed. Check the secret + callback URL. |
| `?error=invalid_id_token`                 | Audience or nonce didn't match. Usually means the channel ID is wrong.   |
| `?error=not_a_member`                     | Sign-in succeeded but the LINE account is not part of any active group. Add the bot to a group first. |

## Security notes

- The OAuth state + nonce live in a single HttpOnly, SameSite=Lax cookie
  (`ts_app_oauth`) for 10 minutes. Both are 32 random bytes.
- The session cookie (`ts_app_user`) stores only the verified LINE user ID.
  All `/api/app/*` endpoints re-check group membership on every request,
  so revoking a group member in the DB immediately revokes web access.
- In development, the dev picker remains available so you can sign in as
  any seeded member without going through LINE. Don't deploy a production
  build without `LINE_LOGIN_CHANNEL_ID` set.
