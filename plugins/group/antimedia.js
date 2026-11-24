import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const FEATURE_CONFIG = {
  antimedia: {
    key: "all",
    label: "AntiMedia (All)",
  },
  antiimage: {
    key: "image",
    label: "AntiImage",
  },
  antivoice: {
    key: "voice",
    label: "AntiVoice",
  },
};

const settingKey = (groupJid, subType) => `antimedia:${subType}:${groupJid}`;

function isSubEnabled(message, subType) {
  return (
    db.get(message.botnum, settingKey(message.from, subType), false) === true
  );
}

function setSubEnabled(message, subType, value) {
  db.setHot(message.botnum, settingKey(message.from, subType), Boolean(value));
}

function getNormalizedType(message) {
  const rawType = String(message?.type || message?.mtype || "").toLowerCase();
  if (rawType) return rawType;

  const msg = message?.raw?.message || message?.content || message?.message || {};
  if (msg.imageMessage) return "imagemessage";
  if (msg.videoMessage) return "videomessage";
  if (msg.audioMessage) return "audiomessage";
  if (msg.documentMessage) return "documentmessage";
  if (msg.stickerMessage) return "stickermessage";
  return "";
}

function isMediaOrGif(message) {
  const type = getNormalizedType(message);
  const rawMsg = message?.raw?.message || message?.content || message?.message || {};
  const isGif =
    type === "videomessage" && Boolean(rawMsg?.videoMessage?.gifPlayback);

  return (
    isGif ||
    [
      "imagemessage",
      "videomessage",
      "audiomessage",
      "documentmessage",
      "stickermessage",
      "contactmessage",
      "locationmessage",
      "livelocationmessage",
      "pollcreationmessage",
      "productmessage",
      "viewoncemessage",
      "viewoncemessagev2",
      "viewoncemessagev2extension",
    ].includes(type)
  );
}

function isImageOrVideo(message) {
  const type = getNormalizedType(message);
  return type === "imagemessage" || type === "videomessage";
}

function isAudioOrVoice(message) {
  return getNormalizedType(message) === "audiomessage";
}

async function deleteMediaMessage(message) {
  const chatId = message?.from || message?.key?.remoteJid;
  const sender = message?.sender || message?.participant || message?.key?.participant;
  const sock = message?.client || message?.conn || message?.sock || null;

  if (message?.key && typeof message.send === "function") {
    try {
      await message.send({ delete: message.key });
      return true;
    } catch (_) {}
  }

  if (message?.key?.id && sock && typeof sock.sendMessage === "function" && chatId) {
    try {
      await sock.sendMessage(chatId, {
        delete: {
          remoteJid: chatId,
          fromMe: false,
          id: message.key.id,
          ...(sender ? { participant: sender } : {}),
        },
      });
      return true;
    } catch (err) {
      console.error("[antimedia] Delete error:", err?.message || err);
    }
  }

  return false;
}

async function handleMediaCommand(message, match, cmdName) {
  if (!message.isGroup) {
    return message.send(theme.isGroup);
  }

  await message.loadGroupInfo?.();

  if (!message.isAdmin && !message.isFromMe && !message.isfromMe) {
    return message.send(theme.isAdmin);
  }

  if (!message.isBotAdmin) {
    return message.send(theme.isBotAdmin);
  }

  const cfg = FEATURE_CONFIG[cmdName];
  const sub = String(match || "").trim().split(/\s+/)[0]?.toLowerCase();
  const prefix = message.prefix || ".";

  if (sub === "on") {
    setSubEnabled(message, cfg.key, true);
    return message.send(`✅ ${cfg.label} চালু করা হয়েছে!`);
  }

  if (sub === "off") {
    setSubEnabled(message, cfg.key, false);
    return message.send(`❌ ${cfg.label} বন্ধ করা হয়েছে!`);
  }

  return message.send(
    `📌 *AntiMedia ব্যবহারের নিয়ম:*\n\n` +
      `👉 All Media: *${prefix}antimedia on / off*\n` +
      `👉 Image/Video: *${prefix}antiimage on / off*\n` +
      `👉 Voice/Audio: *${prefix}antivoice on / off*`
  );
}

for (const cmdName of Object.keys(FEATURE_CONFIG)) {
  Module({
    command: cmdName,
    package: "group",
    description: "Auto delete media files in group.",
  })(async (message, match) => {
    return handleMediaCommand(message, match, cmdName);
  });
}

Module({
  on: "message",
  package: "group",
  description: "Auto delete configured media in groups",
})(async (message) => {
  try {
    if (
      !message?.isGroup ||
      message?.key?.fromMe ||
      message?.isFromMe ||
      message?.isfromMe
    ) {
      return;
    }

    await message.loadGroupInfo?.();
    if (message.isAdmin) return;
    if (!message.isBotAdmin) return;

    const allEnabled = isSubEnabled(message, "all");
    const imageEnabled = isSubEnabled(message, "image");
    const voiceEnabled = isSubEnabled(message, "voice");

    if (!allEnabled && !imageEnabled && !voiceEnabled) return;

    const shouldDelete =
      (allEnabled && isMediaOrGif(message)) ||
      (imageEnabled && isImageOrVideo(message)) ||
      (voiceEnabled && isAudioOrVoice(message));

    if (shouldDelete) {
      await deleteMediaMessage(message);
    }
  } catch (e) {
    console.error("AntiMedia Delete Error:", e);
  }
});
