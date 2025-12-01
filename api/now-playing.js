export default async function handler(req, res) {
  // CORS — чтобы твой сайт на github.io мог дергать этот API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: "Missing Spotify env variables" });
  }

  try {
    // 1. Обновляем access_token по refresh_token
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Token error:", tokenData);
      return res.status(500).json({ error: "Failed to refresh token" });
    }

    const accessToken = tokenData.access_token;

    // 2. Берём текущий трек
    const nowRes = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (nowRes.status === 204 || nowRes.status === 202) {
      // ничего не играет
      return res.status(200).json({ is_playing: false });
    }

    const nowData = await nowRes.json();

    if (!nowRes.ok) {
      console.error("Now playing error:", nowData);
      return res.status(500).json({ error: "Failed to fetch now playing" });
    }

    const item = nowData.item;
    if (!item) {
      return res.status(200).json({ is_playing: false });
    }

    const artists = item.artists?.map((a) => a.name).join(", ") || "";

    const track = {
      is_playing: nowData.is_playing,
      title: item.name,
      artist: artists,
      url: item.external_urls?.spotify || null,
      album: item.album?.name || null,
      album_image:
        item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
      progress_ms: nowData.progress_ms,
      duration_ms: item.duration_ms,
    };

    return res.status(200).json(track);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}