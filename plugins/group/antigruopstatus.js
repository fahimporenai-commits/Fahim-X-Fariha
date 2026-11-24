import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const VALID_MODES = ["kick", "delete", "warn"];

const modeKey = (groupJid) =>
  `antigroupstatus:mode:${groupJid}`;

const lockKey = (groupJid) =>
  `antigroupstatus:lock:${groupJid}`;

function getMode(message) {
  const saved = String(
    db.get(
      message.botnum,
      modeKey(message.from),
      "off",
    ) || "off",
  ).toLowerCase();

  return VALID_MODES.includes(saved)
    ? saved
    : "off";
}

function setMode(message, mode) {
  db.setHot(
    message.botnum,
    modeKey(message.from),
    mode,
  );
}

function setLockUntil(message, timestamp) {
  db.setHot(
    message.botnum,
    lockKey(message.from),
    timestamp,
  );
}

function unwrapMessageContent(msg) {
  let current = msg;
  const seen = new Set();

  while (
    current &&
    typeof current === "object" &&
    !seen.has(current)
  ) {
    seen.add(current);

    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }

    if (
      current.viewOnceMessageV2Extension?.message
    ) {
      current =
        current.viewOnceMessageV2Extension.message;
      continue;
    }

    if (
      current.documentWithCaptionMessage?.message
    ) {
      current =
        current.documentWithCaptionMessage.message;
      continue;
    }

    if (current.editedMessage?.message) {
      current = current.editedMessage.message;
      continue;
    }

    if (current.associatedChildMessage?.message) {
      current =
        current.associatedChildMessage.message;
      continue;
    }

    break;
  }

  return current || {};
}

function isGroupStatusMessage(message) {
  if (!message) return false;

  const rawMsg =
    message?.raw?.message ||
    message?.content ||
    message?.message ||
    {};

  const msg = unwrapMessageContent(rawMsg);

  const ctxList = [
    msg.extendedTextMessage?.contextInfo,
    msg.imageMessage?.contextInfo,
    msg.videoMessage?.contextInfo,
    msg.audioMessage?.contextInfo,
    msg.documentMessage?.contextInfo,
    msg.stickerMessage?.contextInfo,

    rawMsg.extendedTextMessage?.contextInfo,
    rawMsg.imageMessage?.contextInfo,
    rawMsg.videoMessage?.contextInfo,
    rawMsg.audioMessage?.contextInfo,
    rawMsg.documentMessage?.contextInfo,
    rawMsg.stickerMessage?.contextInfo,
  ];

  for (const ctx of ctxList) {
    if (ctx && ctx.isGroupStatus === true) {
      return true;
    }
  }

  if (
    msg.groupStatusMessageV2 ||
    rawMsg.groupStatusMessageV2
  ) {
    return true;
  }

  if (
    msg.groupStatusMessage ||
    rawMsg.groupStatusMessage
  ) {
    return true;
  }

  const type = String(
    message.type || "",
  ).toLowerCase();

  if (type.includes("groupstatus")) {
    return true;
  }

  return false;
}

function getSocket(message) {
  return (
    message?.client ||
    message?.conn ||
    message?.sock ||
    null
  );
}

function getGroupStatusJid(message) {
  const raw = message?.raw?.message || {};
  const content = message?.content || {};

  const containers = [
    content.groupStatusMessage,
    content.groupStatusMessageV2,
    raw.groupStatusMessage,
    raw.groupStatusMessageV2,
  ].filter(Boolean);

  for (const item of containers) {
    const value =
      item.groupJid ||
      item.groupId ||
      item.remoteJid ||
      item.chatId ||
      item.jid;

    if (
      typeof value === "string" &&
      value.endsWith("@g.us")
    ) {
      return value;
    }
  }

  if (
    typeof message?.from === "string" &&
    message.from.endsWith("@g.us")
  ) {
    return message.from;
  }

  return null;
}

