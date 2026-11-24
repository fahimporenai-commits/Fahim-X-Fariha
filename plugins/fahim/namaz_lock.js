import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const activeIntervals = {};
const groupStates = {};

// 🕌 updated namaz schedule (Fajr excluded, Jummah added)
const SCHEDULE = [
  { name: "Juhor", start: "13:10", end: "13:45" },
  { name: "Asor", start: "15:45", end: "16:15" },
  { name: "Magrib", start: "17:15", end: "17:35" },
  { name: "Esha", start: "19:00", end: "19:45" },
  { name: "Jummah", start: "13:10", end: "14:15" }, // শুক্রবার জুম্মার সময়
];

const namazKey = (groupJid) => `namazauto:enabled:${groupJid}`;

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getDbNamespace(message) {
  return message?.botnum || getSock(message)?.user?.id || "miku_bot";
}

function isNamazEnabled(message, groupJid) {
  return db.get(getDbNamespace(message), namazKey(groupJid), false) === true;
}

function setNamazEnabled(message, groupJid, enabled) {
  db.setHot(getDbNamespace(message), namazKey(groupJid), Boolean(enabled));
}

async function sendText(message, chatId, text) {
  const sock = getSock(message);
  const quoted = message?.gift || globalThis.gift || message?.raw || message;

  if (sock && typeof sock.sendMessage === "function" && chatId) {
    return sock.sendMessage(chatId, { text }, quoted ? { quoted } : {});
  }
  if (typeof message?.send === "function") {
    return message.send(text, quoted ? { quoted } : {});
  }
}

async function updateGroupSetting(message, chatId, setting) {
  const sock = getSock(message);

  if (sock && typeof sock.groupSettingUpdate === "function") {
    await sock.groupSettingUpdate(chatId, setting);
    return true;
  }
  if (typeof message?.groupSettingUpdate === "function") {
    await message.groupSettingUpdate(chatId, setting);
    return true;
  }
  return false;
}

function startNamazWatcher(message, chatId) {
  if (!chatId || activeIntervals[chatId]) return;

  activeIntervals[chatId] = setInterval(async () => {
    try {
      if (!isNamazEnabled(message, chatId)) {
        clearInterval(activeIntervals[chatId]);
        delete activeIntervals[chatId];
        return;
      }

      const sock = getSock(message);
      if (!sock) return;

      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })
      );
      const current = now.getHours() * 60 + now.getMinutes();
      const day = now.getDay(); // 5 = Friday

      let shouldLock = false;
      let activeWaqt = "";

      for (const p of SCHEDULE) {
        if (p.name === "Jummah" && day !== 5) continue;
        if (p.name === "Juhor" && day === 5) continue;

        const [sh, sm] = p.start.split(":").map(Number);
        const [eh, em] = p.end.split(":").map(Number);

        if (current >= sh * 60 + sm && current < eh * 60 + em) {
          shouldLock = true;
          activeWaqt = p.name;
          break;
        }
      }

      // 🔒 LOCK LOGIC
      if (shouldLock && groupStates[chatId] !== "locked") {
        try {
          await updateGroupSetting(message, chatId, "announcement");
          groupStates[chatId] = "locked";
          const offMsg =
            `𝐀𝐬𝐬𝐚𝐥𝐚𝐦𝐮𝐚𝐥𝐚𝐢𝐤𝐮𝐦 𝐄𝐯𝐞𝐫𝐲𝐨𝐧𝐞 😌🤍\n\n` +
            `— *𝐆𝐫𝐨𝐮𝐩 𝐎𝐟𝐟!* 🚫 (🕌 ${activeWaqt} Namaz Time)\n` +
            `— 𝐎𝐩𝐞𝐧 𝐓𝐢𝐦𝐞: 𝐍𝐚𝐦𝐚𝐣𝐞𝐫 𝐏𝐨𝐫 🕋☉\n\n` +
            `— 𝐀𝐥𝐥𝐚𝐡 𝐇𝐚𝐟𝐞𝐳 :) 🫧🧷\n` +
            `    — *𝐅ꫝнιм 𝐁𝐨𝐭*🩶`;
          await sock.sendMessage(chatId, { text: offMsg });
        } catch (_) {}
      }
      // 🔓 UNLOCK LOGIC
      else if (!shouldLock && groupStates[chatId] === "locked") {
        try {
          await updateGroupSetting(message, chatId, "not_announcement");
          groupStates[chatId] = "unlocked";
          const onMsg =
            `– 𝐀𝐬𝐬𝐚𝐥𝐚𝐦𝐮𝐚𝐥𝐚𝐢𝐤𝐮𝐦 𝐄𝐯𝐞𝐫𝐲𝐨𝐧𝐞 😌🌷\n\n` +
            `– 𝐍𝐚𝐦𝐚𝐳 𝐓𝐢𝐦𝐞 𝐎𝐯𝐞𝐫. 𝐆𝐫𝐨𝐮𝐩 𝐎𝐩𝐞𝐧 🌸🍒\n\n` +
            `– 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐅αнιм вσт⚡`;
          await sock.sendMessage(chatId, { text: onMsg });
        } catch (_) {}
      }
    } catch (_) {}
  }, 20000);
}

