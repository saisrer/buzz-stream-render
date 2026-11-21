const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let currentDayIndex = 0; // 15-day rotation

app.get("/", (req, res) => {
  res.send("Pixeldrain Keep-Alive Bot is Running!");
});

// Pixeldrain file ni 1KB download chesi expiry timer reset chestundi
async function touchPixeldrainFile(fileId) {
  const url = `https://pixeldrain.com/api/file/${fileId}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-1024",
      },
    });

    if (res.status === 200 || res.status === 206) {
      return { ok: true };
    }
    return { ok: false, reason: `Status ${res.status}` };
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

    bot.sendMessage(chatId, `🔄 ${batch.length} Pixeldrain files refresh start chesanu...`);

    let success = 0;
    let failed = [];

    for (const movie of batch) {
      const result = await touchPixeldrainFile(movie.buzz_id);
      if (result.ok) {
        success++;
      } else {
        failed.push(`${movie.slug} (${result.reason})`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    let report = `✅ Pixeldrain Refresh Complete!\nSuccess: ${success}/${batch.length}`;
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
  console.log(`Pixeldrain Bot running on port ${PORT}`);
});
