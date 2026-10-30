const REQUIRED_SCOPE = "user-read-currently-playing";

async function readJson(response) {
  // Spotify/proxies may return plain text or empty error bodies.
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fail(res, status, code, error, stage, spotifyStatus) {
  // Only controlled fields are logged/returned: never upstream bodies, headers,
  // URLs with query parameters, exception messages, or credentials.
  console.error("Spotify request failed", { code, stage, spotify_status: spotifyStatus });
  return res.status(status).json({
    error,
    code,
    stage,
    ...(spotifyStatus === undefined ? {} : { spotify_status: spotifyStatus }),
  });
}

function spotifyFailure(res, response, data, stage) {
  const status = response.status;
  const oauthError = typeof data?.error === "string" ? data.error : null;
  if (status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter)) {
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
    }
    const quota = data?.error?.reason === "QUOTA_EXCEEDED";
    return fail(res, 429, quota ? "SPOTIFY_QUOTA_EXCEEDED" : "SPOTIFY_RATE_LIMITED",
      quota ? "Spotify development quota exceeded. Reduce requests and check the Dashboard."
        : "Spotify rate limit reached. Wait for Retry-After before retrying.", stage, status);
  }
  if (oauthError === "invalid_client" || (stage === "token" && status === 401)) {
    return fail(res, 502, "SPOTIFY_INVALID_CLIENT",
      "Spotify rejected the client credentials. Check the Vercel client ID and secret belong to the same app.", stage, status);
  }
  if (stage === "token" && oauthError === "invalid_grant") {
    return fail(res, 502, "SPOTIFY_REAUTH_REQUIRED",
      "Refresh token expired, revoked, invalid, or belongs to another app. Authorize again, exchange the new code, update SPOTIFY_REFRESH_TOKEN, and redeploy.", stage, status);
  }
  const message = typeof data?.error?.message === "string" ? data.error.message : "";
  const auth = response.headers.get("www-authenticate") || "";
  if (oauthError === "invalid_scope" || /insufficient[_ ](?:client[_ ])?scope/i.test(`${message} ${auth}`)) {
    return fail(res, 403, "SPOTIFY_MISSING_SCOPE",
      `Authorize again with ${REQUIRED_SCOPE}, then replace the refresh token and redeploy.`, stage, status);
  }
  if (status === 403) {
    return fail(res, 403, "SPOTIFY_ACCESS_DENIED",
      "Spotify denied access. Check the app owner's Premium subscription, user allowlist, app access restrictions, and granted scopes in the Dashboard.", stage, status);
  }
  if (status === 401) {
    return fail(res, 502, "SPOTIFY_ACCESS_TOKEN_REJECTED",
      "Spotify rejected the newly refreshed access token. Check app authorization and credentials.", stage, status);
  }
  return fail(res, 502, "SPOTIFY_UPSTREAM_ERROR",
    "Spotify request failed. Check spotify_status and stage; retry later for upstream server errors.", stage, status);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return fail(res, 500, "SPOTIFY_CONFIG_MISSING", "Missing Spotify env variables", "configuration");
  }

  let stage = "token";
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      signal: AbortSignal.timeout(8000),
    });
    const tokenData = await readJson(tokenRes);
    if (!tokenRes.ok) return spotifyFailure(res, tokenRes, tokenData, stage);
    if (typeof tokenData?.access_token !== "string" || !tokenData.access_token) {
      return fail(res, 502, "SPOTIFY_INVALID_RESPONSE", "Spotify returned no access token.", stage, tokenRes.status);
    }
    // An omitted scope retains the original grant; only reject an explicit list.
    if (typeof tokenData.scope === "string" && !tokenData.scope.split(/\s+/).includes(REQUIRED_SCOPE)) {
      return fail(res, 403, "SPOTIFY_MISSING_SCOPE",
        `Authorize again with ${REQUIRED_SCOPE}, then replace the refresh token and redeploy.`, stage, tokenRes.status);
    }

    stage = "currently-playing";
    const nowRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (nowRes.status === 204 || nowRes.status === 202) {
      return res.status(200).json({ is_playing: false });
    }
    const nowData = await readJson(nowRes);
    if (!nowRes.ok) return spotifyFailure(res, nowRes, nowData, stage);
    if (!nowData || typeof nowData !== "object" || Array.isArray(nowData)) {
      return fail(res, 502, "SPOTIFY_INVALID_RESPONSE", "Spotify returned invalid playback JSON.", stage, nowRes.status);
    }
    const item = nowData.item;
    if (!item) return res.status(200).json({ is_playing: false });

    const artists = item.artists?.map((a) => a.name).join(", ") || "";
    return res.status(200).json({
      is_playing: nowData.is_playing,
      title: item.name,
      artist: artists,
      url: item.external_urls?.spotify || null,
      album: item.album?.name || null,
      album_image: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
      progress_ms: nowData.progress_ms,
      duration_ms: item.duration_ms,
    });
  } catch (err) {
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    return fail(res, timeout ? 504 : 502, timeout ? "SPOTIFY_TIMEOUT" : "SPOTIFY_NETWORK_ERROR",
      timeout ? "Spotify request timed out. Retry later." : "Could not complete the Spotify request. Retry later.", stage);
  }
}
