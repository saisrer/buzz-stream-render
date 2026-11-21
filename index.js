const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

app.get("/", (req, res) => {
  res.send("Buzz Stream Render Server is Running!");
});

app.get("/v/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    const baseUrl = SUPABASE_URL.replace(/\/$/, "");

    // 1. Supabase nunchi buzz_id teesukovali
    const dbRes = await fetch(
      `${baseUrl}/rest/v1/buzz_movies?slug=eq.${encodeURIComponent(slug)}&select=buzz_id,title`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!dbRes.ok) {
      return res.status(500).send(`Supabase Error: ${await dbRes.text()}`);
    }

    const data = await dbRes.json();
    if (!data || data.length === 0) {
      return res.status(404).send("Movie not found in database");
    }

    const buzzId = data[0].buzz_id;
    const buzzPageUrl = `https://buzzheavier.com/${buzzId}`;
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // 2. Mundu main page open chesi session cookies teesukovali
    const pageRes = await fetch(buzzPageUrl, {
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const rawCookies = pageRes.headers.getSetCookie
      ? pageRes.headers.getSetCookie()
      : [];
    const cookieHeader = rawCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. Aa cookies + full browser headers tho /download request pampali
    const buzzRes = await fetch(`${buzzPageUrl}/download`, {
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": buzzPageUrl,
        "Origin": "https://buzzheavier.com",
        "hx-current-url": buzzPageUrl,
        "hx-request": "true",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      redirect: "manual",
    });

    let directLink =
      buzzRes.headers.get("hx-redirect") || buzzRes.headers.get("location");

    if (!directLink) {
      return res
        .status(502)
        .send(`Direct link raledu (Page: ${pageRes.status}, Download: ${buzzRes.status})`);
    }

    if (directLink.startsWith("/")) {
      directLink = `https://buzzheavier.com${directLink}`;
    }

    res.redirect(302, directLink);
  } catch (err) {
    res.status(500).send(`Server Error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
