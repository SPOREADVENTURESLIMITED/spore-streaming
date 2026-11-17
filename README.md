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
- PWA manifest and service worker; standard Android PNG icon sizes and real-device installation verification remain outstanding

## Deployment requirements

The Worker deployment pipeline is configured and a production deployment has succeeded. The following items remain before a complete public streaming launch:

1. `MFA_ENCRYPTION_KEY` has been configured by the operator. Complete first-administrator provisioning and test authenticator enrollment, login verification, and recovery codes.
2. Configure `RESEND_API_KEY` and `RESET_EMAIL_FROM` to enable password-reset email delivery; verify sender-domain authentication and run an end-to-end recovery test.
3. Provision the first authorized administrator directly in D1 using a securely generated password hash; never expose an admin-registration route or promote a public account.
4. Create and verify the `spore-max-media` R2 bucket and implement authenticated media upload, poster delivery, and storage lifecycle controls.
5. Integrate Cloudflare Stream for VOD encoding, signed playback, and live streaming. A catalogue record alone does not provide playable video.
6. Integrate a supported payment provider and implement verified server-side webhooks before activating paid subscriptions.
7. Implement rate limiting and email verification, then run controlled registration, login, password-reset, admin MFA, account, upload, playback, payment, and security tests.
8. Verify Android and desktop PWA installation, offline shell behavior, and production HTTPS from real browsers.

Never commit credentials, API tokens, or private keys. Publish only media for which SPORE MAX has the necessary distribution rights.


## Deployment and verification

- Production Worker: https://spore-max.spore-cybernetics.workers.dev
- Health endpoint: https://spore-max.spore-cybernetics.workers.dev/api/health
- GitHub Actions deployment workflow: https://github.com/SPOREADVENTURESLIMITED/spore-streaming/actions

A green deployment confirms that the Worker bundle and D1 migrations deployed; it does not prove that account flows, email delivery, media playback, payments, or device installation have passed end-to-end tests.