# SPORE MAX

**One Platform. Unlimited Entertainment.**

SPORE MAX is an all-in-one streaming platform for movies, series, live TV and sports, live streams, and music/audio.

## Planned platform

- Free, ad-supported access and paid premium subscriptions
- Customer registration, login, profiles, watchlists, and viewing history
- Search and content categories
- Secure video playback and live streaming
- Subscription and payment integration
- Admin dashboard for catalogue, media, users, subscriptions, and advertising
- Installable Progressive Web App (PWA)

## Infrastructure

- **GitHub** — source control
- **Cloudflare Workers** — application API
- **Cloudflare D1** — application data
- **Cloudflare R2** — posters, artwork, audio, subtitles, and other assets
- **Cloudflare Stream** — video encoding, VOD, and live streaming

## Development status

Repository initialized. Application implementation and Cloudflare configuration are pending.

## Security and content requirements

- Never commit credentials, API tokens, or private keys.
- Keep premium media protected by server-side authorization and signed playback.
- Restrict uploads and administrative operations to authorized administrators.
- Publish only content for which the platform has the necessary distribution rights.
