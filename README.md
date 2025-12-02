# spotify-now-playing

A tiny serverless API that returns JSON with the track that is **currently** playing on **your** Spotify account.

Used, for example, on this profile card:  
`https://diethylmorphine.github.io` – the **Now Playing** block and album cover.

The API endpoint looks like:

```text
GET https://your-project-name.vercel.app/api/now-playing
```

Example response:

```json
{
  "is_playing": true,
  "title": "Tokyo Rain (Slowed + Reverb)",
  "artist": "Yavomag, Rubikdice, Chilx",
  "url": "https://open.spotify.com/track/2FdyFBXsCE7IMq4cZ48pVU",
  "album": "Tokyo Rain (Slowed + Reverb)",
  "album_image": "https://i.scdn.co/image/ab67616d0000b273c3872886570e73f637a362c7",
  "progress_ms": 49636,
  "duration_ms": 158774
}
```

## What you need

1. Spotify account (regular is fine, not necessarily Premium).
2. GitHub account.
3. Vercel account ([vercel.com](https://vercel.com)) – free plan is enough.
4. Basic ability to copy‑paste commands and strings 🙂

---

## Step 1. Create an app in Spotify Dashboard

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/).
2. Click **Create app**.
3. Give it any name, e.g. `my-now-playing`.
4. In app settings (**Edit Settings**), add this string to **Redirect URIs**:

   ```text
   https://example.com/callback
   ```

   > Yes, this exact domain; we only use it to get an authorization code.

5. Click **Save**.
6. Copy:
   - **Client ID**
   - **Client Secret**

You will need them later.

---

## Step 2. Get the `refresh_token`

The `refresh_token` lets the server obtain fresh `access_token`s without your interaction.

### 2.1. Get the `code` via browser

Build this URL (insert your `CLIENT_ID`):

```text
https://accounts.spotify.com/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=user-read-currently-playing%20user-read-playback-state
```

1. Open this URL in your browser.
2. Spotify will ask for permissions – click **Agree**.
3. You’ll be redirected to a URL like:

   ```text
   https://example.com/callback?code=VERY_LONG_STRING&state=...
   ```

4. Copy the whole URL and extract the value of the `code` parameter – everything between `code=` and `&state=`:

   ```text
   AUTH_CODE = VERY_LONG_STRING
   ```

### 2.2. Exchange `code` → `refresh_token`

Run this in your terminal (replace the placeholders):

```bash
curl -X POST "https://accounts.spotify.com/api/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"
```

If everything is correct, you’ll get JSON like:

```json
{
  "access_token": "BQAz...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "AQAd...THIS_IS_WHAT_WE_NEED...",
  "scope": "user-read-playback-state user-read-currently-playing"
}
```

Copy the `refresh_token` value and store it somewhere safe – you’ll need it on Vercel.

---

## Step 3. Deploy this repo to Vercel

### 3.1. Fork or import the repository

1. Click **Fork** on GitHub or create your own repo from these files.
2. Log in to [Vercel](https://vercel.com) with GitHub.
3. Click **Add New Project** → select your fork (e.g. `spotify-now-playing`).

Vercel will automatically detect:

- `api/now-playing.js`
- `package.json`

No extra config is necessary.

### 3.2. Configure environment variables

In your Vercel project:

1. Go to **Settings → Environment Variables**.
2. Add:

   ```text
   SPOTIFY_CLIENT_ID        = your Client ID
   SPOTIFY_CLIENT_SECRET    = your Client Secret
   SPOTIFY_REFRESH_TOKEN    = your refresh_token
   ```

3. Save and trigger a **Redeploy** (or just wait for the first deploy to finish).

After deployment you’ll get a URL like:

```text
https://your-now-playing-project.vercel.app
```

Test the API:

```text
https://your-now-playing-project.vercel.app/api/now-playing
```

- If nothing is playing in Spotify you’ll get:

  ```json
  { "is_playing": false }
  ```

- If a track is playing you’ll see JSON with `title`, `artist`, `album_image`, etc.

---

## Step 4. Use the API on your site

Example usage in plain HTML:

```html
<div class="player">
  <div class="track-info">
    <span id="track-title">loading...</span>
    <span id="track-artist">please wait...</span>
  </div>
  <div class="progress">
    <div id="progress-bar"></div>
  </div>
</div>

<div class="now-playing-cover">
  <img id="track-cover" src="" alt="album cover" />
</div>

<script>
  (function () {
    const API_URL = "https://your-now-playing-project.vercel.app/api/now-playing";

    const titleEl = document.getElementById("track-title");
    const artistEl = document.getElementById("track-artist");
    const progressBarEl = document.getElementById("progress-bar");
    const coverImg = document.getElementById("track-cover");

    function setNothing() {
      titleEl.textContent = "nothing is playing";
      artistEl.textContent = "Spotify";
      if (progressBarEl) progressBarEl.style.width = "0%";
      if (coverImg) coverImg.src = "";
    }

    async function fetchNowPlaying() {
      try {
        const res = await fetch(API_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("Bad response");
        const data = await res.json();

        if (!data || data.is_playing === false) {
          setNothing();
          return;
        }

        titleEl.textContent = data.title || "unknown track";
        artistEl.textContent = data.artist || "unknown artist";

        if (progressBarEl && data.duration_ms && data.progress_ms != null) {
          const percent = Math.min(
            100,
            Math.max(0, (data.progress_ms / data.duration_ms) * 100)
          );
          progressBarEl.style.width = percent + "%";
        }

        if (coverImg && data.album_image) {
          coverImg.src = data.album_image;
          coverImg.alt = data.album || "Album cover";
        }
      } catch (err) {
        console.error("now-playing error", err);
        setNothing();
      }
    }

    setNothing();
    fetchNowPlaying();
    setInterval(fetchNowPlaying, 15000);
  })();
</script>
```

You only need to change:

```js
const API_URL = "https://your-now-playing-project.vercel.app/api/now-playing";
```

---

## API response format

The API always returns JSON. There are two main cases:

### 1. Nothing is playing

```json
{
  "is_playing": false
}
```

### 2. Something is playing

```json
{
  "is_playing": true,
  "title": "Track Name",
  "artist": "Artist 1, Artist 2",
  "url": "https://open.spotify.com/track/...",
  "album": "Album Name",
  "album_image": "https://i.scdn.co/image/...",
  "progress_ms": 49636,
  "duration_ms": 158774
}
```

Fields:

- `is_playing` – whether something is currently playing.
- `title` – track name.
- `artist` – artist names, comma separated.
- `url` – link to the track on Spotify.
- `album` – album name.
- `album_image` – album cover URL (square 300–640px usually).
- `progress_ms` – current playback position (milliseconds).
- `duration_ms` – total track length (milliseconds).

---

## Security & privacy

- The API only uses scopes:
  - `user-read-currently-playing`
  - `user-read-playback-state`
- These scopes **do not** grant access to playlists, likes, etc. – only “what is currently playing”.
- `client_id`, `client_secret` and `refresh_token` are stored **only** in Vercel environment variables.
- The repository can stay public; there is nothing secret in the code.

---

## Troubleshooting

**`INVALID_CLIENT: Invalid redirect URI` during authorization**

- Make sure **Redirect URIs** in Spotify Dashboard contains exactly:
  `https://example.com/callback`
- And the authorization URL uses the encoded version:
  `redirect_uri=https%3A%2F%2Fexample.com%2Fcallback`

**`/api/now-playing` returns 500**

- Check that all three env vars are set on Vercel:
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REFRESH_TOKEN`
- Redeploy your project.

**API always returns `is_playing: false`**

- Ensure Spotify is open and a track is actually playing.
- Sometimes switching the playback device (phone ↔ desktop) helps.

---

## License

MIT – feel free to fork, use in your sites/portfolios, and modify as you like.
