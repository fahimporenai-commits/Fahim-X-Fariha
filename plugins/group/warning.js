import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { isSudo } from "../../lib/sudo.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();
const MAX_WARNINGS = 3;

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getChatId(message) {
  return message?.from || message?.key?.remoteJid || "";
}

function cleanUserDigits(jid) {
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
  const digits = cleanUserDigits(str);
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function warnStoreKey(groupJid) {
  return `warning:group:${groupJid}:counts`;
}

function getNs(message) {
  return message?.botnum || cleanUserDigits(getSock(message)?.user?.id) || "miku_warn_db";
}

function getGroupWarns(message, groupJid) {
  try {
    const data = db.get(getNs(message), warnStoreKey(groupJid), {});
    return data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  } catch {
    return {};
  }
}

function saveGroupWarns(message, groupJid, countsObj) {
  try {
    db.setHot(getNs(message), warnStoreKey(groupJid), countsObj);
  } catch (err) {
    console.error("[warning] save error:", err?.message || err);
  }
}

function resolveTargetUser(message, match) {
  const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
  if (mentions.length > 0 && mentions[0]) {
    const jid = toUserJid(mentions[0]);
    const digits = cleanUserDigits(jid);
    if (digits) {
      return {
        jid,
        key: digits,
        tag: `@${digits}`,
      };
    }
  }

  const q = message?.quoted;
  const qSender =
    q?.sender ||
    q?.participant ||
    q?.key?.participant ||
    q?.key?.participantAlt ||
    "";
  if (qSender) {
    const jid = toUserJid(qSender);
    const digits = cleanUserDigits(jid);
    if (digits) {
      return {
        jid,
        key: digits,
        tag: `@${digits}`,
      };
    }
  }

  const numMatch = String(match || "").match(/(\d{7,15})/);
  if (numMatch?.[1]) {
    const digits = cleanUserDigits(numMatch[1]);
    if (digits) {
      return {
        jid: `${digits}@s.whatsapp.net`,
        key: digits,
        tag: `@${digits}`,
      };
    }
  }

  return null;
}

function extractReason(match, targetDigits) {
  let text = String(match || "").trim();
  if (!text) return "Rule violation / Spamming";

  text = text
    .replace(/@\d+/g, "")
    .replace(new RegExp(`\\b${targetDigits}\\b`, "g"), "")
    .replace(/^(add|remove|del|delete|reset|clear|list)\b/i, "")
    .trim();

  return text || "Rule violation / Spamming";
}

function isProtectedTarget(message, target) {
  const targetDigits = target.key;
  const botDigits = cleanUserDigits(message?.botJid || message?.botLid || message?.botnum);
  if (botDigits && targetDigits === botDigits) return true;

  if (isSudo(target.jid, targetDigits)) return true;

  const admins = Array.isArray(message?.groupAdmins) ? message.groupAdmins : [];
  const isTargetAdmin = admins.some((adm) => cleanUserDigits(adm) === targetDigits);
  if (isTargetAdmin && !message?.isOwner && !message?.isFromMe) {
    return true;
  }

  return false;
}

async function kickMember(message, chatId, targetJid) {
  if (typeof message?.removeParticipant === "function") {
    const res = await message.removeParticipant(targetJid);
    if (res) return true;
  }

  const sock = getSock(message);
  if (sock && typeof sock.groupParticipantsUpdate === "function") {
    const normalized = targetJid.includes("@")
      ? targetJid
      : `${cleanUserDigits(targetJid)}@s.whatsapp.net`;
    await sock.groupParticipantsUpdate(chatId, [normalized], "remove");
    return true;
  }

  return false;
}

async function sendWarnPayload(message, chatId, text, mentions = []) {
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

Module({
  command: "warn",
  aliases: ["warning", "unwarn", "warnlist", "warncount"],
  package: "group",
  description: "Warn group members (3 warnings = auto kick) with persistent count",
})(async (message, match) => {
  try {
    const chatId = getChatId(message);
    if (!message?.isGroup || !chatId) {
      return message.send(theme.isGroup);
    }

    if (typeof message.loadGroupInfo === "function") {
      await message.loadGroupInfo().catch(() => {});
    }

    const canUse = Boolean(
      message.isAdmin || message.isOwner || message.isSudo || message.isFromMe || message.isfromMe,
    );
    if (!canUse) {
      return message.send(theme.isAdmin);
    }

    const rawMatch = String(match || "").trim();
    const firstWord = rawMatch.split(/\s+/)[0]?.toLowerCase() || "";
    const prefix = message?.prefix || ".";
    const counts = getGroupWarns(message, chatId);

    if (firstWord === "list" || message?.body?.toLowerCase().startsWith(`${prefix}warnlist`)) {
      const entries = Object.entries(counts).filter(([, c]) => Number(c) > 0);
      if (entries.length === 0) {
        return sendWarnPayload(message, chatId, "✅ এই গ্রুপে বর্তমানে কোনো ইউজারের ওয়ার্নিং নেই।");
      }

      const mentions = [];
      const lines = entries.map(([digits, c], idx) => {
        const jid = `${digits}@s.whatsapp.net`;
        mentions.push(jid);
        return `${idx + 1}. @${digits} — *${c}/${MAX_WARNINGS}*`;
      });

      return sendWarnPayload(
        message,
        chatId,
        `⚠️ *GROUP WARNING LIST*\n\n${lines.join("\n")}`,
        mentions,
      );
    }

    const target = resolveTargetUser(message, rawMatch);
    if (!target) {
      return sendWarnPayload(
        message,
        chatId,
        `⚠️ যে ইউজারকে ওয়ার্নিং দেবেন তাকে **@mention** করুন অথবা তার মেসেজে **reply** করুন!\n\n` +
          `👉 \`${prefix}warn @user spam\`\n` +
          `👉 Reply করে \`${prefix}warn\`\n` +
          `👉 \`${prefix}unwarn @user\`\n` +
          `👉 \`${prefix}warnlist\``,
      );
    }

    if (firstWord === "unwarn" || message?.body?.toLowerCase().startsWith(`${prefix}unwarn`)) {
      const prev = Number(counts[target.key] || 0);
      if (prev <= 0) {
        return sendWarnPayload(
          message,
          chatId,
          `ℹ️ ${target.tag}-এর কোনো ওয়ার্নিং রেকর্ড নেই।`,
          [target.jid],
        );
      }

      const next = Math.max(0, prev - 1);
      if (next === 0) delete counts[target.key];
      else counts[target.key] = next;
      saveGroupWarns(message, chatId, counts);

      return sendWarnPayload(
        message,
        chatId,
        `✅ ${target.tag}-এর একটি ওয়ার্নিং কমানো হয়েছে। বর্তমান ওয়ার্নিং: *${next}/${MAX_WARNINGS}*`,
        [target.jid],
      );
    }

    if (isProtectedTarget(message, target)) {
      return sendWarnPayload(
        message,
        chatId,
        `🛡️ ${target.tag} সুরক্ষিত ইউজার (Bot / Owner / Sudo / Admin)—তাকে ওয়ার্নিং দেওয়া যাবে না।`,
        [target.jid],
      );
    }

    const currentCount = Number(counts[target.key] || 0) + 1;
    const reason = extractReason(rawMatch, target.key);

    if (currentCount >= MAX_WARNINGS) {
      if (!message.isBotAdmin) {
        counts[target.key] = MAX_WARNINGS;
        saveGroupWarns(message, chatId, counts);
        return message.send(theme.isBotAdmin);
      }

      delete counts[target.key];
      saveGroupWarns(message, chatId, counts);

      const finalAlert =
        `☠️ *FINAL WARNING — MAX LIMIT REACHED!* ☠️\n\n` +
        `╭─〔 🚨 𝐃𝐀𝐍𝐆𝐄𝐑 𝐀𝐋𝐄𝐑𝐓 〕\n` +
        `│ 👤 User: ${target.tag}\n` +
        `│ ⚠️ Warning Count: *${MAX_WARNINGS}/${MAX_WARNINGS}*\n` +
        `│ 📌 Reason: *${reason}*\n` +
        `│ 🔨 Action: *REMOVED FROM GROUP*\n` +
        `╰──────────────────────\n` +
        `❌ ৩ বার ওয়ার্নিং পূর্ণ হওয়ায় গ্রুপ থেকে বের করে দেওয়া হলো!`;

      await sendWarnPayload(message, chatId, finalAlert, [target.jid]);
      await kickMember(message, chatId, target.jid);
      return;
    }

    counts[target.key] = currentCount;
    saveGroupWarns(message, chatId, counts);

    const remaining = MAX_WARNINGS - currentCount;
    const dangerMsg =
      `☢️ *DANGER WARNING ISSUED!* ☢️\n\n` +
      `╭─〔 ⚠️ 𝐖𝐀𝐑𝐍𝐈𝐍𝐆 𝐍𝐎𝐓𝐈𝐂𝐄 〕\n` +
      `│ 👤 Target: ${target.tag}\n` +
      `│ 📊 Warning Count: *${currentCount}/${MAX_WARNINGS}*\n` +
      `│ ⏳ Remaining Before Kick: *${remaining}*\n` +
      `│ 📌 Reason: *${reason}*\n` +
      `╰──────────────────────\n` +
      `🔥 সতর্ক হোন! *${MAX_WARNINGS}/3* ওয়ার্নিং হলে সরাসরি গ্রুপ থেকে কিক করা হবে!`;

    return sendWarnPayload(message, chatId, dangerMsg, [target.jid]);
  } catch (err) {
    console.error("[warning] error:", err);
    return sendWarnPayload(message, message?.from, "❌ ওয়ার্নিং কমান্ড চালাতে সমস্যা হয়েছে!");
  }
});