function buildDeleteKeys(message, senderJid) {
  const originalKey =
    message?.key ||
    message?.raw?.key;

  if (!originalKey?.id) {
    return [];
  }

  const groupJid = getGroupStatusJid(message);

  const participant =
    originalKey.participant ||
    senderJid ||
    message?.sender ||
    message?.raw?.key?.participant;

  const remoteJids = [
    groupJid,
    message?.from,
    originalKey.remoteJid,
  ].filter(
    (jid, index, list) =>
      typeof jid === "string" &&
      jid.length > 0 &&
      list.indexOf(jid) === index,
  );

  const keys = [];

  for (const remoteJid of remoteJids) {
    keys.push({
      ...originalKey,
      remoteJid,
      fromMe: Boolean(originalKey.fromMe),
      ...(participant
        ? { participant }
        : {}),
    });
  }

  // Some Baileys versions accept the original key only.
  keys.push(originalKey);

  const unique = [];
  const seen = new Set();

  for (const key of keys) {
    const id =
      `${key.remoteJid}|` +
      `${key.fromMe}|` +
      `${key.id}|` +
      `${key.participant || ""}`;

    if (
      key.id &&
      !seen.has(id)
    ) {
      seen.add(id);
      unique.push(key);
    }
  }

  return unique;
}

async function deleteMessageFast(
  message,
  senderJid,
) {
  const socket = getSocket(message);
  const keys = buildDeleteKeys(
    message,
    senderJid,
  );

  if (!keys.length) {
    console.error(
      "[antigroupstatus] delete failed: message key missing",
    );

    return false;
  }

  for (const key of keys) {
    const chatId =
      key.remoteJid ||
      message?.from;

    // Direct socket delete.
    // message.send() may hide the actual error.
    if (
      socket &&
      typeof socket.sendMessage === "function" &&
      chatId
    ) {
      try {
        await socket.sendMessage(
          chatId,
          {
            delete: key,
          },
        );

        console.log(
          "[antigroupstatus] deleted status message:",
          key.id,
          chatId,
        );

        return true;
      } catch (error) {
        console.error(
          "[antigroupstatus] socket delete failed:",
          error?.message || error,
        );
      }
    }

    // Fallback delete method.
    if (
      typeof message?.send === "function"
    ) {
      try {
        const result = await message.send({
          delete: key,
        });

        if (
          result !== null &&
          result !== false
        ) {
          return true;
        }
      } catch (error) {
        console.error(
          "[antigroupstatus] wrapper delete failed:",
          error?.message || error,
        );
      }
    }
  }

  return false;
}

async function kickUser(
  message,
  userJid,
) {
  if (!userJid) {
    return false;
  }

  const socket = getSocket(message);

  try {
    if (
      typeof message.groupParticipantsUpdate ===
      "function"
    ) {
      await message.groupParticipantsUpdate(
        message.from,
        [userJid],
        "remove",
      );

      return true;
    }

    if (
      socket &&
      typeof socket.groupParticipantsUpdate ===
      "function"
    ) {
      await socket.groupParticipantsUpdate(
        message.from,
        [userJid],
        "remove",
      );

      return true;
    }

    if (
      typeof message.send === "function"
    ) {
      await message.send({
        groupParticipantsUpdate: {
          jid: message.from,
          participants: [userJid],
          action: "remove",
        },
      });

      return true;
    }
  } catch (error) {
    console.error(
      "[antigroupstatus] kick failed:",
      error?.message || error,
    );
  }

  return false;
}

