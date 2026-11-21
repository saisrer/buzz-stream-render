const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

app.get("/", (req, res) => {
  res.send("Buzz Stream Render Server is Running! Use /v/your-slug");
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

    // 2. Buzzheavier nunchi direct link fetch cheyali
    const buzzRes = await fetch(`${buzzPageUrl}/download`, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": buzzPageUrl,
        "hx-current-url": buzzPageUrl,
        "hx-request": "true",
      },
      redirect: "manual",
    });

    let directLink = buzzRes.headers.get("hx-redirect") || buzzRes.headers.get("location");

    if (!directLink) {
      return res.status(502).send(`Direct link raledu (Status: ${buzzRes.status})`);
    }

    if (directLink.startsWith("/")) {
      directLink = `https://buzzheavier.com${directLink}`;
    }

    // 3. Direct video link ki redirect cheyali
    res.redirect(302, directLink);
  } catch (err) {
    res.status(500).send(`Server Error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
