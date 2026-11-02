# OAuth setup and troubleshooting

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