Module({
  command: "antigroupstatus",

  aliases: [
    "antigruopstatus",
    "antigcstatus",
    "ags",
    "nogroupstatus",
  ],

  package: "group",

  description:
    "Detect group status messages and act with kick, delete, or warn",
})(async (message, match) => {
  if (!message.isGroup) {
    return message.send(theme.isGroup);
  }

  await message.loadGroupInfo?.();

  if (
    !message.isAdmin &&
    !message.isFromMe &&
    !message.isfromMe
  ) {
    return message.send(theme.isAdmin);
  }

  if (!message.isBotAdmin) {
    return message.send(theme.isBotAdmin);
  }

  const prefix = message.prefix || ".";

  const rawArg = String(
    match || "",
  )
    .trim()
    .toLowerCase();

  const current = getMode(message);

  const normalised =
    rawArg === "on" ||
    rawArg === "enable" ||
    rawArg === "enabled" ||
    rawArg === "activate"
      ? "warn"
      : rawArg === "disable" ||
          rawArg === "disabled" ||
          rawArg === "deactivate" ||
          rawArg === "false" ||
          rawArg === "0" ||
          rawArg === "no" ||
          rawArg === "stop"
        ? "off"
        : rawArg;

  const validWithOff = [
    "off",
    ...VALID_MODES,
  ];

  if (
    !normalised ||
    !validWithOff.includes(normalised)
  ) {
    const modeLabel =
      current === "warn"
        ? "WARN ⚠️"
        : current === "kick"
          ? "KICK 🚫"
          : current === "delete"
            ? "DELETE 🗑️"
            : "OFF ❌";

    return message.send(
      `╭─❏ 「 ANTIGROUPSTATUS 」\n` +
        `│ Status: *${modeLabel}*\n` +
        `│\n` +
        `│ Detects messages posted as a group status/story\n` +
        `│ and punishes non-admins who post one.\n` +
        `│\n` +
        `│ Usage:\n` +
        `│ *${prefix}antigroupstatus warn* → delete + warn\n` +
        `│ *${prefix}antigroupstatus kick* → delete + instant kick\n` +
        `│ *${prefix}antigroupstatus delete* → delete only\n` +
        `│ *${prefix}antigroupstatus off* → disable\n` +
        `╰───────────────\n` +
        `> © Powered by Fahim Bot`,
    );
  }

  setMode(message, normalised);

  const desc =
    normalised === "off"
      ? "Anti-Group Status *DISABLED ❌*\n" +
        "│ Group statuses are now allowed."
      : normalised === "warn"
        ? "Anti-Group Status set to *WARN ⚠️*\n" +
          "│ Message deleted + sender warned."
        : normalised === "kick"
          ? "Anti-Group Status set to *KICK 🚫*\n" +
            "│ Non-admins posting = Instant kick."
          : "Anti-Group Status set to *DELETE 🗑️*\n" +
            "│ Message deleted, no warning or kick.";

  return message.send(
    `╭─❏ 「 ANTIGROUPSTATUS 」\n` +
      `│ ${desc}\n` +
      `╰───────────────`,
  );
});

Module({
  on: "message",
  package: "group",
  description:
    "Instantly handle group status messages",
})(async (message) => {
  try {
    if (!message?.isGroup) {
      return;
    }

    const mode = getMode(message);

    if (mode === "off") {
      return;
    }

    if (!isGroupStatusMessage(message)) {
      return;
    }

    const isSelfBotMsg =
      message.isFromMe === true ||
      message.isfromMe === true ||
      message?.key?.fromMe === true;

    await message.loadGroupInfo?.();

    if (
      !isSelfBotMsg &&
      message.isAdmin
    ) {
      return;
    }

    if (!message.isBotAdmin) {
      return;
    }

    const senderJid =
      message.sender ||
      message.participant ||
      message?.key?.participant ||
      message?.from;

    const senderNum = senderJid
      ? String(senderJid).split("@")[0]
      : "";

    const deleted =
      await deleteMessageFast(
        message,
        senderJid,
      );

    console.log(
      "[antigroupstatus] deleted status:",
      deleted,
      "key:",
      message?.key,
    );

    if (mode === "delete") {
      if (senderJid) {
        await message
          .send(
            `🚫 @${senderNum}, group-e status/story post kora nishiddho!`,
            {
              mentions: [senderJid],
            },
          )
          .catch(() => {});
      }

      return;
    }

    if (mode === "warn") {
      setLockUntil(
        message,
        Date.now() + 60 * 1000,
      );

      if (senderJid) {
        await message
          .send(
            `⚠️ @${senderNum}, group-e status/story post korben na! (Warned)`,
            {
              mentions: [senderJid],
            },
          )
          .catch(() => {});
      }

      return;
    }

    if (mode === "kick") {
      if (senderJid) {
        await message
          .send(
            `🚫 @${senderNum}, group-e status deyar karone kick kora holo!`,
            {
              mentions: [senderJid],
            },
          )
          .catch(() => {});

        await kickUser(
          message,
          senderJid,
        );
      }
    }
  } catch (error) {
    console.error(
      "AntiGroupStatus Event Error:",
      error,
    );
  }
});
