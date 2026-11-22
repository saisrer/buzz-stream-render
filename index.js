const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PIXELDRAIN_API_KEY = process.env.PIXELDRAIN_API_KEY;

const REFRESH_AFTER_DAYS = 25;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get("/", (req, res) => {
  res.send("Pixeldrain Smart Scheduler Bot is Running!");
});

function getPixeldrainAuthHeader() {
  if (!PIXELDRAIN_API_KEY) return {};
  return {
    Authorization: "Basic " + Buffer.from(":" + PIXELDRAIN_API_KEY).toString("base64"),
  };
}

// 1. Pixeldrain lo kothaga upload chesina files ni automatic ga Supabase lo save chestundi
async function syncPixeldrainFiles(chatId, isAuto = false) {
  if (!PIXELDRAIN_API_KEY) {
    if (!isAuto && chatId) {
      return bot.sendMessage(chatId, "⚠️ `PIXELDRAIN_API_KEY` env variable set cheyyaledu.", {
        parse_mode: "Markdown",
      });
    }
    return;
  }

  try {
    const pdRes = await fetch("https://pixeldrain.com/api/user/files", {
      headers: {
        ...getPixeldrainAuthHeader(),
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!pdRes.ok) {
      throw new Error(`Pixeldrain API Status ${pdRes.status}`);
    }

    const pdData = await pdRes.json();
    const pdFiles = Array.isArray(pdData.files) ? pdData.files : [];

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/buzz_movies?select=buzz_id`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    const existingRows = await dbRes.json();
    const existingIds = new Set(
      (Array.isArray(existingRows) ? existingRows : []).map((r) => r.buzz_id)
    );

    const newFiles = pdFiles.filter((f) => f.id && !existingIds.has(f.id));

    if (!newFiles.length) {
      if (!isAuto && chatId) {
        return bot.sendMessage(chatId, "✅ Kotha files emi levu. Anni already Supabase lo unnayi.");
      }
      return;
    }

    const rowsToInsert = newFiles.map((f) => ({
      slug: f.name || f.id,
      buzz_id: f.id,
      last_refreshed: new Date().toISOString(),
    }));

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/buzz_movies`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rowsToInsert),
    });

    if (!insertRes.ok) {
      throw new Error(`Supabase Insert Status ${insertRes.status}`);
    }

    if (chatId) {
      const listText = newFiles
        .slice(0, 15)
        .map((f) => `• \`${f.name || f.id}\` (\`${f.id}\`)`)
        .join("\n");
      await bot.sendMessage(
        chatId,
        `🆕 *${newFiles.length} Kotha Pixeldrain Files Supabase lo Save Ayyayi!*\n\n${listText}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    if (!isAuto && chatId) {
      bot.sendMessage(chatId, `❌ Sync Error: ${err.message}`);
    }
  }
}

// 2. File delete avvakunda 1 KB download ping
async function touchPixeldrainFile(fileId) {
  const url = `https://pixeldrain.com/api/file/${fileId}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-1024",
        Referer: `https://pixeldrain.com/u/${fileId}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...getPixeldrainAuthHeader(),
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
        `*Commands:*\n` +
        `/sync - Instant ga kotha files check cheyadam\n` +
        `/plan - Anni files schedule\n` +
        `/check - Due files check cheyadam\n` +
        `/refreshall - Anni files ippude refresh cheyadam`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/sync$/, (msg) => syncPixeldrainFiles(msg.chat.id, false));
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

// Prathi 15 minutes ki automatic ga kotha Pixeldrain files check chesi Supabase lo save chestundi
setInterval(async () => {
  if (ADMIN_CHAT_ID) {
    await syncPixeldrainFiles(ADMIN_CHAT_ID, true);
  }
}, 15 * 60 * 1000);

// Prathi 6 hours ki due files (25 days) 1 KB download ping chestundi
setInterval(async () => {
  if (ADMIN_CHAT_ID) {
    await checkAndRefreshDueFiles(ADMIN_CHAT_ID, false, true);
  }
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Pixeldrain Smart Bot running on port ${PORT}`);
});
