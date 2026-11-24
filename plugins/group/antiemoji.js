import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();

const allKey = (groupJid) => `antiemoji:all:${groupJid}`;
const listKey = (groupJid) => `antiemoji:list:${groupJid}`;

// সাধারণ/কম্পাউন্ড/ভ্যারিয়েশন সব ধরনের ইমোজি ধরার রেজেক্স
const EMOJI_EXTRACT_REGEX =
  /(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;

const EMOJI_DETECT_REGEX = /(\p{Extended_Pictographic}|\p{Emoji_Component})/gu;

function getAllEmojiEnabled(message) {
  return db.get(message.botnum, allKey(message.from), false) === true;
}

function setAllEmojiEnabled(message, value) {
  db.setHot(message.botnum, allKey(message.from), Boolean(value));
}

function getBlockedEmojis(message) {
  const saved = db.get(message.botnum, listKey(message.from), []);
  return Array.isArray(saved) ? saved : [];
}

function setBlockedEmojis(message, list) {
  db.setHot(message.botnum, listKey(message.from), list);
}

function extractEmojis(text) {
  if (!text) return [];
  const matches = String(text).match(EMOJI_EXTRACT_REGEX);
  if (!matches) return [];
  return [...new Set(matches.map((e) => e.trim()).filter(Boolean))];
}

function getMessageBody(message) {
  const rawMsg = message?.raw?.message || message?.content || message?.message || {};
  return String(
    message?.body ||
      message?.text ||
      rawMsg?.conversation ||
      rawMsg?.extendedTextMessage?.text ||
      rawMsg?.imageMessage?.caption ||
      rawMsg?.videoMessage?.caption ||
      ""
  );
}

async function deleteMessageSafe(message) {
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
      console.error("[antiemoji] Delete error:", err?.message || err);
    }
  }

  return false;
}

Module({
  command: "antiemoji",
  alias: ["aemoji"],
  package: "group",
  description: "Delete messages containing all emojis or specific set emojis",
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

  const prefix = message.prefix || ".";
  const input = String(match || "").trim();
  const parts = input ? input.split(/\s+/) : [];
  const sub = (parts[0] || "").toLowerCase();
  const restText = parts.slice(1).join(" ").trim();

  if (sub === "all") {
    const mode = (parts[1] || "").toLowerCase();
    if (mode === "on") {
      setAllEmojiEnabled(message, true);
      return message.send(
        "✅ *Success!* AntiEmoji All চালু করা হয়েছে।\nএখন সব ধরনের ইমোজি দেওয়া মেসেজ ডিলিট হবে।"
      );
    }
    if (mode === "off") {
      setAllEmojiEnabled(message, false);
      return message.send("❌ *AntiEmoji All* বন্ধ করা হয়েছে।");
    }
  }

  if (sub === "set") {
    const parsedEmojis = extractEmojis(restText);
    const fallbackTokens = parsedEmojis.length
      ? parsedEmojis
      : restText
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean);

    if (!fallbackTokens.length) {
      return message.send(
        `⚠️ অন্তত একটি ইমোজি দিন!\nউদাহরণ: *${prefix}antiemoji set 🥲 🥹 😗*`
      );
    }

    const currentList = getBlockedEmojis(message);
    const newlyAdded = [];

    for (const em of fallbackTokens) {
      if (!currentList.includes(em) && !newlyAdded.includes(em)) {
        newlyAdded.push(em);
      }
    }

    const updatedList = [...currentList, ...newlyAdded];
    setBlockedEmojis(message, updatedList);

    return message.send(
      `✅ *Success! AntiEmoji Set*\n\n` +
        `• এইবারে যুক্ত হয়েছে: *${newlyAdded.length}টি* (${newlyAdded.length ? newlyAdded.join(" ") : "কোনো নতুন ইমোজি নয়"})\n` +
        `• মোট সেট করা ইমোজি: *${updatedList.length}টি*\n` +
        `• সেট করা ইমোজিগুলো: ${updatedList.length ? updatedList.join("  ") : "নেই"}`
    );
  }

  if (sub === "unset") {
    const targetRaw = (parts[1] || "").toLowerCase();

    if (!targetRaw) {
      return message.send(
        `⚠️ কোন ইমোজি সরাবেন তা দিন বা সব সরাতে *${prefix}antiemoji unset all* লিখুন।\n` +
          `উদাহরণ: *${prefix}antiemoji unset 🥲 🥹*`
      );
    }

    if (targetRaw === "all" || targetRaw === "clear") {
      setBlockedEmojis(message, []);
      return message.send(
        "✅ *Success!* সেট করা সব নির্দিষ্ট ইমোজি মুছে ফেলা হয়েছে।"
      );
    }

    const parsedEmojis = extractEmojis(restText);
    const targetsToRemove = parsedEmojis.length
      ? parsedEmojis
      : restText
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean);

    const currentList = getBlockedEmojis(message);
    const removed = [];
    const remaining = [];

    for (const em of currentList) {
      if (targetsToRemove.includes(em)) {
        removed.push(em);
      } else {
        remaining.push(em);
      }
    }

    setBlockedEmojis(message, remaining);

    return message.send(
      `✅ *Success! AntiEmoji Unset*\n\n` +
        `• সরানো হয়েছে: *${removed.length}টি* (${removed.length ? removed.join(" ") : "পাওয়া যায়নি"})\n` +
        `• বাকি সেট ইমোজি: *${remaining.length}টি*\n` +
        `• বাকি ইমোজিগুলো: ${remaining.length ? remaining.join("  ") : "নেই"}`
    );
  }

  const allStatus = getAllEmojiEnabled(message) ? "✅ ON" : "❌ OFF";
  const blockedList = getBlockedEmojis(message);
  const emojisDisplay = blockedList.length
    ? `${blockedList.join("  ")} (*${blockedList.length}টি*)`
    : "নেই (*0টি*)";

  return message.send(
    `📌 *AntiEmoji ব্যবহারের নিয়ম:*\n\n` +
      `• All Emoji: *${allStatus}*\n` +
      `• Set Emojis: ${emojisDisplay}\n\n` +
      `👉 সব ইমোজি বন্ধ/চালু: *${prefix}antiemoji all on / off*\n` +
      `👉 নির্দিষ্ট ইমোজি সেট: *${prefix}antiemoji set 🥲 🥹 😗*\n` +
      `👉 নির্দিষ্ট ইমোজি সরানো: *${prefix}antiemoji unset 🥲 🥹*\n` +
      `👉 সব সেট ইমোজি ক্লিয়ার: *${prefix}antiemoji unset all*`
  );
});

Module({
  on: "message",
  package: "group",
  description: "Delete messages with all emojis or specific set emojis",
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

    const allEnabled = getAllEmojiEnabled(message);
    const blockedList = getBlockedEmojis(message);

    if (!allEnabled && blockedList.length === 0) return;

    const bodyText = getMessageBody(message);
    if (!bodyText) return;

    EMOJI_DETECT_REGEX.lastIndex = 0;
    const hasAnyEmoji = allEnabled && EMOJI_DETECT_REGEX.test(bodyText);
    const hasBlockedEmoji =
      blockedList.length > 0 &&
      blockedList.some((emoji) => bodyText.includes(emoji));

    if (hasAnyEmoji || hasBlockedEmoji) {
      await deleteMessageSafe(message);
    }
  } catch (e) {
    console.error("AntiEmoji Delete Error:", e);
  }
});
