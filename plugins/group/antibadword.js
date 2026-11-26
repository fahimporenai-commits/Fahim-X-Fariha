import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { isSudo } from "../../lib/sudo.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

// ম্যানুয়ালি ডিফল্ট সেট করা Badwords (যত খুশি যোগ করতে পারবেন)
const DEFAULT_BADWORDS = [
  "fuck",
  "sex",
  "bal",
  "choda",
  "magi",
  "khanki",
  "bhenchod",
  "madarchod",
];

const DEFAULT_WARN_LIMIT = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getChatId(message) {
  return message?.from || message?.key?.remoteJid || "";
}

function cleanDigits(jid) {
  if (!jid) return "";
  return String(jid)
    .split("@")[0]
    .split(":")[0]
    .split("_")[0]
    .replace(/\D/g, "");
}

function toUserJid(raw) {
  if (!raw) return "";
  const str = String(raw).trim();
  if (str.includes("@")) return str;
  const digits = cleanDigits(str);
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function normalizeWord(word) {
  return String(word || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0980-\u09ff]/gi, "");
}

function normalizeHaystack(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff]+/gi, "");
}

function getNs(message) {
  return message?.botnum || cleanDigits(getSock(message)?.user?.id) || "miku_antibadword_db";
}

function getCfgKey(groupJid) {
  return `antibadword:group:${groupJid}:config_v2`;
}

function getWarnKey(groupJid) {
  return `antibadword:group:${groupJid}:warns_v2`;
}

function getGroupConfig(message, groupJid) {
  const fallbackWords = [...new Set(DEFAULT_BADWORDS.map(normalizeWord).filter(Boolean))];
  try {
    const saved = db.get(getNs(message), getCfgKey(groupJid), null);
    if (!saved || typeof saved !== "object") {
      return {
        deleteEnabled: false,
        warnEnabled: false,
        warnLimit: DEFAULT_WARN_LIMIT,
        instantKick: false,
        words: fallbackWords,
      };
    }

    const warnNum = Number(saved.warnLimit);
    const wordsList = Array.isArray(saved.words)
      ? [...new Set([...fallbackWords, ...saved.words.map(normalizeWord).filter(Boolean)])]
      : fallbackWords;

    return {
      deleteEnabled: Boolean(saved.deleteEnabled),
      warnEnabled: Boolean(saved.warnEnabled),
      warnLimit: warnNum === 2 || warnNum === 3 ? warnNum : DEFAULT_WARN_LIMIT,
      instantKick: Boolean(saved.instantKick),
      words: wordsList,
    };
  } catch {
    return {
      deleteEnabled: false,
      warnEnabled: false,
      warnLimit: DEFAULT_WARN_LIMIT,
      instantKick: false,
      words: fallbackWords,
    };
  }
}

function saveGroupConfig(message, groupJid, cfg) {
  try {
    db.setHot(getNs(message), getCfgKey(groupJid), {
      deleteEnabled: Boolean(cfg.deleteEnabled),
      warnEnabled: Boolean(cfg.warnEnabled),
      warnLimit: Number(cfg.warnLimit) === 2 ? 2 : 3,
      instantKick: Boolean(cfg.instantKick),
      words: [...new Set((cfg.words || []).map(normalizeWord).filter(Boolean))],
    });
  } catch (err) {
    console.error("[antibadword] save config error:", err?.message || err);
  }
}

function getGroupWarns(message, groupJid) {
  try {
    const data = db.get(getNs(message), getWarnKey(groupJid), {});
    return data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  } catch {
    return {};
  }
}

function saveGroupWarns(message, groupJid, warns) {
  try {
    db.setHot(getNs(message), getWarnKey(groupJid), warns);
  } catch (err) {
    console.error("[antibadword] save warns error:", err?.message || err);
  }
}

function findMatchedBadwords(text, words) {
  const rawLower = String(text || "").toLowerCase();
  const compact = normalizeHaystack(text);
  const matched = [];

  for (const w of words) {
    const cleanW = normalizeWord(w);
    if (!cleanW || cleanW.length < 2) continue;
    if (compact.includes(cleanW) || rawLower.includes(cleanW)) {
      matched.push(cleanW);
    }
  }

  return [...new Set(matched)];
}

