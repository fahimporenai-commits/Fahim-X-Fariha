import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();
const MODES = new Set(["delete", "kick", "warn"]);
const DEFAULT_WARN_LIMIT = 3;

const key = (groupJid, name) => `antisticker:${groupJid}:${name}`;
const userWarnKey = (groupJid, senderJid) =>
  `antisticker:${groupJid}:warns:${senderJid}`;

const isSticker = (message) =>
  message?.type === "stickerMessage" ||
  Boolean(message?.content?.stickerMessage) ||
  Boolean(message?.raw?.message?.stickerMessage);

function getWarnLimit(message) {
  const saved = Number(
    db.get(message.botnum, key(message.from, "warnLimit"), DEFAULT_WARN_LIMIT)
  );
  return Number.isFinite(saved) && saved >= 1 ? Math.min(Math.floor(saved), 20) : DEFAULT_WARN_LIMIT;
}

function setWarnLimit(message, limit) {
  const clean = Math.min(Math.max(Math.floor(Number(limit) || DEFAULT_WARN_LIMIT), 1), 20);
  db.setHot(message.botnum, key(message.from, "warnLimit"), clean);
  return clean;
}

function getUserWarns(message, senderJid) {
  if (!senderJid) return 0;
  const count = Number(db.get(message.botnum, userWarnKey(message.from, senderJid), 0));
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function setUserWarns(message, senderJid, count) {
  if (!senderJid) return;
  const clean = Math.max(Math.floor(Number(count) || 0), 0);
  db.setHot(message.botnum, userWarnKey(message.from, senderJid), clean);
}

async function deleteSticker(message) {
  if (!message?.key || typeof message.send !== "function") {
    return false;
  }

  try {
    await message.send({ delete: message.key });
    return true;
  } catch (error) {
    console.error("[antisticker] delete failed:", error?.message || error);
    return false;
  }
}

async function removeUser(message, senderJid) {
  if (!senderJid) return false;

  try {
    if (typeof message.removeParticipant === "function") {
      await message.removeParticipant([senderJid]);
      return true;
    }

    if (message.conn?.groupParticipantsUpdate) {
      await message.conn.groupParticipantsUpdate(
        message.from,
        [senderJid],
        "remove"
      );
      return true;
    }
  } catch (error) {
    console.error("[antisticker] kick failed:", error?.message || error);
  }

  return false;
}

function statusText(message) {
  const enabled =
    db.get(message.botnum, key(message.from, "enabled"), false) === true;

  const mode = String(
    db.get(message.botnum, key(message.from, "mode"), "delete") || "delete"
  );

  const warnLimit = getWarnLimit(message);
  const p = message.prefix || ".";

  return [
    "⚙️ AntiSticker",
    `• Status: ${enabled ? "✅ ON" : "❌ OFF"}`,
    `• Mode: ${mode.toUpperCase()}`,
    `• Warn Limit: ${warnLimit}`,
    "",
    `Usage:`,
    `${p}antisticker on|off|delete|kick`,
    `${p}antisticker warn <limit> (e.g. ${p}antisticker warn 2 or 3)`,
  ].join("\n");
}

Module({
  command: "antisticker",
  aliases: ["asticker"],
  package: "group",
  description: "Sticker control: delete, kick, or warn with auto-kick limit",
})(async (message, match) => {
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

  const parts = String(match || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const arg = parts[0] || "";
  const extraNum = parts[1] ? Number(parts[1]) : NaN;

  const enabledKey = key(message.from, "enabled");
  const modeKey = key(message.from, "mode");
  const p = message.prefix || ".";

  if (!arg) {
    return message.send(statusText(message));
  }

  if (arg === "on") {
    db.setHot(message.botnum, enabledKey, true);

    const currentMode = String(
      db.get(message.botnum, modeKey, "delete") || "delete"
    );

    if (!MODES.has(currentMode)) {
      db.setHot(message.botnum, modeKey, "delete");
    }

    return message.send(
      `✅ AntiSticker ON\nMode: ${currentMode.toUpperCase()}\nWarn Limit: ${getWarnLimit(message)}`
    );
  }

  if (arg === "off") {
    db.setHot(message.botnum, enabledKey, false);
    return message.send("✅ AntiSticker OFF");
  }

  if (arg === "warn") {
    const limit =
      Number.isFinite(extraNum) && extraNum >= 1
        ? setWarnLimit(message, extraNum)
        : getWarnLimit(message);

    db.setHot(message.botnum, modeKey, "warn");
    db.setHot(message.botnum, key(message.from, "warnLimit"), limit);
    db.setHot(message.botnum, enabledKey, true);

    return message.send(
      `✅ AntiSticker mode: WARN\n⚠️ Auto-kick after: *${limit}* warnings\nFeature automatically enabled.`
    );
  }

  if (MODES.has(arg)) {
    db.setHot(message.botnum, modeKey, arg);
    db.setHot(message.botnum, enabledKey, true);

    return message.send(
      `✅ AntiSticker mode: ${arg.toUpperCase()}\n` +
        "Feature automatically enabled."
    );
  }

  return message.send(
    `Usage:\n` +
      `${p}antisticker on\n` +
      `${p}antisticker off\n` +
      `${p}antisticker delete\n` +
      `${p}antisticker kick\n` +
      `${p}antisticker warn <2|3>`
  );
});

Module({
  on: "message",
  package: "group",
  description: "Instant sticker delete, warn counter with auto-kick, and kick system",
})(async (message) => {
  if (!message?.isGroup || !isSticker(message)) {
    return;
  }

  const enabled =
    db.get(message.botnum, key(message.from, "enabled"), false) === true;

  if (!enabled) return;

  await message.loadGroupInfo?.();

  if (!message.isBotAdmin) return;

  if (message.isAdmin || message.isFromMe || message.isfromMe) {
    return;
  }

  const mode = String(
    db.get(message.botnum, key(message.from, "mode"), "delete") || "delete"
  ).toLowerCase();

  const sender = message.sender;
  const mention = sender ? `@${String(sender).split("@")[0]}` : "user";
  const mentions = sender ? [sender] : [];

  // সব mode-এই sticker instant delete হবে
  await deleteSticker(message);

  if (mode === "delete") {
    return;
  }

  if (mode === "warn") {
    const limit = getWarnLimit(message);
    const nextWarn = getUserWarns(message, sender) + 1;

    if (nextWarn >= limit) {
      setUserWarns(message, sender, 0);
      const removed = await removeUser(message, sender);

      await message.send(
        removed
          ? `🚫 ${mention} reached *${limit}/${limit}* sticker warnings and was removed from the group.`
          : `⚠️ ${mention} reached *${limit}/${limit}* sticker warnings, but I could not remove the user.`,
        { mentions }
      );
      return;
    }

    setUserWarns(message, sender, nextWarn);
    await message.send(
      `⚠️ ${mention}, stickers are not allowed! Warning: *${nextWarn}/${limit}*`,
      { mentions }
    );
    return;
  }

  if (mode === "kick") {
    const removed = await removeUser(message, sender);

    await message.send(
      removed
        ? `🚫 ${mention} posted a sticker and was removed from the group.`
        : `⚠️ ${mention}, sticker deleted. I could not remove the user.`,
      { mentions }
    );
  }
});
