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
    const { gotScraping } = await import("got-scraping");
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
    const sessionToken = { id: Date.now().toString() };

    // 2. Main page open chesi cookies teesukovali (same session fingerprint)
    const pageRes = await gotScraping({
      url: buzzPageUrl,
      sessionToken,
      throwHttpErrors: false,
    });

    const rawCookies = pageRes.headers["set-cookie"] || [];
    const cookieHeader = rawCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. Exact HTMX download button headers tho /download request pampali
    const buzzRes = await gotScraping({
      url: `${buzzPageUrl}/download`,
      sessionToken,
      headers: {
        accept: "*/*",
        referer: buzzPageUrl,
        "hx-current-url": buzzPageUrl,
        "hx-request": "true",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      followRedirect: false,
      throwHttpErrors: false,
    });

    let directLink =
      buzzRes.headers["hx-redirect"] || buzzRes.headers["location"];

    if (!directLink || directLink.endsWith(`/${buzzId}`)) {
      return res.json({
        error: "Direct MP4 link raledu",
        status: buzzRes.statusCode,
        hxRedirect: buzzRes.headers["hx-redirect"] || null,
        location: buzzRes.headers["location"] || null,
      });
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