async function deleteMessage(message, chatId) {
  const sock = getSock(message);
  const key = message?.key || message?.raw?.key;
  if (!sock || !key) return false;

  try {
    if (typeof message?.delete === "function") {
      await message.delete();
      return true;
    }
  } catch (_) {}

  try {
    await sock.sendMessage(chatId, { delete: key });
    return true;
  } catch (err) {
    console.error("[antibadword] delete error:", err?.message || err);
    return false;
  }
}

async function kickUser(message, chatId, targetJid) {
  if (typeof message?.removeParticipant === "function") {
    try {
      const res = await message.removeParticipant(targetJid);
      if (res) return true;
    } catch (_) {}
  }

  const sock = getSock(message);
  if (sock && typeof sock.groupParticipantsUpdate === "function") {
    const jid = toUserJid(targetJid);
    if (jid) {
      await sock.groupParticipantsUpdate(chatId, [jid], "remove");
      return true;
    }
  }

  return false;
}

async function sendTextWithMentions(message, chatId, text, mentions = []) {
  const sock = getSock(message);
  const payload = mentions.length > 0 ? { text, mentions } : { text };

  if (sock && typeof sock.sendMessage === "function") {
    return sock.sendMessage(chatId, payload);
  }
  if (typeof message?.send === "function") {
    return message.send(text, mentions.length > 0 ? { mentions } : {});
  }
  return null;
}

function isProtectedSender(message, senderDigits, senderJid) {
  if (
    message?.isFromMe ||
    message?.isfromMe ||
    message?.key?.fromMe ||
    message?.isOwner ||
    message?.isSudo ||
    message?.isAdmin
  ) {
    return true;
  }

  const botDigits = cleanDigits(message?.botJid || message?.botLid || message?.botnum);
  if (botDigits && senderDigits === botDigits) return true;

  if (isSudo(message, senderJid, senderDigits)) return true;

  const admins = Array.isArray(message?.groupAdmins) ? message.groupAdmins : [];
  if (admins.some((a) => cleanDigits(a) === senderDigits)) return true;

  return false;
}

function isAnyFeatureOn(cfg) {
  return Boolean(cfg.deleteEnabled || cfg.warnEnabled || cfg.instantKick);
}

