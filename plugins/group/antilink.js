import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const VALID_MODES = ["delete", "warn", "kick"];

const modeKey = (groupJid) => `antilink:mode:${groupJid}`;
const warnKey = (groupJid, userJid) => `antilink:warn:${groupJid}:${userJid}`;

function getMode(message, groupJid) {
  const saved = String(
    db.get(message?.botnum, modeKey(groupJid), "off") || "off"
  ).toLowerCase();
  return VALID_MODES.includes(saved) ? saved : "off";
}

function setMode(message, groupJid, mode) {
  db.setHot(message?.botnum, modeKey(groupJid), mode);
}

function getWarns(message, groupJid, userJid) {
  return Number(db.get(message?.botnum, warnKey(groupJid, userJid), 0) || 0);
}

function setWarns(message, groupJid, userJid, count) {
  db.setHot(message?.botnum, warnKey(groupJid, userJid), Number(count));
}

function getSocket(message) {
  return message?.client || message?.conn || message?.sock || null;
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";

  const rawMsg =
    message?.raw?.message || message?.content || message?.message || {};

  const parts = [
    message?.body,
    message?.text,
    rawMsg?.conversation,
    rawMsg?.extendedTextMessage?.text,
    rawMsg?.extendedTextMessage?.matchedText,
    rawMsg?.imageMessage?.caption,
    rawMsg?.videoMessage?.caption,
    rawMsg?.documentMessage?.caption,
  ];

  const combined = parts.filter(Boolean).join(" ");
  // মেমোরি বা CPU সেফ রাখার জন্য সর্বোচ্চ 25,000 ক্যারেক্টার পর্যন্ত স্ক্যান
  return combined.length > 25000 ? combined.slice(0, 25000) : combined;
}

