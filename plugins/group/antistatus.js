import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { isSudo } from "../../lib/sudo.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const MODES = new Set(["delete", "kick", "warn"]);
const DEFAULT_WARN_LIMIT = 3;
const WARN_WINDOW_MS = 24 * 60 * 60 * 1000;

const key = (groupJid, name) =>
  `antistatus:${groupJid}:${name}`;

function cleanDigits(jid) {
  if (!jid) return "";
  return String(jid)
    .split("@")[0]
    .split(":")[0]
    .split("_")[0]
    .replace(/\D/g, "");
}

function getMode(message) {
  return String(
    db.get(
      message.botnum,
      key(message.from, "mode"),
      "delete",
    ) || "delete",
  ).toLowerCase();
}

function getWarnLimit(message) {
  const value = Number(
    db.get(
      message.botnum,
      key(message.from, "warnLimit"),
      DEFAULT_WARN_LIMIT,
    ),
  );

  return Number.isInteger(value) &&
    value >= 1 &&
    value <= 20
    ? value
    : DEFAULT_WARN_LIMIT;
}

function isEnabled(message) {
  return (
    db.get(
      message.botnum,
      key(message.from, "enabled"),
      false,
    ) === true
  );
}

function isStatusMention(message) {
  const type = String(
    message?.type || "",
  ).toLowerCase();

  // Different Baileys versions use different names.
  if (
    type === "groupstatusmentionmessage" ||
    type === "statusmentionmessage" ||
    type.includes("statusmention")
  ) {
    return true;
  }

  const content = message?.content || {};
  const rawMessage = message?.raw?.message || {};

  return Boolean(
    content.groupStatusMentionMessage ||
      content.statusMentionMessage ||
      rawMessage.groupStatusMentionMessage ||
      rawMessage.statusMentionMessage,
  );
}

async function isProtectedUser(message) {
  if (!message) return false;

  // 1. Direct flags (Bot self, Owner, Sudo, Admin)
  if (
    message.isFromMe ||
    message.isfromMe ||
    message.key?.fromMe ||
    message.isOwner ||
    message.isCreator ||
    message.isSudo ||
    message.isAdmin
  ) {
    return true;
  }

  const candidateIds = [
    message.sender,
    message.senderAlt,
    message.participant,
    message.key?.participant,
    message.key?.participantAlt,
  ].filter(Boolean);

  // 2. Resolve real phone number if sender is @lid
  let resolvedDigits = "";
  if (typeof message.getSenderNumber === "function") {
    const num = await message.getSenderNumber().catch(() => null);
    if (num) {
      resolvedDigits = cleanDigits(num);
      if (resolvedDigits) candidateIds.push(resolvedDigits);
    }
  }

  // 3. Check Bot Owner / Sudo list (supports JID, LID, and phone digits)
  for (const id of candidateIds) {
    const digits = cleanDigits(id);
    if (isSudo(message, id, digits)) {
      return true;
    }
  }

  const botDigits = cleanDigits(
    message.botJid || message.botLid || message.botnum || message.conn?.user?.id,
  );
  if (botDigits && candidateIds.some((id) => cleanDigits(id) === botDigits)) {
    return true;
  }

  // 4. Deep check Group Admins (matches both @s.whatsapp.net and @lid)
  const senderDigitSet = new Set(
    candidateIds.map((id) => cleanDigits(id)).filter(Boolean),
  );
  const senderRawSet = new Set(
    candidateIds.map((id) => String(id).trim()).filter(Boolean),
  );

  const groupAdmins = Array.isArray(message.groupAdmins) ? message.groupAdmins : [];
  for (const adm of groupAdmins) {
    if (senderRawSet.has(String(adm).trim())) return true;
    const admDigits = cleanDigits(adm);
    if (admDigits && senderDigitSet.has(admDigits)) return true;
  }

  const participants = Array.isArray(message.groupMetadata?.participants)
    ? message.groupMetadata.participants
    : [];
  for (const p of participants) {
    if (!p?.admin) continue;
    const pIds = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
    for (const pid of pIds) {
      if (senderRawSet.has(String(pid).trim())) return true;
      const pDigits = cleanDigits(pid);
      if (pDigits && senderDigitSet.has(pDigits)) return true;
    }
  }

  return false;
}