Module({
  command: "namaz",
  alias: ["namaz", "namaztime"],
  package: "group",
  description: "Auto lock/unlock group during Dhaka Namaz times",
})(async (message, match) => {
  const chatId = message?.from || message?.key?.remoteJid;
  if (!message?.isGroup || !chatId) {
    return sendText(
      message,
      chatId,
      theme?.isGroup || "🚫 Ei command-ti shudhu group-e byabohar kora jabe!"
    );
  }

  await message.loadGroupInfo?.().catch(() => {});

  const isAuthorized =
    message?.isAdmin ||
    message?.isFromMe ||
    message?.isfromMe ||
    message?.key?.fromMe;

  if (!isAuthorized) {
    return sendText(
      message,
      chatId,
      theme?.isAdmin || "🚫 Shudhu group admin-ra byabohar korte parben!"
    );
  }

  const action = String(match || "").trim().split(/\s+/)[0]?.toLowerCase();
  const prefix = message?.prefix || ".";

  if (action === "on") {
    if (isNamazEnabled(message, chatId)) {
      startNamazWatcher(message, chatId);
      return sendText(
        message,
        chatId,
        "⚠️ Namaz Auto System age thekei chalu ache!"
      );
    }

    setNamazEnabled(message, chatId, true);
    startNamazWatcher(message, chatId);

    return sendText(
      message,
      chatId,
      "🟢 *𝘕ᴀᴍᴀᴢ 𝘈ᴜᴛᴏ 𝘚ʏꜱᴛᴇᴍ 𝐀ᴄᴛɪᴠᴀᴛᴇᴅ.. (🤍)*\n\n🕌 * _নামায টাইমে গুরুপ on-of_/hobe."
    );
  }

  if (action === "off") {
    if (!isNamazEnabled(message, chatId)) {
      return sendText(message, chatId, "⚠️ System-ti bondh-i ache!");
    }

    setNamazEnabled(message, chatId, false);
    if (activeIntervals[chatId]) {
      clearInterval(activeIntervals[chatId]);
      delete activeIntervals[chatId];
    }
    delete groupStates[chatId];

    try {
      await updateGroupSetting(message, chatId, "not_announcement");
    } catch (_) {}

    return sendText(
      message,
      chatId,
      "🔴 Namaz Auto System bondho kora hoyeche ebong group khule dewa hoyeche."
    );
  }

  return sendText(
    message,
    chatId,
    `📌 *Usage:*\n👉 ${prefix}namaz on\n👉 ${prefix}namaz off`
  );
});

Module({
  on: "message",
  package: "group",
  description: "Background watcher for Dhaka Namaz auto lock/unlock",
})(async (message) => {
  const chatId = message?.from || message?.key?.remoteJid;
  if (!message?.isGroup || !chatId) return;

  if (isNamazEnabled(message, chatId) && !activeIntervals[chatId]) {
    startNamazWatcher(message, chatId);
  }
});
