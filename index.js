const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const REFRESH_AFTER_DAYS = 25;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get("/", (req, res) => {
  res.send("Pixeldrain Smart Scheduler Bot is Running!");
});

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
      const buffer = await res.arrayBuffer();
      return { ok: true, bytes: buffer.byteLength, status: res.status };
    }
    return { ok: false, reason: `Status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function markRefreshedInDB(fileId) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/buzz_movies?buzz_id=eq.${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ last_refreshed: new Date().toISOString() }),
    }
  );
}

async function checkAndRefreshDueFiles(chatId, forceAll = false, isAuto = false) {
  try {
    let queryUrl = `${SUPABASE_URL}/rest/v1/buzz_movies?select=slug,buzz_id,last_refreshed`;

    if (!forceAll) {
      const cutoff = new Date(
        Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      queryUrl += `&or=(last_refreshed.is.null,last_refreshed.lt.${cutoff})`;
    }

    const dbRes = await fetch(queryUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const dueMovies = await dbRes.json();

    if (!dueMovies || !dueMovies.length) {
      // Auto check lo due files lekapothe silent ga untundi (spam avvadu)
      if (!isAuto && chatId) {
        return bot.sendMessage(
          chatId,
          `✅ Anni files safe ga unnayi! Ippudu refresh avvalsina files emi levu.`
        );
      }
      return;
    }

    for (const movie of dueMovies) {
      const result = await touchPixeldrainFile(movie.buzz_id);

      if (result.ok) {
        await markRefreshedInDB(movie.buzz_id);

        const nextDate = new Date(
          Date.now() + REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000
        ).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

        await bot.sendMessage(
          chatId,
          `📥 *File Refreshed!*\n` +
            `🎬 Movie: \`${movie.slug}\`\n` +
            `🆔 ID: \`${movie.buzz_id}\`\n` +
            `📦 Downloaded: *${result.bytes} bytes* (Status ${result.status})\n` +
            `📅 Next Auto-Refresh: *${nextDate}*`,
          { parse_mode: "Markdown" }
        );
      } else {
        await bot.sendMessage(
          chatId,
          `❌ *Refresh Failed*\n🎬 Movie: \`${movie.slug}\` (\`${movie.buzz_id}\`)\n⚠️ Reason: ${result.reason}`,
          { parse_mode: "Markdown" }
        );
      }

      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (err) {
    if (chatId) bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
}

// /start command — Bot status + next scheduled refresh chupistundi
bot.onText(/\/start$/, async (msg) => {
  try {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/buzz_movies?select=slug,last_refreshed&order=last_refreshed.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const movies = await dbRes.json();
    const total = Array.isArray(movies) ? movies.length : 0;

    let nextInfo = "Inka files emi levu.";
    if (total > 0) {
      const first = movies[0];
      const last = first.last_refreshed ? new Date(first.last_refreshed) : new Date();
      const next = new Date(last.getTime() + REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000);
      const nextStr = next.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      nextInfo = `*${first.slug}* (${nextStr})`;
    }

    await bot.sendMessage(
      msg.chat.id,
      `🤖 *Pixeldrain Keep-Alive Bot Active!*\n\n` +
        `🎬 Total Files: *${total}*\n` +
        `📅 Next Auto-Refresh: ${nextInfo}\n\n` +
        `File refresh ayinappudalla ikkade automatic ga update vastundi.\n\n` +
        `*Commands:*\n` +
        `/plan - Anni files schedule\n` +
        `/check - Due files check cheyadam\n` +
        `/refreshall - Anni files ippude refresh cheyadam`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/check$/, (msg) => checkAndRefreshDueFiles(msg.chat.id, false, false));
bot.onText(/\/refreshall$/, (msg) => checkAndRefreshDueFiles(msg.chat.id, true, false));

bot.onText(/\/plan$/, async (msg) => {
  try {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/buzz_movies?select=slug,buzz_id,last_refreshed&order=last_refreshed.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const movies = await dbRes.json();
    if (!movies.length) return bot.sendMessage(msg.chat.id, "Database khali ga undi.");

    const lines = movies.map((m) => {
      const last = m.last_refreshed ? new Date(m.last_refreshed) : new Date();
      const next = new Date(last.getTime() + REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000);
      const nextStr = next.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      return `• *${m.slug}* → Next: ${nextStr}`;
    });

    bot.sendMessage(msg.chat.id, `📅 *Auto-Refresh Plan:*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
});

// Prathi 6 hours ki silent auto-check (due files untene refresh chesi message pampistundi)
setInterval(() => {
  if (ADMIN_CHAT_ID) checkAndRefreshDueFiles(ADMIN_CHAT_ID, false, true);
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Pixeldrain Smart Bot running on port ${PORT}`);
});
