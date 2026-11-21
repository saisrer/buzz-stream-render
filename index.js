const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PROXY_URL = process.env.PROXY_URL; // Format: http://user:pass@host:port

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let currentDayIndex = 0;

app.get("/", (req, res) => {
  res.send("Buzz Keep-Alive Bot is Running!");
});

async function touchBuzzFile(buzzId) {
  const { gotScraping } = await import("got-scraping");
  const pageUrl = `https://buzzheavier.com/${buzzId}`;
  const sessionToken = { id: Date.now().toString() };

  try {
    // 1. Proxy dwara main page open chesi cookies teesukovali
    const pageRes = await gotScraping({
      url: pageUrl,
      proxyUrl: PROXY_URL,
      sessionToken,
      throwHttpErrors: false,
    });

    const rawCookies = pageRes.headers["set-cookie"] || [];
    const cookieHeader = rawCookies.map((c) => c.split(";")[0]).join("; ");

    // 2. Proxy dwara /download call cheyali
    const buzzRes = await gotScraping({
      url: `${pageUrl}/download`,
      proxyUrl: PROXY_URL,
      sessionToken,
      headers: {
        accept: "*/*",
        referer: pageUrl,
        "hx-current-url": pageUrl,
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
      return { ok: false, reason: `Blocked/No link (Status ${buzzRes.statusCode})` };
    }

    if (directLink.startsWith("/")) {
      directLink = `https://buzzheavier.com${directLink}`;
    }

    // 3. Same Proxy dwara kevalam 1KB download chesi timer reset cheyali
    const fileRes = await gotScraping({
      url: directLink,
      proxyUrl: PROXY_URL,
      sessionToken,
      headers: {
        range: "bytes=0-1024",
      },
      throwHttpErrors: false,
    });

    if (fileRes.statusCode === 200 || fileRes.statusCode === 206) {
      return { ok: true };
    }
    return { ok: false, reason: `File status ${fileRes.statusCode}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function runBatch(chatId, runAll = false) {
  try {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/buzz_movies?select=slug,buzz_id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const movies = await dbRes.json();
    if (!movies || !movies.length) {
      return bot.sendMessage(chatId, "Database lo movies emi levu.");
    }

    let batch = movies;
    if (!runAll) {
      const batchSize = Math.max(1, Math.ceil(movies.length / 15));
      const start = (currentDayIndex * batchSize) % movies.length;
      batch = movies.slice(start, start + batchSize);
      currentDayIndex = (currentDayIndex + 1) % 15;
    }

    bot.sendMessage(chatId, `🔄 ${batch.length} files refresh start chesanu...`);

    let success = 0;
    let failed = [];

    for (const movie of batch) {
      const result = await touchBuzzFile(movie.buzz_id);
      if (result.ok) {
        success++;
      } else {
        failed.push(`${movie.slug} (${result.reason})`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    let report = `✅ Refresh Complete!\nSuccess: ${success}/${batch.length}`;
    if (failed.length > 0) {
      report += `\n\n❌ Failed:\n${failed.join("\n")}`;
    }
    bot.sendMessage(chatId, report);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
}

bot.onText(/\/refresh$/, (msg) => runBatch(msg.chat.id, false));
bot.onText(/\/refreshall$/, (msg) => runBatch(msg.chat.id, true));

// Every 24 hours ki auto-run
setInterval(() => {
  if (ADMIN_CHAT_ID) runBatch(ADMIN_CHAT_ID, false);
}, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server & Bot running on port ${PORT}`);
});