Module({
  command: "antibadword",
  aliases: ["badword", "abw"],
  package: "group",
  description: "Granular badword controls: delete on/off, warn on/off, warn 2/3, kick on/off, set words, list",
})(async (message, match) => {
  try {
    const chatId = getChatId(message);
    if (!message?.isGroup || !chatId) {
      return message.send(theme.isGroup);
    }

    if (typeof message.loadGroupInfo === "function") {
      await message.loadGroupInfo().catch(() => {});
    }

    const canManage = Boolean(
      message.isAdmin || message.isOwner || message.isSudo || message.isFromMe || message.isfromMe,
    );
    if (!canManage) {
      return message.send(theme.isAdmin);
    }

    const prefix = message?.prefix || ".";
    const raw = String(match || "").trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = String(parts[0] || "status").toLowerCase();
    const arg2 = String(parts[1] || "").toLowerCase();
    const rest = parts.slice(1).join(" ").trim();

    const cfg = getGroupConfig(message, chatId);

    // .antibadword delete on / off
    if (sub === "delete" || sub === "delmsg") {
      if (arg2 === "on" || arg2 === "enable") {
        cfg.deleteEnabled = true;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          "✅ *Anti-Badword Delete* চালু করা হয়েছে (শুধু badword মেসেজ ডিলিট করবে)।",
        );
      }
      if (arg2 === "off" || arg2 === "disable") {
        cfg.deleteEnabled = false;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          "🛑 *Anti-Badword Delete* বন্ধ করা হয়েছে।",
        );
      }
      return sendTextWithMentions(
        message,
        chatId,
        `⚙️ ব্যবহার করুন: \`${prefix}antibadword delete on\` অথবা \`${prefix}antibadword delete off\``,
      );
    }

    // .antibadword warn on / off / 2 / 3
    if (sub === "warn" || sub === "warning" || sub === "warnlimit") {
      if (arg2 === "on" || arg2 === "enable") {
        cfg.warnEnabled = true;
        cfg.deleteEnabled = true;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          `✅ *Anti-Badword Warn* চালু করা হয়েছে (Delete + Warning active, Limit: *${cfg.warnLimit}*)।`,
        );
      }
      if (arg2 === "off" || arg2 === "disable") {
        cfg.warnEnabled = false;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          "🛑 *Anti-Badword Warn* বন্ধ করা হয়েছে।",
        );
      }
      if (arg2 === "2" || arg2 === "3") {
        cfg.warnLimit = Number(arg2);
        cfg.warnEnabled = true;
        cfg.deleteEnabled = true;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          `✅ *Anti-Badword Warn Limit* সেট হয়েছে *${cfg.warnLimit}* (Delete + Warn Count active, *${cfg.warnLimit}* পূর্ণ হলে Kick করবে)।`,
        );
      }

      return sendTextWithMentions(
        message,
        chatId,
        `⚙️ Warn কমান্ডসমূহ:\n` +
          `• \`${prefix}antibadword warn on\`\n` +
          `• \`${prefix}antibadword warn off\`\n` +
          `• \`${prefix}antibadword warn 2\`\n` +
          `• \`${prefix}antibadword warn 3\``,
      );
    }

    // .antibadword kick on / off (Instant Kick)
    if (sub === "kick" || sub === "instakick" || sub === "instantkick") {
      if (arg2 === "on" || arg2 === "enable") {
        cfg.instantKick = true;
        cfg.deleteEnabled = true;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          "⚡ *Anti-Badword Instant Kick* চালু করা হয়েছে! Badword দিলে সাথে সাথে ডিলিট ও কিক করবে।",
        );
      }
      if (arg2 === "off" || arg2 === "disable") {
        cfg.instantKick = false;
        saveGroupConfig(message, chatId, cfg);
        return sendTextWithMentions(
          message,
          chatId,
          "🛑 *Anti-Badword Instant Kick* বন্ধ করা হয়েছে।",
        );
      }
      return sendTextWithMentions(
        message,
        chatId,
        `⚙️ ব্যবহার করুন: \`${prefix}antibadword kick on\` অথবা \`${prefix}antibadword kick off\``,
      );
    }

    // সব ফিচার একসাথে অফ করতে চাইলে
    if (sub === "off" || sub === "disable") {
      cfg.deleteEnabled = false;
      cfg.warnEnabled = false;
      cfg.instantKick = false;
      saveGroupConfig(message, chatId, cfg);
      return sendTextWithMentions(
        message,
        chatId,
        "🛑 *Anti-Badword*-এর সব অপশন বন্ধ করা হয়েছে।",
      );
    }

    // .antibadword set fuck sex bal
    if (sub === "set" || sub === "add") {
      if (!rest) {
        return sendTextWithMentions(
          message,
          chatId,
          `⚠️ অন্তত একটি শব্দ দিন!\n\n👉 \`${prefix}antibadword set fuck sex bal\``,
        );
      }

      const incoming = rest
        .split(/[\s,]+/)
        .map(normalizeWord)
        .filter((w) => w.length >= 2);

      if (!incoming.length) {
        return sendTextWithMentions(message, chatId, "⚠️ কোনো বৈধ শব্দ পাওয়া যায়নি।");
      }

      const beforeCount = cfg.words.length;
      cfg.words = [...new Set([...cfg.words, ...incoming])];
      saveGroupConfig(message, chatId, cfg);
      const addedCount = cfg.words.length - beforeCount;

      return sendTextWithMentions(
        message,
        chatId,
        `✅ *${addedCount}* টি নতুন badword যোগ করা হয়েছে।\n` +
          `📊 মোট অ্যাড করা শব্দ: *${cfg.words.length}*\n` +
          `📝 যোগকৃত: \`${incoming.join(", ")}\``,
      );
    }

    if (sub === "delword" || sub === "remove" || sub === "rmword") {
      if (!rest) {
        return sendTextWithMentions(
          message,
          chatId,
          `⚠️ যে শব্দ সরাতে চান তা লিখুন!\n\n👉 \`${prefix}antibadword delword bal\``,
        );
      }

      const toRemove = new Set(
        rest
          .split(/[\s,]+/)
          .map(normalizeWord)
          .filter(Boolean),
      );

      const beforeCount = cfg.words.length;
      cfg.words = cfg.words.filter((w) => !toRemove.has(w));
      saveGroupConfig(message, chatId, cfg);
      const removedCount = beforeCount - cfg.words.length;

      return sendTextWithMentions(
        message,
        chatId,
        `🗑️ *${removedCount}* টি শব্দ লিস্ট থেকে সরানো হয়েছে।\n` +
          `📊 বর্তমান মোট শব্দ: *${cfg.words.length}*`,
      );
    }

    if (sub === "list" || sub === "words" || sub === "count") {
      const wordListText = cfg.words.length
        ? cfg.words.map((w, i) => `${i + 1}. \`${w}\``).join("\n")
        : "Empty";

      return sendTextWithMentions(
        message,
        chatId,
        `╭─〔 🚫 𝐀𝐍𝐓𝐈-𝐁𝐀𝐃𝐖𝐎𝐑𝐃 𝐋𝐈𝐒𝐓 〕\n` +
          `│ 📊 Total Added Words: *${cfg.words.length}*\n` +
          `│ 🗑️ Delete: *${cfg.deleteEnabled ? "ON" : "OFF"}*\n` +
          `│ ⚠️ Warn: *${cfg.warnEnabled ? `ON (${cfg.warnLimit})` : "OFF"}*\n` +
          `│ ⚡ Instant Kick: *${cfg.instantKick ? "ON" : "OFF"}*\n` +
          `╰────────────────────────\n\n` +
          `${wordListText}`,
      );
    }

    return sendTextWithMentions(
      message,
      chatId,
      `╭─〔 🛡️ 𝐀𝐍𝐓𝐈-𝐁𝐀𝐃𝐖𝐎𝐑𝐃 𝐒𝐓𝐀𝐓𝐔𝐒 〕\n` +
        `│ 🗑️ Delete: *${cfg.deleteEnabled ? "ON" : "OFF"}*\n` +
        `│ ⚠️ Warn: *${cfg.warnEnabled ? "ON" : "OFF"}*\n` +
        `│ 🔢 Warn Limit: *${cfg.warnLimit}*\n` +
        `│ ⚡ Instant Kick: *${cfg.instantKick ? "ON" : "OFF"}*\n` +
        `│ 📊 Total Words: *${cfg.words.length}*\n` +
        `╰──────────────────────────\n\n` +
        `📌 *Commands:*\n` +
        `• \`${prefix}antibadword delete on / off\`\n` +
        `• \`${prefix}antibadword warn on / off\`\n` +
        `• \`${prefix}antibadword warn 2\` বা \`3\`\n` +
        `• \`${prefix}antibadword kick on / off\`\n` +
        `• \`${prefix}antibadword set fuck sex bal\`\n` +
        `• \`${prefix}antibadword list\``,
    );
  } catch (err) {
    console.error("[antibadword] command error:", err);
  }
});

