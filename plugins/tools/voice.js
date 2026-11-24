import fs from "fs";
import path from "path";
import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";

const OWNER_PHONES = new Set([
  "01719298647",
  "01300285514",
  "8801719298647",
  "8801300285514",
]);

const VOICE_MEDIA_DIR = path.resolve("database", "miku_voices_media");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function normalizePhoneDigits(raw) {
  return String(raw || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
}

function getSenderJid(message) {
  return (
    message?.sender ||
    message?.participant ||
    message?.key?.participant ||
    message?.from ||
    message?.key?.remoteJid ||
    ""
  );
}

function isBotOwner(message) {
  const senderDigits = normalizePhoneDigits(getSenderJid(message));
  const botDigits = normalizePhoneDigits(
    getSock(message)?.user?.id || message?.botnum || ""
  );

  if (senderDigits && OWNER_PHONES.has(senderDigits)) return true;
  if (
    Boolean(message?.key?.fromMe || message?.isFromMe || message?.isfromMe) &&
    botDigits &&
    OWNER_PHONES.has(botDigits)
  ) {
    return true;
  }

  return false;
}

// ইউজার-ভিত্তিক ইউনিক আইডি (শুধু যে সেভ করবে তার জন্যই থাকবে)
function getUserScopeId(message) {
  const senderDigits = normalizePhoneDigits(getSenderJid(message));
  const botDigits = normalizePhoneDigits(
    getSock(message)?.user?.id || message?.botnum || ""
  );
  const chatDigits = normalizePhoneDigits(
    message?.from || message?.key?.remoteJid || ""
  );

  return senderDigits || chatDigits || botDigits || "default_user";
}

// রিস্টার্টের পরও একই ডাটাবেস স্পেস পাওয়ার জন্য ফিক্সড/স্থায়ী নেমস্পেস
function getDbNamespace(message) {
  const botDigits = normalizePhoneDigits(
    getSock(message)?.user?.id || message?.botnum || ""
  );
  return botDigits || "miku_md_global_db";
}

function userEnabledKey(scopeId) {
  return `voice:user:${scopeId}:enabled`;
}

function userEntriesKey(scopeId) {
  return `voice:user:${scopeId}:entries_v2`;
}

const OWNER_SHARED_ENTRIES_KEY = "voice:owner_shared:entries_v2";

function isVoiceEnabled(message, scopeId) {
  return db.get(getDbNamespace(message), userEnabledKey(scopeId), false) === true;
}

function setVoiceEnabled(message, scopeId, enabled) {
  db.setHot(getDbNamespace(message), userEnabledKey(scopeId), Boolean(enabled));
}

function getUserEntries(message, scopeId) {
  const raw = db.get(getDbNamespace(message), userEntriesKey(scopeId), {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function setUserEntries(message, scopeId, obj) {
  db.setHot(getDbNamespace(message), userEntriesKey(scopeId), obj);
}

function getOwnerSharedEntries(message) {
  const raw = db.get(getDbNamespace(message), OWNER_SHARED_ENTRIES_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function setOwnerSharedEntries(message, obj) {
  db.setHot(getDbNamespace(message), OWNER_SHARED_ENTRIES_KEY, obj);
}

function getQuotedOrSelfMedia(message) {
  const q = message?.quoted;
  if (q && typeof q === "object") {
    const qRaw = q?.raw?.message || q?.content || q?.message || {};
    const qMime =
      q?.msg?.mimetype ||
      q?.mimetype ||
      qRaw?.audioMessage?.mimetype ||
      qRaw?.videoMessage?.mimetype ||
      "";
    if (
      qMime ||
      typeof q.download === "function" ||
      qRaw?.audioMessage ||
      qRaw?.videoMessage
    ) {
      return { target: q, mime: qMime, rawMsg: qRaw };
    }
  }

  const raw = message?.raw?.message || message?.content || message?.message || {};
  const mime =
    message?.msg?.mimetype ||
    message?.mimetype ||
    raw?.audioMessage?.mimetype ||
    raw?.videoMessage?.mimetype ||
    "";
  return { target: message, mime, rawMsg: raw };
}

async function downloadAudioBuffer(targetObj) {
  if (typeof targetObj?.download === "function") {
    const buf = await targetObj.download();
    if (Buffer.isBuffer(buf) && buf.length > 0) return buf;
  }

  if (typeof targetObj?.raw?.download === "function") {
    const buf = await targetObj.raw.download();
    if (Buffer.isBuffer(buf) && buf.length > 0) return buf;
  }

  return null;
}

function safeFileKey(str) {
  return String(str || "voice")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function removeFileIfExists(filePath) {
  if (!filePath) return;
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch (_) {}
}

function persistVoiceRecord({ prefixTag, scopeId, keyword, audioBuffer }) {
  ensureDir(VOICE_MEDIA_DIR);
  const fileName = `${prefixTag}_${scopeId}_${safeFileKey(keyword)}.mp3`;
  const filePath = path.join(VOICE_MEDIA_DIR, fileName);
  fs.writeFileSync(filePath, audioBuffer);

  return {
    filePath,
    base64: audioBuffer.toString("base64"),
    updatedAt: Date.now(),
  };
}

function readVoiceBuffer(entry) {
  if (!entry || typeof entry !== "object") return null;

  if (entry.filePath) {
    const resolved = path.resolve(entry.filePath);
    if (fs.existsSync(resolved)) {
      const buf = fs.readFileSync(resolved);
      if (Buffer.isBuffer(buf) && buf.length > 0) return buf;
    }
  }

  // ফাইল না পেলে ডাটাবেসে থাকা base64 থেকে রিকভার করে ফাইলে লিখে রাখা
  if (entry.base64 && typeof entry.base64 === "string") {
    try {
      const recovered = Buffer.from(entry.base64, "base64");
      if (recovered.length > 0) {
        if (entry.filePath) {
          ensureDir(path.dirname(path.resolve(entry.filePath)));
          fs.writeFileSync(path.resolve(entry.filePath), recovered);
        }
        return recovered;
      }
    } catch (_) {}
  }

  return null;
}

async function sendReply(message, payload) {
  const chatId = message?.from || message?.key?.remoteJid;
  const sock = getSock(message);
  const quoted = message?.gift || globalThis.gift || message?.raw || message;

  if (typeof payload === "string") {
    if (typeof message?.send === "function") {
      return message.send(payload, quoted ? { quoted } : {});
    }
    if (sock && typeof sock.sendMessage === "function" && chatId) {
      return sock.sendMessage(chatId, { text: payload }, quoted ? { quoted } : {});
    }
    return;
  }

  if (sock && typeof sock.sendMessage === "function" && chatId) {
    return sock.sendMessage(chatId, payload, quoted ? { quoted } : {});
  }
  if (typeof message?.send === "function") {
    return message.send(payload, quoted ? { quoted } : {});
  }
}

function extractMessageText(message) {
  const raw = message?.raw?.message || message?.content || message?.message || {};
  return String(
    message?.body ||
      message?.text ||
      raw?.conversation ||
      raw?.extendedTextMessage?.text ||
      ""
  ).trim();
}

Module({
  command: "voice",
  alias: ["f", "audiocmd", "autovoice"],
  package: "tools",
  description: "Restart-safe personal on/off voice commands and owner/creator voice save system",
})(async (message, match) => {
  try {
    const scopeId = getUserScopeId(message);
    const ownerUser = isBotOwner(message);
    const prefix = message?.prefix || ".";

    const parts = String(match || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const action = (parts[0] || "").toLowerCase();
    const keyword = (parts[1] || "").toLowerCase();

    if (action === "on") {
      setVoiceEnabled(message, scopeId, true);
      return sendReply(
        message,
        "✅ *Voice System ON* হয়ে গেছে!\n Voice sv dite parven"
      );
    }

    if (action === "off") {
      setVoiceEnabled(message, scopeId, false);
      return sendReply(message, "❌ *Voice System OFF* করা হয়েছে।");
    }

    if (action === "add") {
      if (!isVoiceEnabled(message, scopeId)) {
        return sendReply(
          message,
          `⚠️ আগে ভয়েস সিস্টেম চালু করুন:\n👉 \`${prefix}voice on\``
        );
      }

      if (!keyword) {
        return sendReply(
          message,
          `⚠️ একটি keyword দিন!\n👉 *Example:* \`${prefix}voice add vaiya\``
        );
      }

      const { target, mime, rawMsg } = getQuotedOrSelfMedia(message);
      const hasMedia =
        mime.includes("audio") ||
        mime.includes("video") ||
        Boolean(rawMsg?.audioMessage) ||
        Boolean(rawMsg?.videoMessage) ||
        Boolean(target?.msg?.audioMessage) ||
        Boolean(target?.msg?.videoMessage);

      if (!hasMedia) {
        return sendReply(
          message,
          `⚠️ কোনো audio বা voice file-এ reply করুন!\n👉 *Usage:* \`${prefix}voice add [keyword]\``
        );
      }

      const audioBuffer = await downloadAudioBuffer(target);
      if (!audioBuffer) {
        return sendReply(message, "❌ Audio/voice ফাইল ডাউনলোড করা যায়নি!");
      }

      const entries = getUserEntries(message, scopeId);
      if (entries[keyword]?.filePath) {
        removeFileIfExists(entries[keyword].filePath);
      }

      entries[keyword] = persistVoiceRecord({
        prefixTag: "u",
        scopeId,
        keyword,
        audioBuffer,
      });
      setUserEntries(message, scopeId, entries);

      return sendReply(
        message,
        `✅ *${keyword}* ভয়েসটি স্থায়ীভাবে শুধু আপনার প্রোফাইলে সেভ হয়েছে!`
      );
    }

    if (action === "save" || action === "saveglobal") {
      if (!ownerUser) {
        return sendReply(
          message,
          "🚫 শুধুমাত্র Bot Owner/Creator (`01719298647` / `01300285514`) ফাইল/ভয়েস সেভ করতে পারবেন!"
        );
      }

      if (!keyword) {
        return sendReply(
          message,
          `⚠️ একটি keyword দিন!\n👉 *Example:* \`${prefix}voice save salam\``
        );
      }

      const { target, mime, rawMsg } = getQuotedOrSelfMedia(message);
      const hasMedia =
        mime.includes("audio") ||
        mime.includes("video") ||
        Boolean(rawMsg?.audioMessage) ||
        Boolean(rawMsg?.videoMessage) ||
        Boolean(target?.msg?.audioMessage) ||
        Boolean(target?.msg?.videoMessage);

      if (!hasMedia) {
        return sendReply(
          message,
          `⚠️ কোনো audio বা voice file-এ reply করে \`${prefix}voice save [keyword]\` দিন!`
        );
      }

      const audioBuffer = await downloadAudioBuffer(target);
      if (!audioBuffer) {
        return sendReply(message, "❌ Audio/voice ফাইল ডাউনলোড করা যায়নি!");
      }

      const sharedEntries = getOwnerSharedEntries(message);
      if (sharedEntries[keyword]?.filePath) {
        removeFileIfExists(sharedEntries[keyword].filePath);
      }

      sharedEntries[keyword] = persistVoiceRecord({
        prefixTag: "owner",
        scopeId: "creator",
        keyword,
        audioBuffer,
      });
      setOwnerSharedEntries(message, sharedEntries);

      return sendReply(
        message,
        `👑 *Owner Saved!* "${keyword}" ভয়েস/ফাইলটি স্থায়ীভাবে সেভ করা হয়েছে।`
      );
    }

    if (action === "delete" || action === "del") {
      if (!keyword) {
        return sendReply(message, "⚠️ যে keyword-টি delete করবেন তা লিখুন!");
      }

      const userEntries = getUserEntries(message, scopeId);
      let removedAny = false;

      if (userEntries[keyword]) {
        removeFileIfExists(userEntries[keyword]?.filePath);
        delete userEntries[keyword];
        setUserEntries(message, scopeId, userEntries);
        removedAny = true;
      }

      if (ownerUser) {
        const sharedEntries = getOwnerSharedEntries(message);
        if (sharedEntries[keyword]) {
          removeFileIfExists(sharedEntries[keyword]?.filePath);
          delete sharedEntries[keyword];
          setOwnerSharedEntries(message, sharedEntries);
          removedAny = true;
        }
      }

      if (!removedAny) {
        return sendReply(message, `⚠️ "${keyword}" নামের কোনো voice পাওয়া যায়নি!`);
      }

      return sendReply(message, `🗑️ "${keyword}" voice-টি delete করা হয়েছে!`);
    }

    if (action === "list") {
      const enabled = isVoiceEnabled(message, scopeId);
      const userEntries = getUserEntries(message, scopeId);
      const userKeys = Object.keys(userEntries);

      let text = `🎙️ *YOUR VOICE LIST*\n• Status: *${enabled ? "ON ✅" : "OFF ❌"}*\n\n`;

      if (userKeys.length === 0) {
        text += "📂 এখনো কোনো ব্যক্তিগত voice সেভ করা হয়নি!\n";
      } else {
        userKeys.forEach((k, idx) => {
          text += `*${idx + 1}.* \`${k}\`\n`;
        });
      }

      if (ownerUser) {
        const sharedKeys = Object.keys(getOwnerSharedEntries(message));
        text += `\n👑 *Owner Saved:* ${
          sharedKeys.length ? sharedKeys.map((k) => `\`${k}\``).join(", ") : "None"
        }`;
      }

      return sendReply(message, text.trim());
    }

    const enabled = isVoiceEnabled(message, scopeId);
    return sendReply(
      message,
      `📌 *VOICE MENU* (Status: *${enabled ? "ON" : "OFF"}*)\n` +
        `👉 \`${prefix}voice on\` — চালু করুন\n` +
        `👉 \`${prefix}voice off\` — বন্ধ করুন\n` +
        `👉 \`${prefix}voice add [keyword]\` — শুধু নিজের জন্য ভয়েস অ্যাড করুন\n` +
        `👉 \`${prefix}voice delete [keyword]\` — ভয়েস ডিলিট করুন\n` +
        `👉 \`${prefix}voice list\` — সেভ করা ভয়েস লিস্ট` +
        (ownerUser ? `\n👑 \`${prefix}voice save [keyword]\` — Owner/Creator সেভ` : "")
    );
  } catch (err) {
    console.error("[voice] Command Error:", err);
    return sendReply(message, "❌ Voice কমান্ড চালাতে সমস্যা হয়েছে!");
  }
});

Module({
  on: "message",
  package: "tools",
  description: "Reply personal saved voice only when enabled for the user",
})(async (message) => {
  try {
    if (!message || message?.key?.fromMe || message?.isFromMe || message?.isfromMe) {
      return;
    }

    const scopeId = getUserScopeId(message);
    if (!isVoiceEnabled(message, scopeId)) return;

    const text = extractMessageText(message).toLowerCase();
    if (!text) return;

    const userEntries = getUserEntries(message, scopeId);
    const keys = Object.keys(userEntries);
    if (!keys.length) return;

    for (const key of keys) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKey}\\b`, "i");
      if (text === key || regex.test(text)) {
        const audioBuffer = readVoiceBuffer(userEntries[key]);
        if (audioBuffer) {
          await sendReply(message, {
            audio: audioBuffer,
            mimetype: "audio/mp4",
            ptt: false,
          });
          break;
        }
      }
    }
  } catch (err) {
    console.error("[voice] Event Error:", err);
  }
});
