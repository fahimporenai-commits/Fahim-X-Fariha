import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import config from "../config.js";
import TelegramBot from "node-telegram-bot-api";

export default async function initializeTelegramBot(manager) {
  // ═══════════════════════════════════════════════════════════════════════════
  //  CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  const BOT_TOKEN = config.BOT_TOKEN;
  const ALLOWED_GROUP_ID = config.ALLOWED_GROUP_ID;
  const GROUP_INVITE_LINK = config.GROUP_INVITE_LINK;
  const WA_CHANNEL_LINK = config.WA_CHANNEL_LINK;
  const PAIR_COOLDOWN_MS = Number(config.PAIR_COOLDOWN_MS) || 30_000;


  // Optional: restrict dangerous commands (/s /as /d) to specific Telegram
  // user IDs. In config.js:  OWNER_IDS: "123456789,987654321"  (or an array)
  // If not set, any group admin can use them (old behaviour).
  const OWNER_IDS = []
    .concat(config.OWNER_IDS ?? [])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);

  if (!BOT_TOKEN) {
    console.warn("❌ [bot.js] BOT_TOKEN not set — skipping Telegram bot.");
    return null;
  }

  const RAILWAY_URL =
    process.env.RAILWAY_STATIC_URL || process.env.WEBHOOK_BASE_URL || "";
  const USE_WEBHOOK = Boolean(RAILWAY_URL);

  const tbot = new TelegramBot(
    BOT_TOKEN,
    USE_WEBHOOK
      ? { polling: false }
      : { polling: { interval: 3000, timeout: 30 } },
  );

  tbot.on("polling_error", (e) =>
    console.error("❗ [bot.js] Polling error:", e?.message || e),
  );
  tbot.on("webhook_error", (e) =>
    console.error("❗ [bot.js] Webhook error:", e?.message || e),
  );

  // Bot identity
  let botId = null;
  try {
    const me = await tbot.getMe();
    botId = me.id;
    tbot.botId = me.id;
    tbot.botUsername = me.username;
    console.log(
      `🤖 [bot.js] @${me.username} (${me.id}) — mode: ${USE_WEBHOOK ? "webhook" : "polling"}`,
    );
  } catch (e) {
    console.warn("⚠️ [bot.js] getMe failed:", e?.message);
  }

  // Per-user /pair cooldown (swept periodically so it never grows forever)
  const pairCooldown = new Map(); // userId → timestamp
  const cooldownSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [uid, ts] of pairCooldown) {
      if (now - ts > PAIR_COOLDOWN_MS) pairCooldown.delete(uid);
    }
  }, PAIR_COOLDOWN_MS * 2);
  cooldownSweepTimer.unref?.();

  // ═══════════════════════════════════════════════════════════════════════════
  //  TEXT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const LINE = "━━━━━━━━━━━━━━━━━━";

  const esc = (s = "") =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Sans-serif bold font (𝖧𝖾𝗅𝗅𝗈) — body labels
  const F = (text = "") =>
    String(text).replace(/[A-Za-z]/g, (ch) => {
      const c = ch.charCodeAt(0);
      return c <= 90
        ? String.fromCodePoint(0x1d5a0 + (c - 65))
        : String.fromCodePoint(0x1d5ba + (c - 97));
    });

  // Monospace font (𝙷𝚎𝚕𝚕𝚘) — headings of the pairing flow
  const M = (text = "") =>
    String(text).replace(/[A-Za-z]/g, (ch) => {
      const c = ch.charCodeAt(0);
      return c <= 90
        ? String.fromCodePoint(0x1d670 + (c - 65))
        : String.fromCodePoint(0x1d68a + (c - 97));
    });

  // Plain emoji map (replaces the old Telegram custom emojis)
  const EMOJI = {
    pairReady: "🔑", number: "📱", country: "🌍", code: "🔐",
    settings: "⚙️", link: "🔗", keyboard: "⌨️", timer: "⏳",
    connected: "🎉", ok: "✅", fail: "❌", timeout: "⏰",
    retry: "🔁", phone: "📞", globe: "🌐", sparkle: "✨",
    clock: "⏱", memory: "💾", plug: "🔌", health: "🩺", node: "🧩",
  };
  const E = (key) => EMOJI[key] || "▪️";

  // ╭━━〔 TITLE 〕━━⬣  card
  const card = (title, rows = []) =>
    [
      `╭━━〔 <b>${title}</b> 〕━━⬣`,
      ...rows.filter((r) => r !== null && r !== undefined).map((r) => `┃ ${r}`),
      `╰${LINE}⬣`,
    ].join("\n");

  const isoToFlag = (iso) =>
    !iso || iso.length !== 2
      ? "🏳️"
      : [...iso.toUpperCase()]
          .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
          .join("");

  // Any shape of phone number → digits only
  const normalizePhoneNumber = (raw) => String(raw || "").replace(/\D/g, "");
  const isValidPhone = (d) => /^[1-9][0-9]{6,14}$/.test(d);

  // Temp session id for a fresh pairing attempt: `${phone}_${6 digits}`
  const makeTempSessionId = (phone) =>
    `${phone}_${Math.floor(100000 + Math.random() * 900000)}`;

  // `${phone}_${random}` → phone (legacy sids without a suffix pass through)
  const phoneFromSid = (sid) => {
    const s = String(sid || "");
    const i = s.lastIndexOf("_");
    return i > 0 ? s.slice(0, i) : s;
  };

  // Pair code → XXXX-XXXX
  const fmtCode = (raw) => {
    const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length === 8
      ? `${s.slice(0, 4)}-${s.slice(4)}`
      : s.match(/.{1,4}/g)?.join("-") || s;
  };

  const fmtUptime = (sec) =>
    `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHAT / PERMISSION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const isPrivate = (msg) => msg?.chat?.type === "private";

  const isAllowedGroup = (msg) => {
    if (!msg?.chat || msg.chat.type === "private") return false;
    return String(msg.chat.id) === String(ALLOWED_GROUP_ID);
  };

  const isAnonymousAdmin = (msg) =>
    !!(
      msg?.sender_chat &&
      msg?.chat &&
      String(msg.sender_chat.id) === String(msg.chat.id)
    );

  async function isAdmin(msg) {
    try {
      if (!msg?.chat || msg.chat.type === "private") return false;
      if (isAnonymousAdmin(msg)) return true;
      if (!msg.from) return false;
      const m = await tbot.getChatMember(msg.chat.id, msg.from.id);
      return m?.status === "creator" || m?.status === "administrator";
    } catch {
      return false;
    }
  }

  // Owner check for dangerous commands (falls back to admin if OWNER_IDS empty)
  async function isOwner(msg) {
    if (!OWNER_IDS.length) return isAdmin(msg);
    return OWNER_IDS.includes(String(msg.from?.id));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SEND HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  async function safeReply(chatId, text, opts = {}) {
    try {
      return await tbot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        ...opts,
      });
    } catch (error) {
      console.error("[bot.js] sendMessage failed:", error?.message);
      return null;
    }
  }

  async function safeEdit(chatId, msgId, text, opts = {}) {
    try {
      return await tbot.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: "HTML",
        ...opts,
      });
    } catch {
      return null;
    }
  }

  const safeDelete = (chatId, msgId) =>
    msgId ? tbot.deleteMessage(chatId, msgId).catch(() => {}) : Promise.resolve();

  async function sendMedia(method, chatId, media, options = {}) {
    try {
      return await tbot[method](chatId, media, { parse_mode: "HTML", ...options });
    } catch (error) {
      console.error(`[bot.js] ${method} failed:`, error?.message || error);
      return null;
    }
  }

  // Sends text as a temp file (for long outputs), then deletes the file
  async function sendAsFile(chatId, fileName, content, options = {}) {
    const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${fileName}`);
    try {
      await fs.promises.writeFile(tmpPath, content, "utf8");
      return await sendMedia("sendDocument", chatId, tmpPath, options);
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COUNTRY DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  // [calling code, ISO, name]
  const COUNTRIES = [
    [1, "US", "United States/Canada"], [7, "RU", "Russia/Kazakhstan"],
    [20, "EG", "Egypt"], [27, "ZA", "South Africa"], [30, "GR", "Greece"],
    [31, "NL", "Netherlands"], [32, "BE", "Belgium"], [33, "FR", "France"],
    [34, "ES", "Spain"], [36, "HU", "Hungary"], [39, "IT", "Italy"],
    [40, "RO", "Romania"], [41, "CH", "Switzerland"], [43, "AT", "Austria"],
    [44, "GB", "United Kingdom"], [45, "DK", "Denmark"], [46, "SE", "Sweden"],
    [47, "NO", "Norway"], [48, "PL", "Poland"], [49, "DE", "Germany"],
    [51, "PE", "Peru"], [52, "MX", "Mexico"], [53, "CU", "Cuba"],
    [54, "AR", "Argentina"], [55, "BR", "Brazil"], [56, "CL", "Chile"],
    [57, "CO", "Colombia"], [58, "VE", "Venezuela"], [60, "MY", "Malaysia"],
    [61, "AU", "Australia"], [62, "ID", "Indonesia"], [63, "PH", "Philippines"],
    [64, "NZ", "New Zealand"], [65, "SG", "Singapore"], [66, "TH", "Thailand"],
    [81, "JP", "Japan"], [82, "KR", "South Korea"], [84, "VN", "Vietnam"],
    [86, "CN", "China"], [90, "TR", "Turkey"], [91, "IN", "India"],
    [92, "PK", "Pakistan"], [93, "AF", "Afghanistan"], [94, "LK", "Sri Lanka"],
    [95, "MM", "Myanmar"], [98, "IR", "Iran"], [211, "SS", "South Sudan"],
    [212, "MA", "Morocco"], [213, "DZ", "Algeria"], [216, "TN", "Tunisia"],
    [218, "LY", "Libya"], [220, "GM", "Gambia"], [221, "SN", "Senegal"],
    [233, "GH", "Ghana"], [234, "NG", "Nigeria"], [254, "KE", "Kenya"],
    [255, "TZ", "Tanzania"], [256, "UG", "Uganda"], [260, "ZM", "Zambia"],
    [263, "ZW", "Zimbabwe"], [351, "PT", "Portugal"], [353, "IE", "Ireland"],
    [358, "FI", "Finland"], [380, "UA", "Ukraine"], [420, "CZ", "Czech Republic"],
    [421, "SK", "Slovakia"], [500, "FK", "Falkland Islands"], [501, "BZ", "Belize"],
    [502, "GT", "Guatemala"], [505, "NI", "Nicaragua"], [506, "CR", "Costa Rica"],
    [507, "PA", "Panama"], [591, "BO", "Bolivia"], [593, "EC", "Ecuador"],
    [595, "PY", "Paraguay"], [598, "UY", "Uruguay"], [670, "TL", "East Timor"],
    [673, "BN", "Brunei"], [675, "PG", "Papua New Guinea"], [679, "FJ", "Fiji"],
    [850, "KP", "North Korea"], [852, "HK", "Hong Kong"], [853, "MO", "Macau"],
    [855, "KH", "Cambodia"], [856, "LA", "Laos"], [880, "BD", "Bangladesh"],
    [886, "TW", "Taiwan"], [960, "MV", "Maldives"], [961, "LB", "Lebanon"],
    [962, "JO", "Jordan"], [963, "SY", "Syria"], [964, "IQ", "Iraq"],
    [965, "KW", "Kuwait"], [966, "SA", "Saudi Arabia"], [967, "YE", "Yemen"],
    [968, "OM", "Oman"], [971, "AE", "UAE"], [972, "IL", "Israel"],
    [973, "BH", "Bahrain"], [974, "QA", "Qatar"], [975, "BT", "Bhutan"],
    [977, "NP", "Nepal"], [992, "TJ", "Tajikistan"], [993, "TM", "Turkmenistan"],
    [994, "AZ", "Azerbaijan"], [995, "GE", "Georgia"], [996, "KG", "Kyrgyzstan"],
    [998, "UZ", "Uzbekistan"], [1242, "BS", "Bahamas"], [1246, "BB", "Barbados"],
    [1345, "KY", "Cayman Islands"], [1868, "TT", "Trinidad and Tobago"],
    [1876, "JM", "Jamaica"],
  ]
    .map(([callingCode, iso, name]) => ({ callingCode, iso, name }))
    // longest calling code first so +1876 wins over +1
    .sort(
      (a, b) =>
        String(b.callingCode).length - String(a.callingCode).length ||
        b.callingCode - a.callingCode,
    );

  function detectCountry(digits) {
    if (!digits) return null;
    if (digits.startsWith("00")) digits = digits.slice(2);
    return COUNTRIES.find((c) => digits.startsWith(String(c.callingCode))) || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MESSAGE BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  const groupChannelKeyboard = () => ({
    inline_keyboard: [
      [
        { text: "Official group", url: GROUP_INVITE_LINK },
        { text: "WhatsApp channel", url: WA_CHANNEL_LINK, style: "primary" },
      ],
    ],
  });
  // ═══════════════════════════════════════════════════════════════════════════
  //  RICH MESSAGES (Telegram Bot API 10.1+)  — real tables, headings, lists
  //  Falls back to the old HTML card automatically if Rich Messages fail.
  // ═══════════════════════════════════════════════════════════════════════════

  async function callApi(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.description || `${method} failed (${res.status})`);
    return json.result;
  }

  let richSupported = true;

  // Style: first letter bold (𝐅), rest small caps (ᴀʜɪᴍ)  →  "𝐅ᴀʜɪᴍ"
  // Text containing HTML tags is left untouched so <code>/<a> never break.
  const SMALL_CAPS = {
    a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
    j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
    s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
  };
  const boldCap = (ch) => String.fromCodePoint(0x1d400 + ch.toUpperCase().charCodeAt(0) - 65);
  const styleWord = (w) => {
    const chars = [...w];
    let first = true;
    return chars
      .map((ch) => {
        if (!/[A-Za-z]/.test(ch)) return ch;
        if (first) {
          first = false;
          return boldCap(ch);
        }
        return SMALL_CAPS[ch.toLowerCase()];
      })
      .join("");
  };
  const fx = (t = "") =>
    /[<&]/.test(String(t)) ? String(t) : String(t).split(/(\s+)/).map(styleWord).join("");

  // Button labels get the same font (copy-code buttons are left alone so the code stays copyable)
  const styleMarkup = (rm) =>
    rm?.inline_keyboard
      ? {
          ...rm,
          inline_keyboard: rm.inline_keyboard.map((row) =>
            row.map((b) => (b.copy_text ? b : { ...b, text: fx(b.text) })),
          ),
        }
      : rm;

  // spec = { title, rows, section, blocks[], note }
  //   block = { heading, text, rows: [[label, value]], items[], pre, note }
  // All strings inside a spec must already be HTML-safe (use esc() on user data).
  const specBlocks = ({ rows, section, blocks = [] }) => [
    ...(rows?.length ? [{ rows }] : []),
    ...(section ? [{ heading: section.title, items: section.items }] : []),
    ...blocks,
  ];

  const renderRich = (spec) =>
    [
      `<h2>${fx(spec.title)}</h2>`,
      ...specBlocks(spec).map((b) =>
        [
          b.heading ? `<h3>${fx(b.heading)}</h3>` : "",
          b.text ? `<p>${fx(b.text)}</p>` : "",
          b.rows?.length
            ? `<table bordered>${b.rows
                .map(([k, v]) => `<tr><td><b>${fx(k)}</b></td><td>${fx(v)}</td></tr>`)
                .join("")}</table>`
            : "",
          b.items?.length ? `<ul>${b.items.map((i) => `<li>${fx(i)}</li>`).join("")}</ul>` : "",
          b.pre ? `<pre>${b.pre}</pre>` : "",
          b.note ? `<blockquote>${fx(b.note)}</blockquote>` : "",
        ].join(""),
      ),
      spec.note ? `<blockquote>${fx(spec.note)}</blockquote>` : "",
    ].join("");

  // Old-style fallback (normal sendMessage HTML) — also used for media captions
  const renderLegacy = (spec) =>
    [
      `<b>${fx(spec.title)}</b>`,
      ...specBlocks(spec).map((b) =>
        [
          b.heading ? `<b>${fx(b.heading)}</b>` : "",
          b.text ? fx(b.text) : "",
          b.rows?.length ? card("", b.rows.map(([k, v]) => `<b>${fx(k)}:</b> ${fx(v)}`)) : "",
          b.items?.length ? b.items.map((i) => `• ${fx(i)}`).join("\n") : "",
          b.pre ? `<pre>${b.pre}</pre>` : "",
          b.note ? `<blockquote>${fx(b.note)}</blockquote>` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      spec.note ? `<blockquote>${fx(spec.note)}</blockquote>` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

  async function sendCard(chatId, spec, { reply_to_message_id, reply_markup, ...rest } = {}) {
    if (richSupported) {
      try {
        return await callApi("sendRichMessage", {
          chat_id: chatId,
          rich_message: { html: renderRich(spec) },
          ...(reply_to_message_id ? { reply_parameters: { message_id: reply_to_message_id } } : {}),
          ...(reply_markup ? { reply_markup: styleMarkup(reply_markup) } : {}),
        });
      } catch (e) {
        console.warn("[bot.js] sendRichMessage failed, using HTML fallback:", e?.message);
        if (/method.*not found|not implemented|unknown method/i.test(e?.message || "")) {
          richSupported = false;
        }
      }
    }
    return safeReply(chatId, renderLegacy(spec), {
      reply_to_message_id,
      reply_markup: styleMarkup(reply_markup),
      disable_web_page_preview: true,
      ...rest,
    });
  }

  async function editCard(chatId, msgId, spec, { reply_markup, ...rest } = {}) {
    if (richSupported) {
      try {
        return await callApi("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          rich_message: { html: renderRich(spec) },
          ...(reply_markup ? { reply_markup: styleMarkup(reply_markup) } : {}),
        });
      } catch (e) {
        console.warn("[bot.js] rich edit failed, using HTML fallback:", e?.message);
      }
    }
    return safeEdit(chatId, msgId, renderLegacy(spec), {
      reply_markup: styleMarkup(reply_markup),
      disable_web_page_preview: true,
      ...rest,
    });
  }

  const countryText = (ci) =>
    ci ? `${isoToFlag(ci.iso)} <b>${esc(ci.name)}</b> (+${ci.callingCode})` : `<i>Unknown</i>`;



  function buildPairSuccessMessage(rawArg, rawCode, countryInfo) {
    const code = fmtCode(rawCode);

    const spec = {
      title: `${E("code")} Pair Code Ready`,
      rows: [
        ["Number", `<code>${esc(rawArg)}</code>`],
        ["Country", countryText(countryInfo)],
        ["Code", `${E("pairReady")} <code>${esc(code)}</code>`],
      ],
      section: {
        title: "📌 How To Link",
        items: [
          "WhatsApp → Settings → Linked Devices",
          `Tap "Link a Device" → "Link with phone number instead"`,
          "Enter the code shown above",
        ],
      },
      note: `${E("timer")} Code expires in about 3 minutes`,
    };

    const reply_markup = {
      inline_keyboard: [
        [{ text: code, copy_text: { text: code }, style: "success" }], // tap to copy (green)
        [{ text: "WA Channel", url: WA_CHANNEL_LINK, style: "primary" }],
      ],
    };
    return { spec, reply_markup };
  }

  const buildHelpSpec = () => ({
    title: `${E("sparkle")} XMD-FAHIM · WhatsApp Session Manager`,
    blocks: [
      {
        heading: "📲 Pairing",
        rows: [
          [`<code>/pair +88XXXXXXXXXX</code>`, "Create a link code"],
          [`<code>/ping</code>`, "Check response time"],
        ],
      },
      {
        heading: "🧰 Admin tools",
        rows: [
          [`<code>/sessions</code>`, "Connected accounts"],
          [`<code>/status</code>`, "Bot health and uptime"],
          [`<code>/restart NUMBER</code>`, "Reconnect an account"],
          [`<code>/stop NUMBER</code>`, "Pause an account"],
          [`<code>/logout NUMBER</code>`, "Remove an account"],
          [`<code>/reactp LINK [EMOJI]</code>`, "React to a channel post"],
          [`<code>/s NUMBER CODE</code>`, "Socket query"],
          [`<code>/as CODE</code>`, "Run on all sessions"],
          [`<code>/d COMMAND</code>`, "Server command"],
        ],
      },
      {
        heading: "💡 More",
        rows: [
          [`<code>/about</code>`, "About this bot"],
          [`<code>/health</code>`, "Runtime metrics"],
          [`<code>/id</code>`, "Chat and user IDs"],
          [`<code>/help</code> · <code>/commands</code>`, "This menu"],
        ],
      },
    ],
    note: "Use the full international number, including the country code.",
  });

  const buildHelpKeyboard = () => ({
    inline_keyboard: [
      [{ text: "Pair a WhatsApp account", callback_data: "pair_help" }],
      ...groupChannelKeyboard().inline_keyboard,
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAIRING CORE (shared by /pair and the callback button)
  //
  //  Only a genuinely CONNECTED session blocks a new pairing. Any stale or
  //  half-finished leftover for the same number is wiped automatically, so
  //  nobody needs to /logout by hand before pairing again.
  // ═══════════════════════════════════════════════════════════════════════════

  async function cleanupStaleSession(sid) {
    const entry = manager.sessions.get(sid);
    if (!entry) return;
    const stuck = ["starting", "reconnecting", "connecting"].includes(entry.status);
    const dead = entry.sock && manager.isRunning?.(sid) === false;
    if (stuck || dead) await manager.stop(sid).catch(() => {});
  }

  async function doPair(chatId, rawArg, replyToId) {
    const replyCard = (spec, opts = {}) =>
      sendCard(chatId, spec, { reply_to_message_id: replyToId, ...opts });

    const digits = normalizePhoneNumber(rawArg);
    if (!isValidPhone(digits)) {
      return replyCard({
        title: `${E("fail")} Invalid Number`,
        rows: [["Example", `<code>/pair +88017XXXXXXXX</code>`]],
        note: "Enter a valid international number (7–15 digits, no leading zero).",
      });
    }

    const countryInfo = detectCountry(digits);
    const sid = makeTempSessionId(digits);

    if (!manager.reservePhonePairing(digits, sid)) {
      return replyCard({
        title: "⏳ Pairing In Progress",
        note: "A pairing attempt is already running for this number. Please wait for it to finish.",
      });
    }

    // already connected?
    let connectedSid;
    try {
      connectedSid = await manager.findConnectedSessionIdByPhone(digits);
    } catch (error) {
      manager.releasePhonePairing(sid);
      return replyCard({
        title: `${E("fail")} Check Failed`,
        rows: [["Reason", esc(error?.message || error)]],
      });
    }
    if (connectedSid) {
      manager.releasePhonePairing(sid);
      return replyCard({
        title: "✘ Already Paired",
        rows: [["Number", `<code>${esc(rawArg)}</code>`]],
        note: `Use /restart ${esc(digits)} to reconnect it, or /logout ${esc(digits)} to remove it and pair again.`,
      });
    }

    // wipe stale leftovers for this phone
    try {
      await manager.cleanupPhoneSessions(digits);
    } catch (error) {
      manager.releasePhonePairing(sid);
      return replyCard({
        title: `${E("fail")} Cleanup Failed`,
        rows: [["Reason", esc(error?.message || error)]],
        note: "Could not clear an old pairing attempt.",
      });
    }

    const loadingMsg = await replyCard({
      title: "⏳ Generating Pair Code...",
      rows: [
        ["Number", `<code>${esc(rawArg)}</code>`],
        ["Country", countryText(countryInfo)],
      ],
      note: "Please wait a few seconds.",
    });

    // request the code from the manager (wa-multi-session / Baileys)
    let rawCode = null;
    try {
      await cleanupStaleSession(sid);
      rawCode = await manager.requestPairingCode(sid, digits, { timeoutMs: 30_000 });
    } catch (err) {
      await safeDelete(chatId, loadingMsg?.message_id);
      manager.logout(sid).catch(() => {}); // wipe partial creds
      return replyCard(
        {
          title: "✘ Pairing Not Successful",
          rows: [
            ["Number", `<code>+${esc(digits)}</code>`],
            ["Reason", esc(String(err?.message || err))],
          ],
          note: "Please try pairing again.",
        },
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `/pair +${digits}`, copy_text: { text: `/pair +${digits}` }, style: "danger" }],
            ],
          },
        },
      );
    }

    await safeDelete(chatId, loadingMsg?.message_id);

    if (!rawCode) {
      manager.releasePhonePairing(sid);
      manager.logout(sid).catch(() => {});
      return replyCard({
        title: `${E("fail")} No Code Returned`,
        note: "No pair code was returned — please try again.",
      });
    }

    const { spec, reply_markup } = buildPairSuccessMessage(rawArg, rawCode, countryInfo);
    const pairMsg = await replyCard(spec, { reply_markup });

    if (!pairMsg?.message_id) {
      manager.releasePhonePairing(sid);
      manager.logout(sid).catch(() => {});
      return pairMsg;
    }

    // ── watch the outcome in the background (never blocks the reply) ──
    const msgId = pairMsg.message_id;
    const displayNum = `+${digits}`;

    const connectedSpec = {
      title: `${E("connected")} Bot Connected Now!`,
      rows: [
        ["Status", `${E("ok")} Successfully linked`],
        ["Number", `<code>${esc(displayNum)}</code>`],
        ["Country", countryText(countryInfo)],
      ],
    };

    const failedSpec = {
      title: `${E("fail")} Pair Unsuccessful`,
      rows: [
        ["Status", `${E("timeout")} Timed out — the code was not used`],
        ["Number", `<code>${esc(displayNum)}</code>`],
      ],
      note: `${E("retry")} Please try again: <code>/pair ${esc(displayNum)}</code>`,
    };

    manager
      .awaitPairingOutcome(sid, { timeoutMs: 180_000 })
      .then(async ({ success }) => {
        if (success) {
          await editCard(chatId, msgId, connectedSpec, {
            reply_markup: { inline_keyboard: [[{ text: "WA Channel", url: WA_CHANNEL_LINK, style: "primary" }]] },
          });
          console.log(`[bot.js] ❤️‍🩹 Pair watcher: ${sid} connected`);
        } else {
          await editCard(chatId, msgId, failedSpec, {
            reply_markup: {
              inline_keyboard: [
                [{ text: `/pair ${displayNum}`, copy_text: { text: `/pair ${displayNum}` }, style: "danger" }],
                [{ text: "WA Channel", url: WA_CHANNEL_LINK, style: "primary" }],
              ],
            },
          });
          console.log(`[bot.js] 😴 Pair watcher: ${sid} did not complete`);
        }
      })
      .catch((e) =>
        console.error(`[bot.js] awaitPairingOutcome error for ${sid}:`, e?.message || e),
      );

    return pairMsg;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CODE-EXECUTION HELPERS (/s and /as)
  // ═══════════════════════════════════════════════════════════════════════════

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // runs `code` with `sock` in scope; rejects after `ms`, timer always cleared
  async function runWithSock(sock, code, ms = 30_000) {
    const fn = new AsyncFunction("sock", `return await (${code})`);
    let timer;
    try {
      return await Promise.race([
        fn(sock),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Execution timed out (${ms / 1000}s)`)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function describeResult(result) {
    if (result === undefined || result === null)
      return { str: String(result), summary: `<i>${result === null ? "null" : "undefined"}</i>` };
    if (Buffer.isBuffer(result) || result instanceof Uint8Array)
      return { str: `<Buffer ${result.byteLength} bytes>`, summary: `📦 Buffer — ${result.byteLength} bytes` };

    let str;
    try {
      str = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
    } catch {
      str = String(result);
    }
    if (Array.isArray(result)) return { str, summary: `📋 Array — ${result.length} items` };
    if (typeof result === "object")
      return { str, summary: `🗂 Object — ${Object.keys(result).length} keys` };
    return { str, summary: typeof result };
  }

  const errorHint = (msg = "") =>
    msg.includes("timed out") ? `⏰ ${F("Try a lighter query.")}`
    : msg.includes("not a function") ? `💡 ${F("Check the method name.")}`
    : msg.includes("Cannot read") ? `💡 ${F("A property may be undefined.")}`
    : msg.includes("Unexpected token") ? `💡 ${F("Remove semicolons (;) from the code.")}`
    : "";

  const sockUserName = (sock, fallback) =>
    sock?.user?.name || sock?.user?.id?.split(":")?.[0] || fallback;

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE REDIRECT
  // ═══════════════════════════════════════════════════════════════════════════

  const redirectToGroup = (chatId, replyToId) =>
    sendMedia("sendVideo", chatId, "https://files.catbox.moe/pohkxl.mp4", {
      caption: [
        `<b>🙂 ${M("Welcome to XMD-FAHIM ♡ WA Bot.")}</b>`,
        ``,
        `<b>⭐️ ${M("Pair your WA number — first join our group.")}</b>`,
        ``,
        `<b>${M("Then use the command below with your number:")} 🫠</b>`,
        ``,
        `<b>🇸🇻 ${M("Example:")} /pair +8801700282627</b>`,
        ``,
        `<b>${M("Make sure to include the country code.")} 💋</b>`,
      ].join("\n"),
      reply_to_message_id: replyToId,
      reply_markup: {
        inline_keyboard: [[{ text: fx("Join Official Group"), url: GROUP_INVITE_LINK }]],
      },
    });

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMMANDS
  //
  //  scope:  "group"    → only the allowed group
  //          "both"     → allowed group or private chat
  //          "redirect" → allowed group; private chats get the welcome video
  //  admin:  group admins only          owner: OWNER_IDS (or admins if unset)
  // ═══════════════════════════════════════════════════════════════════════════

  const phoneArg = (args) => normalizePhoneNumber(args);

  // shared body of /stop /logout /restart
  async function sessionAction({ rc, args, usage, run }) {
    const phone = phoneArg(args);
    if (!phone) {
      return rc({ title: "❓ Usage", rows: [["Command", `<code>${usage}</code>`]] });
    }
    const sid = await manager.findSessionIdByPhone(phone);
    if (!sid) {
      return rc({
        title: `${E("fail")} Session Not Found`,
        rows: [["Number", `<code>${esc(phone)}</code>`]],
        note: "No paired session found for this number.",
      });
    }
    try {
      return await run(sid, phone);
    } catch (e) {
      return rc({
        title: `${E("fail")} Action Failed`,
        rows: [["Reason", esc(e?.message)]],
      });
    }
  }

  const COMMANDS = {
    // ── /start ────────────────────────────────────────────────────────────────
    // (video captions can't be Rich Messages — Telegram limitation)
    start: {
      scope: "redirect",
      run: ({ chatId, replyId }) =>
        sendMedia("sendVideo", chatId, "https://files.catbox.moe/dh9yey.mp4", {
          caption: [
            `<b>𖠌 ${M("XMD-FAHIM Free WhatsApp Bot")}</b>`,
            ``,
            card(M("GET STARTED"), [
              `<b>➥ ${M("Pair your WA number:")}</b>`,
              `<b>✆ ${M("Example:")}</b> /pair +88017002826276`,
              `<b>ヅ ${M("Need help with pairing?")}</b> /help`,
            ]),
            ``,
            card(`♕ ${M("Developers")}`, [`${M("Fahim")} — @fariha_jannat_2`, `${M("Fahim")} — @fariha_jannat_2`]),
            ``,
            `<b>${M("Made with love by Fahim Bbz")} ♡</b>`,
          ].join("\n"),
          reply_to_message_id: replyId,
          reply_markup: styleMarkup({
            inline_keyboard: [
              [{ text: "Open help", callback_data: "help" }],
              ...groupChannelKeyboard().inline_keyboard,
            ],
          }),
        }),
    },

    // ── /help /commands ───────────────────────────────────────────────────────
    help: {
      scope: "redirect",
      run: ({ rc }) => rc(buildHelpSpec(), { reply_markup: buildHelpKeyboard() }),
    },

    // ── /about ────────────────────────────────────────────────────────────────
    about: {
      scope: "both",
      run: ({ rc }) =>
        rc({
          title: `${E("sparkle")} Xmd-Fahim WhatsApp Session Manager`,
          text: "Pair and manage WhatsApp sessions from Telegram.",
          rows: [
            ["Commands", `<code>/help</code>`],
            ["Telegram", `<a href="${esc(GROUP_INVITE_LINK)}">Official group</a>`],
            ["WhatsApp", `<a href="${esc(WA_CHANNEL_LINK)}">Channel</a>`],
          ],
          note: "Pairing codes are temporary. Only pair accounts you own or are authorized to manage.",
        }),
    },

    // ── /ping ─────────────────────────────────────────────────────────────────
    ping: {
      scope: "redirect",
      run: async ({ chatId, rc }) => {
        const start = Date.now();
        const m = await rc({ title: "🏓 Pong!", rows: [["Latency", "⚡ measuring..."]] });
        if (!m?.message_id) return m;
        return editCard(chatId, m.message_id, {
          title: "🏓 Pong!",
          rows: [["Latency", `⚡ <b>${Date.now() - start}ms</b>`]],
        });
      },
    },

    // ── /pair ─────────────────────────────────────────────────────────────────
    pair: {
      scope: "redirect",
      run: async ({ msg, args, chatId, replyId, rc }) => {
        if (!args) {
          return rc({
            title: `${E("ok")} Usage`,
            rows: [
              ["Example", `<code>/pair +917074420859</code>`],
              ["Example", `<code>/pair 88017074420859</code>`],
            ],
            note: `${E("globe")} Include your country code.`,
          });
        }

        const digits = normalizePhoneNumber(args);
        if (!isValidPhone(digits)) {
          return rc({
            title: "✘ Invalid Number",
            rows: [["Example", `<code>/pair +88017074420859</code>`]],
          });
        }

        const userId = msg.from?.id || msg.sender_chat?.id;
        const remaining = PAIR_COOLDOWN_MS - (Date.now() - (pairCooldown.get(userId) || 0));
        if (remaining > 0) {
          return rc({
            title: "❆ Slow Down",
            rows: [["Wait", `<b>${Math.ceil(remaining / 1000)}s</b>`]],
            note: "Please wait before requesting another code.",
          });
        }
        pairCooldown.set(userId, Date.now());

        return doPair(chatId, args, replyId);
      },
    },

    // ── /sessions ─────────────────────────────────────────────────────────────
    sessions: {
      scope: "group",
      admin: true,
      run: ({ rc }) => {
        const conns = manager.getAllConnections?.() || [];
        if (!conns.length) {
          return rc({ title: "🌙 No Active Sessions", note: "No sessions are currently registered." });
        }
        const online = conns.filter((c) => c.healthy).length;

        return rc({
          title: "🧩 Session Overview",
          rows: [
            ["Total", `<b>${conns.length}</b>`],
            ["Online", `🟢 <b>${online}</b>`],
            ["Offline", `🔴 <b>${conns.length - online}</b>`],
          ],
          blocks: [
            {
              heading: "Accounts",
              rows: conns.map((c, i) => {
                const sid = c.sessionId || c.file_path || c.id || "unknown";
                const user = sockUserName(c.connection, "—");
                const stat = c.status || (c.healthy ? "connected" : "disconnected");
                return [
                  `${c.healthy ? "🟢" : "🔴"} ${i + 1}`,
                  `<code>${esc(phoneFromSid(sid))}</code> · ${esc(user)} · <i>${esc(stat)}</i>`,
                ];
              }),
            },
          ],
        });
      },
    },

    // ── /status ───────────────────────────────────────────────────────────────
    status: {
      scope: "group",
      admin: true,
      run: ({ rc }) => {
        const conns = manager.getAllConnections?.() || [];
        const online = conns.filter((c) => c.healthy).length;
        return rc({
          title: `${E("sparkle")} Bot Status`,
          rows: [
            [`${E("clock")} Uptime`, `<code>${fmtUptime(Math.floor(process.uptime()))}</code>`],
            [`${E("memory")} Memory`, `<code>${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MB</code>`],
            [`${E("plug")} Sessions`, `<b>${conns.length}</b> (${online} 🟢)`],
            [`${E("health")} Platform`, `<code>${process.platform}</code>`],
            [`${E("settings")} Node.js`, `<code>${process.version}</code>`],
          ],
        });
      },
    },

    // ── /health ───────────────────────────────────────────────────────────────
    health: {
      scope: "group",
      admin: true,
      run: ({ rc }) => {
        const mem = process.memoryUsage();
        const sessions = manager.getAllConnections?.() || [];
        const online = sessions.filter((s) => s.healthy).length;
        const load = os.loadavg?.().map((v) => v.toFixed(2)).join(" / ") || "—";
        const up = Math.floor(process.uptime());
        return rc({
          title: `${E("health")} Runtime Health`,
          rows: [
            [`${E("memory")} RSS`, `<code>${(mem.rss / 1048576).toFixed(1)} MB</code>`],
            [`${E("memory")} Heap`, `<code>${(mem.heapUsed / 1048576).toFixed(1)} MB</code>`],
            [`${E("plug")} Sessions`, `<b>${online}</b> online / <b>${sessions.length}</b>`],
            [`${E("clock")} Uptime`, `<code>${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m</code>`],
            ["📈 Load", `<code>${load}</code>`],
            [`${E("settings")} Runtime`, `<code>${process.version}</code> · <code>${process.platform}</code>`],
          ],
        });
      },
    },

    // ── /id ───────────────────────────────────────────────────────────────────
    id: {
      scope: "group",
      admin: true,
      run: ({ msg, chatId, rc }) =>
        rc({
          title: "🪪 Telegram IDs",
          rows: [
            ["Chat", `<code>${esc(chatId)}</code>`],
            ["Your account", `<code>${esc(msg.from?.id || msg.sender_chat?.id || "unknown")}</code>`],
          ],
        }),
    },

    // ── /stop ─────────────────────────────────────────────────────────────────
    stop: {
      scope: "group",
      admin: true,
      run: (ctx) =>
        sessionAction({
          ...ctx,
          usage: "/stop 91XXXXXXXXXX",
          run: async (sid, phone) => {
            await manager.stop(sid);
            return ctx.rc({
              title: "⏹️ Session Stopped",
              rows: [["Number", `<code>${esc(phone)}</code>`]],
              note: "Credentials kept. Use /restart to reconnect.",
            });
          },
        }),
    },

    // ── /logout ───────────────────────────────────────────────────────────────
    logout: {
      scope: "group",
      admin: true,
      run: (ctx) =>
        sessionAction({
          ...ctx,
          usage: "/logout 91XXXXXXXXXX",
          run: async (sid, phone) => {
            await manager.logout(sid);
            return ctx.rc({
              title: "🗑️ Session Logged Out",
              rows: [["Number", `<code>${esc(phone)}</code>`]],
              note: "Credentials deleted. User must pair again.",
            });
          },
        }),
    },

    // ── /restart ──────────────────────────────────────────────────────────────
    restart: {
      scope: "group",
      admin: true,
      run: (ctx) =>
        sessionAction({
          ...ctx,
          usage: "/restart 91XXXXXXXXXX",
          run: async (sid, phone) => {
            await manager.stop(sid);
            await sleep(1500);
            await manager.start(sid);
            return ctx.rc({
              title: "🔄 Session Restarted",
              rows: [["Number", `<code>${esc(phone)}</code>`]],
            });
          },
        }),
    },

    // ── /reactp ───────────────────────────────────────────────────────────────
    reactp: {
      scope: "group",
      admin: true,
      run: async ({ args, rc }) => {
        const parts = (args || "").trim().split(/\s+/);
        const postLink = parts[0];

        if (!postLink?.startsWith("https://whatsapp.com/channel/")) {
          return rc({
            title: "❓ Usage",
            rows: [["Command", `<code>/reactp https://whatsapp.com/channel/xxx/123 🍉👀🎀</code>`]],
            note: "Emojis are optional — a random one is picked.",
          });
        }

        const emojis =
          parts.slice(1).join("").match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu) || ["🔥"];
        const chosen = emojis[Math.floor(Math.random() * emojis.length)];

        const active = (manager.getAllConnections() || []).find((c) => c.healthy);
        if (!active) {
          return rc({ title: `${E("fail")} No Session`, note: "No active WhatsApp session found." });
        }
        const sock = active.connection;

        await rc({ title: "⏳ Reacting...", rows: [["Chosen", chosen]] });

        try {
          const msgNumber = parseInt(postLink.split("/").pop(), 10);
          const info = await sock.newsletterInfo(postLink);
          const msgs = await sock.newsletterFetchMessages(info.id, 20);
          const target = msgs.find((m) => m.newsletterServerId === msgNumber);

          if (!target) {
            return rc({
              title: `${E("fail")} Post Not Found`,
              rows: [["Post", `#${msgNumber}`]],
              note: "Not found in the last 20 messages.",
            });
          }
          await sock.newsletterReactMessage(info.id, target.key.id, chosen);
          return rc({
            title: `${E("ok")} Reacted!`,
            rows: [
              ["📌 Post", `#${msgNumber}`],
              ["🎯 Emoji", chosen],
            ],
          });
        } catch (err) {
          return rc({
            title: `${E("fail")} Failed`,
            rows: [["Reason", esc(err?.message || String(err))]],
          });
        }
      },
    },

    // ── /s — run code on ONE session ──────────────────────────────────────────
    s: {
      scope: "group",
      admin: true,
      owner: true,
      run: async ({ args, chatId, replyId, rc }) => {
        const spaceIdx = (args || "").indexOf(" ");
        if (spaceIdx === -1) {
          return rc({
            title: "❓ Usage",
            rows: [
              ["Send", `<code>/s 88XXXXXXXXXX sock.sendMessage('jid', { text: 'hi' })</code>`],
              ["Groups", `<code>/s 91XXXXXXXXXX sock.groupFetchAllParticipating()</code>`],
              ["User", `<code>/s 91XXXXXXXXXX sock.user</code>`],
            ],
            note: "💡 Large results are sent as a .json file · timeout 30s",
          });
        }

        const phone = normalizePhoneNumber(args.slice(0, spaceIdx));
        const code = args.slice(spaceIdx + 1).trim();
        if (!phone || !code) {
          return rc({ title: `${E("fail")} Missing Input`, note: "Missing number or code." });
        }

        const sid = await manager.findSessionIdByPhone(phone);
        const entry = sid ? manager.sessions.get(sid) : null;
        if (!sid || !entry?.sock) {
          const all = [...(manager.sessions?.keys() || [])]
            .map((x) => `<code>${esc(phoneFromSid(x))}</code>`)
            .join(", ");
          return rc({
            title: `${E("fail")} Session Not Found`,
            rows: [
              ["Number", `<code>${esc(phone)}</code>`],
              ["Available", all || "none"],
            ],
          });
        }

        const sock = entry.sock;
        const user = sockUserName(sock, sid);
        const healthy = entry.status === "connected";
        const codePreview = `${esc(code.slice(0, 300))}${code.length > 300 ? "..." : ""}`;

        const statusMsg = await rc({
          title: "⏳ Executing...",
          rows: [
            ["Number", `<code>${esc(phone)}</code> (${esc(user)}) ${healthy ? "🟢" : "🔴"}`],
            ["Code", `<code>${codePreview}</code>`],
          ],
        });

        const t0 = Date.now();
        try {
          const result = await runWithSock(sock, code);
          const ms = Date.now() - t0;
          const { str, summary } = describeResult(result);
          await safeDelete(chatId, statusMsg?.message_id);

          const doneSpec = {
            title: `${E("ok")} Done!`,
            rows: [
              ["Number", `<code>${esc(phone)}</code> (${esc(user)})`],
              ["Type", summary],
              ["Time", `⚡ ${ms}ms`],
              ["Size", `📦 ${(str.length / 1024).toFixed(1)} KB`],
            ],
          };

          if (str.length <= 3000) {
            return rc({ ...doneSpec, blocks: [{ heading: "📤 Result", pre: esc(str) }] });
          }

          await sendAsFile(chatId, `s_${phone}.json`, str, {
            caption: renderLegacy({
              ...doneSpec,
              note: `<code>${esc(code.slice(0, 150))}${code.length > 150 ? "..." : ""}</code>`,
            }),
            reply_to_message_id: replyId,
          });
          return rc({
            title: "👁 Preview",
            note: "First 500 characters",
            blocks: [{ pre: `${esc(str.slice(0, 500))}...` }],
          });
        } catch (err) {
          await safeDelete(chatId, statusMsg?.message_id);
          const m = err?.message || String(err);
          return rc({
            title: `${E("fail")} Error`,
            rows: [
              ["Number", `<code>${esc(phone)}</code>`],
              ["Time", `⚡ ${Date.now() - t0}ms`],
              ["Message", `<code>${esc(m)}</code>`],
              ...(errorHint(m) ? [["Hint", errorHint(m)]] : []),
            ],
          });
        }
      },
    },

    // ── /as — run code on ALL connected sessions ─────────────────────────────
    as: {
      scope: "group",
      admin: true,
      owner: true,
      run: async ({ args, chatId, replyId, rc }) => {
        const code = (args || "").trim();
        if (!code) {
          return rc({
            title: "❓ Usage",
            rows: [
              ["Send", `<code>/as sock.sendMessage('jid', { text: 'hi' })</code>`],
              ["Follow", `<code>/as sock.newsletterFollow('120363xxx@newsletter')</code>`],
              ["Bio", `<code>/as sock.updateProfileStatus('new bio')</code>`],
            ],
            note: "💡 Runs on ALL connected sessions at once",
          });
        }

        const entries = [...manager.sessions.entries()].filter(
          ([, e]) => e?.sock && e.status === "connected",
        );
        if (!entries.length) {
          return rc({ title: `${E("fail")} No Sessions`, note: "No active sessions found." });
        }

        const codePreview = `${esc(code.slice(0, 300))}${code.length > 300 ? "..." : ""}`;
        const statusMsg = await rc({
          title: "⏳ Running on ALL sessions...",
          rows: [
            ["Sessions", `<b>${entries.length}</b>`],
            ["Code", `<code>${codePreview}</code>`],
          ],
        });

        const t0 = Date.now();
        const results = await Promise.allSettled(
          entries.map(async ([sid, entry]) => ({ sid, result: await runWithSock(entry.sock, code) })),
        );
        const ms = Date.now() - t0;
        await safeDelete(chatId, statusMsg?.message_id);

        let ok = 0;
        let bad = 0;
        const rows = results.map((r, i) => {
          const [sid, entry] = entries[i];
          const phone = phoneFromSid(sid);
          const user = sockUserName(entry.sock, phone);
          if (r.status === "fulfilled") {
            ok++;
            let out;
            try {
              out = r.value.result === undefined ? "void" : JSON.stringify(r.value.result)?.slice(0, 100);
            } catch {
              out = String(r.value.result).slice(0, 100);
            }
            return [`✅ <code>${esc(phone)}</code> (${esc(user)})`, `<i>${esc(out)}</i>`];
          }
          bad++;
          return [
            `❌ <code>${esc(phone)}</code> (${esc(user)})`,
            `<i>${esc((r.reason?.message || String(r.reason)).slice(0, 100))}</i>`,
          ];
        });

        const spec = {
          title: "📊 All Sessions Done!",
          rows: [
            ["Time", `⚡ ${ms}ms`],
            ["Success", `✅ <b>${ok}</b>`],
            ["Failed", `❌ <b>${bad}</b>`],
            ["Total", `🔢 <b>${entries.length}</b>`],
          ],
          blocks: [
            { heading: "Code", text: `<code>${esc(code.slice(0, 150))}${code.length > 150 ? "..." : ""}</code>` },
            { heading: "Results", rows },
          ],
        };

        if (rows.length <= 20 && renderLegacy(spec).length <= 3500) return rc(spec);

        const plain = results
          .map((r, i) =>
            r.status === "fulfilled"
              ? `✅ ${entries[i][0]}\n${JSON.stringify(r.value.result, null, 2)}\n`
              : `❌ ${entries[i][0]}\n${r.reason?.message || r.reason}\n`,
          )
          .join("\n---\n");

        return sendAsFile(chatId, "as_result.txt", plain, {
          caption: renderLegacy({ ...spec, blocks: [] }),
          reply_to_message_id: replyId,
        });
      },
    },

    // ── /d — shell command ────────────────────────────────────────────────────
    // ⚠️ Remote code execution by design. Set OWNER_IDS in config.js to limit
    // /d, /s and /as to specific Telegram user IDs instead of every group admin.
    d: {
      scope: "group",
      admin: true,
      owner: true,
      run: async ({ args, chatId, replyId, rc }) => {
        const rawCmd = (args || "").trim();
        if (!rawCmd) {
          return rc({
            title: "ℹ️ Usage",
            rows: [
              ["Git", `<code>/d git pull</code>`],
              ["PM2", `<code>/d pm2 list</code>`],
              ["Disk", `<code>/d df -h</code>`],
            ],
          });
        }

        const MAX_LINES = 50;
        const TIMEOUT_MS = 30_000;
        const MAX_TEXT_CHARS = 1800;

        await rc({
          title: "⚙️ Executing...",
          rows: [["Command", `<code>${esc(rawCmd)}</code>`]],
        });

        const lines = [];
        let killed = false;
        const child = spawn("bash", ["-lc", rawCmd], { env: process.env });
        const killTimer = setTimeout(() => {
          killed = true;
          try {
            child.kill("SIGKILL");
          } catch {}
        }, TIMEOUT_MS);

        const pushLines = (chunk, src) =>
          chunk
            .toString()
            .split(/\r?\n/)
            .forEach((ln) => {
              if (ln && lines.length < MAX_LINES) lines.push(src === "err" ? `[ERR] ${ln}` : ln);
            });

        child.stdout.on("data", (c) => pushLines(c, "out"));
        child.stderr.on("data", (c) => pushLines(c, "err"));

        child.on("error", async (err) => {
          clearTimeout(killTimer);
          await rc({
            title: `${E("fail")} Spawn Error`,
            rows: [["Reason", esc(String(err.message))]],
          });
        });

        child.on("close", async (code) => {
          clearTimeout(killTimer);
          if (!lines.length) {
            return rc({ title: "⚠️ No Output", note: "The command produced no output." });
          }

          const spec = {
            title: `${code === 0 ? E("ok") : E("fail")} Command Finished`,
            rows: [
              ["Command", `<code>${esc(rawCmd)}</code>`],
              ["Exit", `<b>${code ?? "null"}</b>${killed ? " (killed — timeout)" : ""}`],
            ],
          };
          const payload = `$ ${rawCmd}\nExit: ${code ?? "null"}${killed ? " (killed — timeout)" : ""}\n${"─".repeat(30)}\n${lines.join("\n")}`.trim();

          if (payload.length > MAX_TEXT_CHARS || lines.length >= MAX_LINES) {
            const sent = await sendAsFile(chatId, "cmd_output.txt", payload, {
              caption: renderLegacy({ ...spec, title: `📄 ${spec.title}` }),
              reply_to_message_id: replyId,
            });
            if (!sent) {
              await rc({ ...spec, blocks: [{ heading: "Output preview", pre: esc(payload.slice(0, 1500)) }] });
            }
          } else {
            await rc({ ...spec, blocks: [{ heading: "Output", pre: esc(lines.join("\n")) }] });
          }
        });
      },
    },
  };

  // aliases
  COMMANDS.commands = COMMANDS.help;
  COMMANDS.session = COMMANDS.sessions;

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMMAND PARSER + DISPATCHER
  // ═══════════════════════════════════════════════════════════════════════════

  // Accepts both "/cmd" and ".cmd" (Telegram only tags "/" as a bot_command)
  function parseCmd(msg) {
    if (!msg?.text) return null;
    const first = msg.entities?.[0];
    if (first?.type === "bot_command" && first.offset === 0) {
      return {
        cmd: msg.text.slice(0, first.length).split(/[@\s]/)[0].replace(/^[/.]/, "").toLowerCase(),
        args: msg.text.slice(first.length).trim(),
      };
    }
    if (!/^[/.]/.test(msg.text)) return null;
    const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
    return {
      cmd: rawCmd.split("@")[0].replace(/^[/.]/, "").toLowerCase(),
      args: rest.join(" ").trim(),
    };
  }

  async function handleCommand(msg) {
    const parsed = parseCmd(msg);
    if (!parsed) return;

    const { cmd, args } = parsed;
    const chatId = msg.chat.id;
    const replyId = msg.message_id;
    const reply = (text, opts = {}) =>
      safeReply(chatId, text, { reply_to_message_id: replyId, ...opts });
    const rc = (spec, opts = {}) =>
      sendCard(chatId, spec, { reply_to_message_id: replyId, ...opts });

    console.log(`[bot.js] /${cmd} from ${msg.from?.id || msg.sender_chat?.id} in ${chatId}`);

    const def = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
    const okGroup = isAllowedGroup(msg);

    // unknown command → only answer inside the allowed group
    if (!def) {
      if (!okGroup) return;
      return rc({
        title: "💢 Unknown Command",
        rows: [["Command", `<code>/${esc(cmd)}</code>`]],
        note: "Try /help to see available commands.",
      });
    }

    // scope check
    const priv = isPrivate(msg);
    if (def.scope === "redirect" && priv) return redirectToGroup(chatId, replyId);
    if (!(def.scope === "both" ? priv || okGroup : okGroup)) return;

    // permission checks
    if (def.admin && !(await isAdmin(msg))) {
      return rc({ title: "🚫 Admins Only", note: "This command is restricted to group admins." });
    }
    if (def.owner && !(await isOwner(msg))) {
      return rc({ title: "🚫 Owner Only", note: "This command is restricted to the bot owner." });
    }

    return def.run({ msg, cmd, args, chatId, replyId, reply, rc });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  // Leave groups that aren't the official one
  tbot.on("new_chat_members", async (msg) => {
    try {
      if (!botId || !msg?.new_chat_members?.some((m) => m.id === botId)) return;

      if (!isAllowedGroup(msg)) {
        console.log("[bot.js] Added to unauthorized group:", msg.chat.id, "— leaving");
        await sendCard(msg.chat.id, {
          title: "🔒 Official Group Only",
          rows: [["Join", `<a href="${esc(GROUP_INVITE_LINK)}">Official Telegram group</a>`]],
          note: "This bot is available in our official Telegram group.",
        });
        await tbot.leaveChat(msg.chat.id).catch(() => {});
      } else {
        await sendCard(msg.chat.id, {
          title: "🎉 XMD-Fahim Is Ready",
          note: "Use /help to browse commands or /pair to link a WhatsApp account.",
        });
      }
    } catch (e) {
      console.error("[bot.js] new_chat_members error:", e);
    }
  });

  // Inline buttons
  tbot.on("callback_query", async (query) => {
    const { data, id, message } = query;
    const chatId = message?.chat?.id;

    try {
      if (!data || !chatId) return tbot.answerCallbackQuery(id).catch(() => {});

      // "Pair again" button: data = "repairr:DIGITS"
      if (data.startsWith("repairr:")) {
        const digits = data.split(":")[1];
        if (!digits) return tbot.answerCallbackQuery(id).catch(() => {});

        const userId = query.from?.id;
        const remaining = PAIR_COOLDOWN_MS - (Date.now() - (pairCooldown.get(userId) || 0));
        if (remaining > 0) {
          return tbot
            .answerCallbackQuery(id, {
              text: `⏳ Please wait ${Math.ceil(remaining / 1000)}s before re-pairing.`,
              show_alert: true,
            })
            .catch(() => {});
        }
        pairCooldown.set(userId, Date.now());
        await tbot.answerCallbackQuery(id).catch(() => {});
        return doPair(chatId, `+${digits}`, message?.message_id);
      }

      await tbot.answerCallbackQuery(id).catch(() => {});
      if (!(isPrivate(message) || isAllowedGroup(message))) return;

      if (data === "help") {
        return sendCard(chatId, buildHelpSpec(), {
          reply_to_message_id: message.message_id,
          reply_markup: buildHelpKeyboard(),
        });
      }

      if (data === "pair_help") {
        return sendCard(
          chatId,
          {
            title: "📲 Pair A WhatsApp Account",
            rows: [["Command", `<code>/pair +CCXXXXXXXXXX</code>`]],
            note: "Send this in the official group. Replace CCXXXXXXXXXX with your full number, including the country code. The linking code expires after a few minutes.",
          },
          {
            reply_to_message_id: message.message_id,
            reply_markup: { inline_keyboard: [[{ text: "Join official group", url: GROUP_INVITE_LINK }]] },
          },
        );
      }
    } catch (e) {
      console.error("[bot.js] callback_query error:", e);
    }
  });

  // Every message → command handler
  tbot.on("message", async (msg) => {
    try {
      const sender = msg.from?.username || msg.from?.id || msg.sender_chat?.id || "?";
      console.log(
        `[bot.js] 📩 [${msg.chat?.id}/${msg.chat?.type}] @${sender}: ${(msg.text || "").slice(0, 120)}`,
      );
    } catch {}

    try {
      await handleCommand(msg);
    } catch (e) {
      console.error("[bot.js] handleCommand error:", e);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  WEBHOOK / POLLING
  // ═══════════════════════════════════════════════════════════════════════════

  if (USE_WEBHOOK) {
    try {
      const webhookUrl = `${RAILWAY_URL.replace(/\/$/, "")}/bot${BOT_TOKEN}`;
      await tbot.setWebHook(webhookUrl);
      console.log("[bot.js] ✅ Webhook set:", webhookUrl);
      const info = await tbot.getWebHookInfo();
      console.log("[bot.js] 🔎 Webhook info:", info.url, info.last_error_message || "ok");
    } catch (e) {
      console.error("[bot.js] Webhook setup failed:", e?.message);
    }
  } else {
    console.log("[bot.js] ℹ️  Polling mode (dev).");
  }

  // Graceful shutdown hook for app.js
  tbot.cleanup = async () => {
    try {
      clearInterval(cooldownSweepTimer);
      if (USE_WEBHOOK) await tbot.deleteWebHook().catch(() => {});
      else await tbot.stopPolling().catch(() => {});
      console.log("[bot.js] 🛑 Telegram bot stopped.");
    } catch {}
  };

  try {
    global.tbot = tbot;
  } catch {}
  return tbot;
}