async function deleteMessage(message) {
  if (
    !message?.key ||
    typeof message.send !== "function"
  ) {
    return false;
  }

  try {
    await message.send({
      delete: message.key,
    });

    return true;
  } catch (error) {
    console.error(
      "[antistatus] delete failed:",
      error?.message || error,
    );

    return false;
  }
}

async function kickUser(message, senderJid) {
  if (!senderJid) return false;

  try {
    if (
      typeof message.removeParticipant ===
      "function"
    ) {
      await message.removeParticipant([
        senderJid,
      ]);

      return true;
    }

    if (
      message.conn?.groupParticipantsUpdate
    ) {
      await message.conn.groupParticipantsUpdate(
        message.from,
        [senderJid],
        "remove",
      );

      return true;
    }
  } catch (error) {
    console.error(
      "[antistatus] kick failed:",
      error?.message || error,
    );
  }

  return false;
}

function resetWarning(message, senderJid) {
  if (!senderJid) return;

  db.setHot(
    message.botnum,
    key(
      message.from,
      `count:${senderJid}`,
    ),
    {
      count: 0,
      updatedAt: Date.now(),
    },
  );
}

function addWarning(message, senderJid) {
  if (!senderJid) return 1;

  const warningKey = key(
    message.from,
    `count:${senderJid}`,
  );

  const old = db.get(
    message.botnum,
    warningKey,
    null,
  );

  const now = Date.now();

  const previous =
    old &&
    typeof old === "object" &&
    now - Number(old.updatedAt || 0) <
      WARN_WINDOW_MS
      ? Number(old.count || 0)
      : 0;

  const count = previous + 1;

  db.setHot(
    message.botnum,
    warningKey,
    {
      count,
      updatedAt: now,
    },
  );

  return count;
}

function statusText(message) {
  const enabled = isEnabled(message);
  const mode = getMode(message);
  const limit = getWarnLimit(message);
  const prefix = message.prefix || ".";

  return [
    "⚙️ AntiStatus",
    `• Status: ${
      enabled ? "✅ ON" : "❌ OFF"
    }`,
    `• Mode: ${mode.toUpperCase()}`,
    `• Warn limit: ${limit}`,
    "",
    `Usage: ${prefix}antistatus on`,
    `${prefix}antistatus off`,
    `${prefix}antistatus delete`,
    `${prefix}antistatus kick`,
    `${prefix}antistatus warn 2`,
  ].join("\n");
}

