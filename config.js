// ═══════════════════════════════════════════════
//  X-Miku Bot — configuration
//  Values come from your ".env" file (see .env.example).
//  Anything left empty falls back to the default shown here.
// ═══════════════════════════════════════════════

const isTrue = (x) => x === "true" || x === true;

export default {
  // ─── General ───────────────────────────────────
  prefix: ".",
  BOT_NAME: process.env.BOT_NAME || "Fahim",
  packname: process.env.PACKNAME || "bot",
  author: process.env.AUTHOR || "XMD_Fahim",
  THEME: process.env.THEME || "t",
  giftname: "Fahim",
  GROUP_LINKS: ["https://chat.whatsapp.com/K3R7juhNBDe4maXokueSVg?s=cl&p=a&iam=2"],

  // ─── Database ──────────────────────────────────
  // Baileys (socksy) auth/session storage (empty = local SQLite file)
  DATABASE_URL: process.env.DATABASE_URL || "",

  // Turso cloud SQLite for bot settings (empty = local SQLite file)
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || "",
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN || "",

  // ─── Telegram bot ──────────────────────────────
  // Token from @BotFather
  BOT_TOKEN: process.env.BOT_TOKEN || "8975115240:AAGmMUXS4sOiEAMo3xOVer6zYZcP2Q3Y-Kk",

  // Official group where the bot works
  ALLOWED_GROUP_ID: Number(process.env.TG_GROUP_ID) || -1003729697262,
  GROUP_INVITE_LINK: process.env.TG_GROUP_LINK || "https://t.me/fahim_md_bot1",

  // Telegram user IDs allowed to use /d, /s, /as
  // Example: "123456789,987654321"  (empty = any group admin)
  OWNER_IDS: process.env.OWNER_IDS || "8141633843",

  // Pairing: wait time between two /pair requests from the same user
  PAIR_COOLDOWN_MS: 30_000,

  // ─── WhatsApp ──────────────────────────────────
  WA_CHANNEL_LINK:
    process.env.WA_CHANNEL_LINK ||
    "https://whatsapp.com/channel/0029VbDLv0h1dAw6SRSiPr30",

  // ─── Sticker downloader (tgsticker plugin) ─────
  // Uses the same bot token unless you set a separate one
  TGTOKEN: process.env.TGTOKEN || process.env.BOT_TOKEN || "8975115240:AAGmMUXS4sOiEAMo3xOVer6zYZcP2Q3Y-Kk",
  PACK_NAME: process.env.PACKNAME || "x-Fahim",
  PACK_AUTHOR: process.env.AUTHOR || "@nightx_rebel",
};
