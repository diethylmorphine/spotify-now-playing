# Spotify Now Playing API

A Vercel endpoint: `GET /api/now-playing`.

Successful JSON remains:

```json
{"is_playing":true,"title":"Track","artist":"Artist 1, Artist 2","url":"https://open.spotify.com/track/...","album":"Album","album_image":"https://i.scdn.co/image/...","progress_ms":49636,"duration_ms":158774}
```

No current item (including Spotify 204) returns HTTP 200 with
`{"is_playing":false}`. The existing 202 fallback is retained. Paused tracks can
retain metadata with is_playing false. OPTIONS returns 200 without a body.
CORS remains origin *, methods GET/OPTIONS, allowed headers Content-Type.
Responses use Cache-Control: no-store; other methods return 405.

## Spotify requirements (official docs checked 2026-10-30)

- [Development Mode](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
  requires **Premium for the app owner** and an allowlisted authorizing account
  under Dashboard → Settings → Users Management / Users and Access. Login can
  succeed outside the allowlist while API calls return 403. The documented cap
  is five users; existing apps may retain grandfathered users. Extended Quota
  Mode has different access rules.
- [Currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
  remains GET https://api.spotify.com/v1/me/player/currently-playing with a Bearer
  user access token and **user-read-currently-playing**.
  user-read-playback-state is unnecessary for this endpoint.
- [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
  must match exactly. Use **https://example.org/callback** without a trailing
  slash for both authorization and exchange. The old README's different host
  did not match this app's registration.
- [Refresh tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
  expire **six months after authorization**. Access-token refresh does not extend
  that lifetime. expires_in describes the access token (about one hour).
  invalid_grant means expired, revoked, or otherwise invalid: it does not prove
  expiration alone. Reauthorize instead of retrying that token.
  The [expiration announcement](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration)
  applied to new apps June 18, 2026 and existing apps July 20, 2026.

Use the existing Dashboard app. Client IDs are public; secrets, codes and tokens
are private. This endpoint reads metadata, not audio or playback controls.

## Get a refresh token in Windows PowerShell

Works in Windows PowerShell 5.1 and PowerShell 7. Keep the **same session** open.
Use Invoke-RestMethod, not Bash curl syntax (Windows PowerShell aliases curl to
Invoke-WebRequest).

### 1. Authorize

```powershell
$clientId = 'f8d708f33b244480a83b1542e6556e30'
$redirectUri = 'https://example.org/callback'
$scope = 'user-read-currently-playing'
$state = [guid]::NewGuid().ToString('N')
$authorizeUrl = 'https://accounts.spotify.com/authorize?client_id=' +
    [uri]::EscapeDataString($clientId) + '&response_type=code&redirect_uri=' +
    [uri]::EscapeDataString($redirectUri) + '&scope=' +
    [uri]::EscapeDataString($scope) + '&state=' +
    [uri]::EscapeDataString($state) + '&show_dialog=true'
Start-Process $authorizeUrl
```

Sign into the account whose activity you want to publish and approve access.
Copy the complete browser address beginning
`https://example.org/callback?code=...&state=...`, even if the page shows an
error/404. This repository does not host the callback. Keep that URL private.

**The callback code is a short-lived authorization code, not a refresh token.**
Exchange it once. Never put it in SPOTIFY_REFRESH_TOKEN. Never reuse earlier
codes, including anything previously shared in chat. Authorize again if it
expires or was already exchanged.

Parse the callback, decode query parameters and validate state:

```powershell
$callbackUri = [uri](Read-Host 'Paste the complete callback URL')
if ($callbackUri.GetLeftPart([System.UriPartial]::Path) -cne $redirectUri) {
    throw 'Unexpected callback URI. Start authorization again.'
}
$query = @{}
foreach ($pair in $callbackUri.Query.TrimStart('?').Split('&')) {
    $parts = $pair.Split('=', 2)
    $key = [uri]::UnescapeDataString($parts[0].Replace('+', ' '))
    $value = ''
    if ($parts.Length -eq 2) {
        $value = [uri]::UnescapeDataString($parts[1].Replace('+', ' '))
    }
    if ($query.ContainsKey($key)) { throw 'Duplicate callback parameter.' }
    $query[$key] = $value
}
if ($query['state'] -cne $state) { throw 'State mismatch. Authorize again.' }
if ($query.ContainsKey('error')) { throw 'Authorization denied. Start again.' }
$authorizationCode = $query['code']
if ([string]::IsNullOrWhiteSpace($authorizationCode)) { throw 'No authorization code.' }
```

### 2. Exchange the code

The [Authorization Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
requires POST form data with grant_type=authorization_code, decoded code and
the exact same redirect_uri. Use HTTP Basic client authentication. Prompting
keeps the secret out of shell history:

```powershell
$secretSecure = Read-Host 'Spotify client secret (hidden)' -AsSecureString
$clientSecret = [System.Net.NetworkCredential]::new('', $secretSecure).Password
$basic = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($clientId + ':' + $clientSecret)
)
$tokenRequest = @{
    Uri = 'https://accounts.spotify.com/api/token'
    Method = 'Post'
    Headers = @{ Authorization = 'Basic ' + $basic }
    ContentType = 'application/x-www-form-urlencoded'
    Body = @{
        grant_type = 'authorization_code'
        code = $authorizationCode
        redirect_uri = $redirectUri
    }
}
$tokens = Invoke-RestMethod @tokenRequest
if ([string]::IsNullOrWhiteSpace($tokens.refresh_token)) { throw 'No refresh token returned.' }
if (($tokens.scope -split '\s+') -notcontains 'user-read-currently-playing') {
    throw 'Required scope not granted. Authorize again.'
}
Set-Clipboard -Value $tokens.refresh_token
Write-Host 'Refresh token copied. Paste into SPOTIFY_REFRESH_TOKEN in Vercel.'
```

Use $tokens.refresh_token, not $tokens.access_token or $authorizationCode.
For failed exchanges check matching URI, credentials, and fresh unused code.
Do not publish requests/token responses. After saving in Vercel, clear the
clipboard and close the shell:

```powershell
Set-Clipboard -Value ''
Remove-Variable tokens, tokenRequest, basic, clientSecret, secretSecure, authorizationCode, callbackUri, query
```

## Deploy to Vercel

Import the GitHub repository, framework **Other**, repository root, no custom
build command/output directory. api/now-playing.js is the function. The package
explicitly uses ES modules and Node.js 24 (native fetch and timeout signals).

Set these in Settings → Environment Variables → **Production** (and separately
Preview/Development if needed):

| Variable | Value |
| --- | --- |
| SPOTIFY_CLIENT_ID | The client ID above |
| SPOTIFY_CLIENT_SECRET | The secret from the same Dashboard app |
| SPOTIFY_REFRESH_TOKEN | The refresh token from the exchange |

Paste raw values without quotes, whitespace or Bearer prefixes. Never commit
secrets/.env files. **Redeploy after changing environment variables.** Pushes to
the configured production branch (normally main) deploy when Git integration
is enabled.

The function refreshes on each GET using the environment token. It has no
interactive OAuth or durable token store. A stateful app must securely persist
any replacement refresh token Spotify returns; this static setup requires
updating Vercel with a fresh token and redeploying if the configured token stops
working. In-memory replacement cannot survive separate serverless instances.
Plan to reauthorize at least every six months; record the authorization date
privately.

## Diagnostics

Failures contain safe error, code, stage and (when Spotify replied)
spotify_status. Logs contain only code/stage/status, never upstream bodies,
headers, exception text or credentials. Failures do not masquerade as idle.

| HTTP | Code | Action |
| --- | --- | --- |
| 500 | SPOTIFY_CONFIG_MISSING | Set all three variables in the right environment; redeploy. |
| 502 | SPOTIFY_INVALID_CLIENT | Check matching ID/secret, reset secrets and pasted quotes. |
| 502 | SPOTIFY_REAUTH_REQUIRED | invalid_grant: authorize again, exchange fresh code, replace refresh token, redeploy. Expiration, revocation, wrong app or an authorization code stored as a refresh token are possible. |
| 403 | SPOTIFY_MISSING_SCOPE | Reauthorize with user-read-currently-playing. Refreshing cannot add scopes. |
| 403 | SPOTIFY_ACCESS_DENIED | Check owner Premium, allowlist, scopes and app restrictions. A generic 403 cannot identify the exact restriction. |
| 502 | SPOTIFY_ACCESS_TOKEN_REJECTED | Newly refreshed token rejected; check app authorization/credentials. |
| 429 | SPOTIFY_RATE_LIMITED | Back off; honor numeric Retry-After when present (also exposed through CORS). |
| 429 | SPOTIFY_QUOTA_EXCEEDED | Explicit QUOTA_EXCEEDED; check shared developer quota. |
| 502 | SPOTIFY_UPSTREAM_ERROR | Check stage/status; retry later for upstream 5xx. |
| 502 | SPOTIFY_INVALID_RESPONSE | Invalid playback JSON or missing access token. |
| 502 / 504 | SPOTIFY_NETWORK_ERROR / SPOTIFY_TIMEOUT | Connection failure or eight-second per-request timeout. |

[Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
and [development quotas](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
are distinct. This public endpoint makes Spotify requests per GET; avoid
aggressive polling, honor 429/backoff, and do not loop on invalid_grant.
No automatic retries are made.

Redirect URI mismatches affect initial authorization/exchange, not refresh.
Before this fix production returned `500 {"error":"Failed to refresh token"}`,
confirming token-refresh stage failure without identifying Spotify's reason.

If is_playing is false, play a track in the account you authorized.

## Usage and checks

```javascript
const response = await fetch('https://spotify-now-playing-roan-delta.vercel.app/api/now-playing');
const data = await response.json();
if (!response.ok) {
  console.error(data.code, data.stage, data.spotify_status);
} else {
  console.log(data); // Render existing track fields or idle response.
}
```

With Node.js 24, run `node --check api/now-playing.js` and `node --test`.
Tests mock Spotify and need no credentials. With npm installed, `npm run check`
and `npm test` are equivalent. `npm start` expects a separately installed
Vercel CLI (`vercel dev`).

This API deliberately publishes one account's listening metadata publicly.
Only user-read-currently-playing is needed. Keep client secrets and tokens in
server-side environment variables or a secure secret store.