// Auto-moderation listener
Module({
  on: "text",
  package: "group",
  description: "Monitor group messages for badwords based on active settings",
})(async (message) => {
  try {
    const chatId = getChatId(message);
    if (!message?.isGroup || !chatId) return;

    const text = String(message?.body || "").trim();
    if (!text) return;

    const prefix = message?.prefix || ".";
    const lowerText = text.toLowerCase();
    if (
      lowerText.startsWith(`${prefix}antibadword`) ||
      lowerText.startsWith(`${prefix}badword`) ||
      lowerText.startsWith(`${prefix}abw`)
    ) {
      return;
    }

    const cfg = getGroupConfig(message, chatId);
    if (!isAnyFeatureOn(cfg) || !cfg.words.length) return;

    const matchedWords = findMatchedBadwords(text, cfg.words);
    if (!matchedWords.length) return;

    if (typeof message.loadGroupInfo === "function") {
      await message.loadGroupInfo().catch(() => {});
    }

    let senderDigits = cleanDigits(message.sender || message.senderAlt);
    if ((!senderDigits || message.sender?.endsWith("@lid")) && typeof message.getSenderNumber === "function") {
      const resolved = await message.getSenderNumber().catch(() => null);
      if (resolved) senderDigits = cleanDigits(resolved);
    }
    const senderJid = toUserJid(senderDigits || message.sender || message.senderAlt);

    if (isProtectedSender(message, senderDigits, senderJid)) return;

    const warnKey = senderDigits || cleanDigits(message.sender) || "unknown";
    const tag = warnKey !== "unknown" ? `@${warnKey}` : message.pushName || "User";
    const mentions = senderJid ? [senderJid] : [];

    // Always delete when any active rule is enabled
    if (cfg.deleteEnabled || cfg.warnEnabled || cfg.instantKick) {
      await deleteMessage(message, chatId);
    }

    // 1. Instant Kick enabled
    if (cfg.instantKick) {
      if (!message.isBotAdmin) {
        await sendTextWithMentions(
          message,
          chatId,
          `🚨 ${tag} badword (\`${matchedWords.join(", ")}\`) ব্যবহার করেছে, কিন্তু বট অ্যাডমিন না থাকায় instant kick করা যায়নি!`,
          mentions,
        );
        return;
      }

      await sendTextWithMentions(
        message,
        chatId,
        `⚡ *INSTANT BADWORD KICK!*\n\n` +
          `👤 User: ${tag}\n` +
          `🚫 Word: \`${matchedWords.join(", ")}\`\n` +
          `🔨 Action: Instant Kick!`,
        mentions,
      );

      await sleep(250);
      await kickUser(message, chatId, senderJid);
      return;
    }

    // 2. Warn enabled (with warnLimit 2 or 3)
    if (cfg.warnEnabled) {
      const warns = getGroupWarns(message, chatId);
      const nextWarn = Number(warns[warnKey] || 0) + 1;

      if (nextWarn >= cfg.warnLimit) {
        delete warns[warnKey];
        saveGroupWarns(message, chatId, warns);

        if (!message.isBotAdmin) {
          await sendTextWithMentions(
            message,
            chatId,
            `🚨 ${tag} badword (\`${matchedWords.join(", ")}\`) ব্যবহার করে *${cfg.warnLimit}/${cfg.warnLimit}* ওয়ার্নিং পূর্ণ করেছে, কিন্তু বট অ্যাডমিন না থাকায় কিক করা যায়নি!`,
            mentions,
          );
          return;
        }

        await sendTextWithMentions(
          message,
          chatId,
          `☠️ *BADWORD WARN LIMIT REACHED — KICK!*\n\n` +
            `👤 User: ${tag}\n` +
            `🚫 Word: \`${matchedWords.join(", ")}\`\n` +
            `⚠️ Warning: *${cfg.warnLimit}/${cfg.warnLimit}*\n` +
            `🔨 Action: Removed from group!`,
          mentions,
        );

        await sleep(300);
        await kickUser(message, chatId, senderJid);
        return;
      }

      warns[warnKey] = nextWarn;
      saveGroupWarns(message, chatId, warns);

      await sendTextWithMentions(
        message,
        chatId,
        `⚠️ *BADWORD WARNING!*\n\n` +
          `👤 User: ${tag}\n` +
          `🚫 Word: \`${matchedWords.join(", ")}\`\n` +
          `📊 Warning Count: *${nextWarn}/${cfg.warnLimit}*`,
        mentions,
      );
    }
  } catch (err) {
    console.error("[antibadword] listener error:", err);
  }
});
