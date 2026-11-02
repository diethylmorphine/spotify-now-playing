# Spotify Now Playing API

A public Vercel endpoint that returns the current track metadata for the Spotify account authorized with the configured refresh token.

## Example response

```json
{"is_playing":true,"title":"Track","artist":"Artist 1, Artist 2","url":"https://open.spotify.com/track/...","album":"Album","album_image":"https://i.scdn.co/image/...","progress_ms":49636,"duration_ms":158774}
```

When nothing is playing, the response is `{"is_playing":false}`. Paused tracks can include metadata with `is_playing: false`.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdiethylmorphine%2Fspotify-now-playing)

## Privacy and polling

This endpoint is public and exposes the authorized account's current listening activity to anyone who can reach its URL. It does not provide playback controls. Poll at most once per minute as a conservative default, avoid bursts, and honor `Retry-After` on HTTP 429 responses. This suggested cadence does not guarantee Spotify quota availability.

## Setup

1. Deploy this repository to Vercel.
2. Configure `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN` as server-side environment variables.
3. Redeploy after changing environment variables.
4. See [OAuth setup and troubleshooting](docs/oauth-setup.md) for obtaining a refresh token, required permissions, deployment details, and common errors.

## Local checks

Node.js 24 is required. Tests mock Spotify and need no credentials:

```sh
npm test
npm run check
```