// Command section
Module({
  command: "antistatus",
  package: "group",
  description:
    "Delete, kick, or warn users who send group status mentions",
})(async (message, match) => {
  if (!message.isGroup) {
    return message.send(theme.isGroup);
  }

  await message.loadGroupInfo?.();

  const canManage = await isProtectedUser(message);
  if (!canManage) {
    return message.send(theme.isAdmin);
  }

  if (!message.isBotAdmin) {
    return message.send(theme.isBotAdmin);
  }

  const args = String(match || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const action = args[0] || "status";
  const prefix = message.prefix || ".";

  // .antistatus
  if (action === "status") {
    return message.send(statusText(message));
  }

  // .antistatus on
  if (action === "on") {
    db.setHot(
      message.botnum,
      key(message.from, "enabled"),
      true,
    );

    if (!MODES.has(getMode(message))) {
      db.setHot(
        message.botnum,
        key(message.from, "mode"),
        "delete",
      );
    }

    return message.send(
      "✅ AntiStatus ON\n" +
        "Default mode: DELETE",
    );
  }

  // .antistatus off
  if (action === "off") {
    db.setHot(
      message.botnum,
      key(message.from, "enabled"),
      false,
    );

    return message.send(
      "✅ AntiStatus OFF.",
    );
  }

  // .antistatus delete
  if (
    action === "delete" ||
    action === "kick"
  ) {
    db.setHot(
      message.botnum,
      key(message.from, "mode"),
      action,
    );

    db.setHot(
      message.botnum,
      key(message.from, "enabled"),
      true,
    );

    return message.send(
      `✅ AntiStatus mode: ${action.toUpperCase()}\n` +
        "Feature automatically enabled.",
    );
  }

  // .antistatus warn 2
  // .antistatus warn 3
  if (action === "warn") {
    const limit = Number(
      args[1] || DEFAULT_WARN_LIMIT,
    );

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    ) {
      return message.send(
        "❌ Warn limit 1 থেকে 20-এর মধ্যে দিন.\n" +
          `Example: ${prefix}antistatus warn 3`,
      );
    }

    db.setHot(
      message.botnum,
      key(message.from, "mode"),
      "warn",
    );

    db.setHot(
      message.botnum,
      key(message.from, "warnLimit"),
      limit,
    );

    db.setHot(
      message.botnum,
      key(message.from, "enabled"),
      true,
    );

    return message.send(
      "✅ AntiStatus mode: WARN\n" +
        `${limit}টি status mention হলে user auto-kick হবে.\n` +
        "Feature automatically enabled.",
    );
  }

  return message.send(
    "Usage:\n" +
      `${prefix}antistatus on\n` +
      `${prefix}antistatus off\n` +
      `${prefix}antistatus delete\n` +
      `${prefix}antistatus kick\n` +
      `${prefix}antistatus warn 2`,
  );
});

// Incoming group status mention handler
Module({
  on: "message",
  package: "group",
  description:
    "Enforce AntiStatus on group status mentions",
})(async (message) => {
  if (
    !message?.isGroup ||
    !isStatusMention(message)
  ) {
    return;
  }

  if (!isEnabled(message)) {
    return;
  }

  await message.loadGroupInfo?.();

  // Bot admin না হলে delete/kick করা যাবে না।
  if (!message.isBotAdmin) {
    return;
  }

  // Group Admin, Bot Owner এবং Sudo user protected থাকবে।
  if (await isProtectedUser(message)) {
    return;
  }

  const sender = message.sender;

  const mention = sender
    ? `@${String(sender).split("@")[0]}`
    : "user";

  const mentions = sender
    ? [sender]
    : [];

  const mode = getMode(message);

  // সব mode-এই status mention আগে delete হবে।
  await deleteMessage(message);

  // Delete mode: শুধু delete।
  if (mode === "delete") {
    return;
  }

  // Kick mode: প্রথমবারেই kick।
  if (mode === "kick") {
    const removed = await kickUser(
      message,
      sender,
    );

    await message.send(
      removed
        ? `🚫 ${mention} group status mention করেছে এবং group থেকে remove করা হয়েছে.`
        : `⚠️ ${mention}, status mention delete হয়েছে কিন্তু kick করা যায়নি.`,
      { mentions },
    );

    return;
  }

  // Warn mode: নির্দিষ্ট সংখ্যার পর kick।
  if (mode === "warn") {
    const count = addWarning(
      message,
      sender,
    );

    const limit = getWarnLimit(message);

    if (count >= limit) {
      const removed = await kickUser(
        message,
        sender,
      );

      resetWarning(
        message,
        sender,
      );

      await message.send(
        removed
          ? `🚫 ${mention} ${count} বার status mention করেছে এবং auto-kick হয়েছে.`
          : `⚠️ ${mention} ${count} বার status mention করেছে, কিন্তু kick করা যায়নি.`,
        { mentions },
      );

      return;
    }

    await message.send(
      `⚠️ ${mention}, status mention করা নিষেধ.\n` +
        `Warning: ${count}/${limit}\n` +
        `${limit} বার হলে auto-kick হবে.`,
      { mentions },
    );
  }
});