// ৩০-৫০+ লিঙ্ক একসাথে থাকলেও ইনস্ট্যান্ট ও সেফ ডিটেক্টর (ReDoS-free)
function hasAnyLinkFast(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();

  if (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("www.") ||
    lower.includes("chat.whatsapp.com/") ||
    lower.includes("whatsapp.com/channel/") ||
    lower.includes("t.me/") ||
    lower.includes("telegram.me/") ||
    lower.includes("discord.gg/") ||
    lower.includes("vm.tiktok.com/") ||
    lower.includes("vt.tiktok.com/") ||
    lower.includes("youtu.be/") ||
    lower.includes("youtube.com/watch") ||
    lower.includes("youtube.com/shorts/") ||
    lower.includes("instagram.com/") ||
    lower.includes("fb.watch/") ||
    lower.includes("facebook.com/share/")
  ) {
    return true;
  }

  // সাধারণ ডোমেইন চেক (যেমন example.com, site.xyz)
  const tokens = lower.split(/[\s\r\n,()[\]<>|"'`]+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 4 || !tok.includes(".")) continue;
    if (
      /^(?:[a-z0-9-]+\.)+[a-z]{2,12}(?:\/[^\s]*)?$/.test(tok)
    ) {
      return true;
    }
  }

  return false;
}

async function deleteMessageFast(message, senderJid) {
  const chatId = message?.from || message?.key?.remoteJid;
  const origKey = message?.key || message?.raw?.key;
  const sock = getSocket(message);

  if (origKey && typeof message?.send === "function") {
    try {
      await message.send({ delete: origKey });
      return true;
    } catch (_) {}
  }

  if (origKey?.id && sock && typeof sock.sendMessage === "function" && chatId) {
    try {
      await sock.sendMessage(chatId, {
        delete: {
          remoteJid: chatId,
          fromMe: Boolean(origKey.fromMe),
          id: origKey.id,
          ...(origKey.participant || senderJid
            ? { participant: origKey.participant || senderJid }
            : {}),
        },
      });
      return true;
    } catch (err) {
      console.error("[antilink] Delete failed:", err?.message || err);
    }
  }

  return false;
}

async function kickUserFast(message, groupJid, userJid) {
  if (!groupJid || !userJid) return false;
  const sock = getSocket(message);

  try {
    if (typeof message?.groupParticipantsUpdate === "function") {
      await message.groupParticipantsUpdate(groupJid, [userJid], "remove");
      return true;
    }
    if (sock && typeof sock.groupParticipantsUpdate === "function") {
      await sock.groupParticipantsUpdate(groupJid, [userJid], "remove");
      return true;
    }
  } catch (err) {
    console.error("[antilink] Kick failed:", err?.message || err);
  }

  return false;
}

async function sendAlert(message, text, mentions = []) {
  const chatId = message?.from || message?.key?.remoteJid;
  const sock = getSocket(message);

  if (sock && typeof sock.sendMessage === "function" && chatId) {
    return sock.sendMessage(chatId, {
      text,
      ...(mentions.length ? { mentions } : {}),
    });
  }

  if (typeof message?.send === "function") {
    return message.send(text, mentions.length ? { mentions } : {});
  }
}

Module({
  command: "antilink",
  alias: ["alink", "nolink"],
  package: "group",
  description: "Toggle AntiLink with 3 modes: delete, warn, kick",
})(async (message, match) => {
  const groupJid = message?.from || message?.key?.remoteJid;
  if (!message?.isGroup || !groupJid) {
    return sendAlert(
      message,
      theme?.isGroup || "🚫 এই কমান্ডটি শুধুমাত্র গ্রুপে কাজ করবে!"
    );
  }

  await message.loadGroupInfo?.().catch(() => {});

  if (
    message?.isAdmin === false &&
    !message?.isFromMe &&
    !message?.isfromMe &&
    !message?.key?.fromMe
  ) {
    return sendAlert(
      message,
      theme?.isAdmin || "⚠️ এই কমান্ডটি শুধুমাত্র গ্রুপ অ্যাডমিনদের জন্য!"
    );
  }

  const prefix = message.prefix || ".";
  const arg = String(match || "").trim().toLowerCase();
  const current = getMode(message, groupJid);

  let targetMode = null;

  if (arg === "off" || arg === "disable" || arg === "0") {
    targetMode = "off";
  } else if (VALID_MODES.includes(arg)) {
    targetMode = arg;
  } else if (!arg || arg === "toggle" || arg === "on" || arg === "enable") {
    // Toggle cycle: off -> delete -> warn -> kick -> off
    if (current === "off") targetMode = "delete";
    else if (current === "delete") targetMode = "warn";
    else if (current === "warn") targetMode = "kick";
    else targetMode = "off";
  }

  if (!targetMode) {
    return sendAlert(
      message,
      `📌 *AntiLink Toggle & 3 Modes:*\n\n` +
        `• Current Mode: *${current.toUpperCase()}*\n` +
        `• Toggle (Cycle): *${prefix}antilink* বা *${prefix}antilink toggle*\n` +
        `• Mode 1: *${prefix}antilink delete*\n` +
        `• Mode 2: *${prefix}antilink warn*\n` +
        `• Mode 3: *${prefix}antilink kick*\n` +
        `• Disable: *${prefix}antilink off*`
    );
  }

  setMode(message, groupJid, targetMode);

  const modeInfo = {
    delete:
      "🗑️ *AntiLink Mode: DELETE*\n 𝗟ɪɴᴋ ɪɴꜱᴛᴀɴᴛ ᴅᴇʟᴇᴛᴇ।",
    warn:
      "⚠️ *AntiLink Mode: WARN*\nলিঙ্ক দিলে মেসেজ ডিলিট হবে এবং ৩ ওয়ার্নিং পূর্ণ হলে কিক করা হবে।",
    kick:
      "🚫 *AntiLink Mode: KICK*\nলিঙ্ক দিলে মেসেজ ডিলিট হবে এবং সাথে সাথে গ্রুপ থেকে কিক করা হবে।",
    off:
      "❌ *AntiLink OFF*\nগ্রুপে লিঙ্ক ডিলিট সিস্টেম বন্ধ করা হয়েছে।",
  };

  return sendAlert(message, modeInfo[targetMode]);
});

Module({
  on: "message",
  package: "group",
  description: "Instantly detect and delete single or bulk links in groups",
})(async (message) => {
  try {
    const groupJid = message?.from || message?.key?.remoteJid;
    if (!message?.isGroup || !groupJid) return;

    if (
      message?.key?.fromMe ||
      message?.isFromMe ||
      message?.isfromMe
    ) {
      return;
    }

    const mode = getMode(message, groupJid);
    if (mode === "off") return;

    const text = extractMessageText(message);
    if (!text) return;

    if (!hasAnyLinkFast(text)) return;

    await message.loadGroupInfo?.().catch(() => {});
    if (message?.isAdmin) return;

    const senderJid =
      message?.sender ||
      message?.participant ||
      message?.key?.participant;
    const senderNum = senderJid ? String(senderJid).split("@")[0].split(":")[0] : "";

    // সবার আগে ইনস্ট্যান্ট ডিলিট কল
    await deleteMessageFast(message, senderJid);

    if (mode === "delete") {
      return;
    }

    if (mode === "kick") {
      if (senderJid) {
        await sendAlert(
          message,
          `🚫 @${senderNum}, গ্রুপে লিঙ্ক শেয়ার করার কারণে কিক করা হয়েছে!`,
          [senderJid]
        ).catch(() => {});
        await kickUserFast(message, groupJid, senderJid);
      }
      return;
    }

    if (mode === "warn") {
      if (!senderJid) return;
      const nextWarn = getWarns(message, groupJid, senderJid) + 1;
      const maxWarn = 3;

      if (nextWarn >= maxWarn) {
        setWarns(message, groupJid, senderJid, 0);
        await sendAlert(
          message,
          `🚫 @${senderNum}, ${maxWarn}/${maxWarn} ওয়ার্নিং পূর্ণ হওয়ায় গ্রুপ থেকে কিক করা হয়েছে!`,
          [senderJid]
        ).catch(() => {});
        await kickUserFast(message, groupJid, senderJid);
      } else {
        setWarns(message, groupJid, senderJid, nextWarn);
        await sendAlert(
          message,
          `⚠️ @${senderNum}, গ্রুপে লিঙ্ক দেওয়া নিষেধ! (Warn: *${nextWarn}/${maxWarn}*)`,
          [senderJid]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[antilink] Event error:", err);
  }
});
