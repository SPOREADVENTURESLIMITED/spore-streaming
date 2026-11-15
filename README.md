# SPORE MAX

**One Platform. Unlimited Entertainment.**

SPORE MAX is being built as an all-in-one streaming platform for movies, series, live TV and sports, live streams, and music/audio.

## Product plan

- Free, ad-supported access and paid premium subscriptions
- Customer registration, login, profiles, watchlists, and viewing history
- Search and content categories
- Secure video playback and live streaming
- Subscription and payment integration
- Admin dashboard for catalogue, media, users, subscriptions, and advertising
- Installable Progressive Web App (PWA)

## Infrastructure

- **GitHub** — source control
- **Cloudflare Workers** — application API and static assets
- **Cloudflare D1** — users, catalogue, sessions, and subscription data
- **Cloudflare R2** — posters, artwork, audio, subtitles, and other assets
- **Cloudflare Stream** — video encoding, VOD, and live streaming

## Current implementation

- Responsive SPORE MAX web app shell
- Cloudflare Worker health and catalogue endpoints
- D1 initial schema for users, titles, subscriptions, and watch history
- Customer registration and login API using PBKDF2 password hashing
- Server-side sessions stored in D1; session cookie is HttpOnly, Secure, and SameSite=Lax
- Customer sign-in and registration interface
- PWA manifest, service worker, and app icon

## Deployment requirements

The app is not production-live yet. Before deployment:

1. Create the Cloudflare D1 database and replace the placeholder database ID in `wrangler.toml`.
2. Create the `spore-max-media` R2 bucket.
3. Apply D1 migrations with Wrangler.
4. Configure the Cloudflare Stream account and secure server-side credentials when playback integration is implemented.
5. Set the production domain and verify HTTPS.
6. Add rate limiting, account recovery, email verification, admin MFA, payment provider integration, and production security testing before public launch.

Never commit credentials, API tokens, or private keys. Publish only media for which SPORE MAX has the necessary distribution rights.
