import axios from "axios";
import { Module } from "../../lib/plugins.js";

const greetings = [
  "🙂 ⎯͢✧ জান বাল ফালাইবা নাকি হুম? 🐱",
  "😵 ⎯͢✧ আমাকে এত ডাকো কেনো... বস ফাহিম রাগ করবে! 🌸",
  "👑 ⎯͢✧ আমাকে বেশি ডাকবেন না, আমি VIP বট বুঝছেন! 🐱",
  "🍛 ⎯͢✧ ডাকলেন আসলাম... এখন কি ভাত-মাংস খাওয়াবেন নাকি? 🤭",
  "💫 ⎯͢✧ বস ফাহিম BBZ এর বট হাজির ꫝᥫ᭡ 🐱",
  "🌷 ⎯͢✧ এতো ডাকলে কিন্তু আমি অভিমান করবো হুম 😒",
  "🐱 ⎯͢✧ আমাকে ডাকলে আমি চলে আসি... এটাই তো ভালোবাসা ꫝᥫ᭡ 🌸",
  "⚡ ⎯͢✧ বস ফাহিম BBZ এর পাওয়ারফুল বট উপস্থিত 😎",
  "🤖 ⎯͢✧ আমি অনলাইনে আছি, বলেন কি করতে হবে 🌷",
  "😌 ⎯͢✧ আহা, আবার আমাকে মনে পড়ছে নাকি? 🐱",
  "🌺 ⎯͢✧ এতো কিউট করে ডাকলে না এসে পারি নাকি 😫💖",
  "🔥 ⎯͢✧ সিস্টেম ফুল স্মুথ চলছে বস 😎⚡",
  "🫣 ⎯͢✧ চুপচাপ ডাকলেন কেনো... ভয় পাইছি তো 🐱",
  "💝 ⎯͢✧ আমাকে ডাকলে মনের মধ্যে আলাদা শান্তি লাগে 🌸",
  "🎧 ⎯͢✧ ব্যাকগ্রাউন্ডে sad song বাজতাছে আর আপনি আমাকে ডাকতাছেন 😔",
  "🌙 ⎯͢✧ রাত জাগা মানুষদের জন্য আমি সবসময় অনলাইনে 🐱",
  "🚀 ⎯͢✧ FAHIM BBZ Bot always ready to chat ꫝᥫ᭡ 🌷",
  "😎 ⎯͢✧ বস ফাহিম অন ফায়ার 🔥",
  "🥺 ⎯͢✧ আমাকে এতো ভালোবাসেন কেনো বলেন তো 🐱",
  "🌸 ⎯͢✧ আপনার ডাকে হাজির হয়ে গেলাম ꫝᥫ᭡",
  "🤍 ⎯͢✧ আমি কিন্তু শুধু স্পেশাল মানুষদের রিপ্লাই দেই 😌",
];

// এই process চলাকালীন বটের পাঠানো message ID-গুলো মনে রাখে।
// এতে group-এ নিজের greeting/AI উত্তরের reply নির্ভুলভাবে চেনা যায়।
const botMessageIds = new Map();
const MAX_REMEMBERED_MESSAGES = 5000;

function rememberBotMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  botMessageIds.set(`${chatId}:${messageId}`, true);
  if (botMessageIds.size > MAX_REMEMBERED_MESSAGES) {
    botMessageIds.delete(botMessageIds.keys().next().value);
  }
}

function getContextInfo(message) {
  const rawMsg = message?.raw?.message || message?.content || message?.message || {};
  return (
    rawMsg?.extendedTextMessage?.contextInfo ||
    rawMsg?.imageMessage?.contextInfo ||
    rawMsg?.videoMessage?.contextInfo ||
    rawMsg?.documentMessage?.contextInfo ||
    rawMsg?.quotedMessage?.contextInfo ||
    message?.quoted?.key ||
    message?.quoted ||
    null
  );
}

function getQuotedMessageId(contextInfo) {
  return contextInfo?.stanzaId || contextInfo?.id || contextInfo?.key?.id || null;
}

function getBotJid(message) {
  const rawId =
    message?.client?.user?.id ||
    message?.client?.user?.jid ||
    message?.conn?.user?.id ||
    message?.conn?.user?.jid ||
    message?.client?.authState?.creds?.me?.id ||
    message?.conn?.authState?.creds?.me?.id ||
    message?.botjid ||
    message?.botJid ||
    "";
  return String(rawId || "");
}

function isReplyToThisBot(message, contextInfo) {
  if (!contextInfo) return false;

  const chatId = message.from || message.key?.remoteJid;
  const quotedId = getQuotedMessageId(contextInfo);
  if (quotedId && botMessageIds.has(`${chatId}:${quotedId}`)) return true;

  // Restart-এর পরেও group reply শনাক্ত করার fallback: quoted message-এর author bot কি না।
  const quotedAuthor =
    contextInfo.participant ||
    contextInfo.remoteJid ||
    contextInfo.key?.participant;
  const botJid = getBotJid(message);
  if (quotedAuthor && botJid) {
    return String(quotedAuthor).split(":")[0] === botJid.split(":")[0];
  }

  return contextInfo.fromMe === true || contextInfo.key?.fromMe === true;
}

async function askAI(text, sender) {
  const apiConfig = await axios.get(
    "https://raw.githubusercontent.com/MOHAMMAD-NAYAN-OFFICIAL/Nayan/main/api.json",
    { timeout: 15000 }
  );
  const apiBase = apiConfig.data?.api;
  if (!apiBase) throw new Error("AI API URL পাওয়া যায়নি");

  const response = await axios.get(
    `${apiBase}/sim?type=ask&ask=${encodeURIComponent(text)}&number=${encodeURIComponent((sender || "").split("@")[0])}`,
    { timeout: 30000 }
  );
  return response.data?.data?.msg || "🤖 বুঝতে পারিনি!";
}

function getRandomGreeting() {
  return greetings[Math.floor(Math.random() * greetings.length)];
}

async function sendBotReply(message, text, { mentionSender = true, quoteMessage = true } = {}) {
  const chatId = message.from || message.key?.remoteJid;
  const sender = message.sender || message.participant || message.key?.participant;
  const finalText = `${mentionSender && sender ? `@${String(sender).split("@")[0]}, ` : ""}${text}`;

  const options = {};
  if (mentionSender && sender) {
    options.mentions = [sender];
  }
  if (quoteMessage && message?.key) {
    options.quoted = message.raw || message;
  }

  const sent = await message.send(finalText, options);
  const sentId = sent?.key?.id || sent?.id || sent?.stanzaId;
  rememberBotMessage(chatId, sentId);
  return sent;
}

Module({
  command: "bot",
  alias: ["sim"],
  package: "ai",
  description: "Reply-based AI chatbot",
})(async (message, match) => {
  const sender = message.sender || message.participant || message.key?.participant;
  const usermsg = String(match || "").trim();

  if (!usermsg) {
    return sendBotReply(message, getRandomGreeting(), {
      mentionSender: true,
      quoteMessage: true,
    });
  }

  try {
    const replyText = await askAI(usermsg, sender);
    return sendBotReply(message, replyText, {
      mentionSender: false,
      quoteMessage: true,
    });
  } catch (err) {
    console.error("Bot command error:", err);
    return sendBotReply(message, "❌ AI-তে যোগাযোগ করা যায়নি, পরে চেষ্টা করুন।", {
      mentionSender: false,
      quoteMessage: true,
    });
  }
});

Module({
  on: "message",
  package: "ai",
  description: "Auto greeting on trigger words and AI reply on bot message replies",
})(async (message) => {
  try {
    if (!message || message.isBaileys || message.isFromMe || message.isfromMe || message.key?.fromMe) {
      return;
    }

    const chatId = message.from || message.key?.remoteJid;
    const sender = message.sender || message.participant || message.key?.participant;
    const rawMsg = message?.raw?.message || message?.content || message?.message || {};
    const text = String(
      message.body ||
        message.text ||
        rawMsg?.conversation ||
        rawMsg?.extendedTextMessage?.text ||
        ""
    ).trim();

    if (!text || !chatId) return;

    const normalized = text.toLowerCase();
    const singleTriggers = ["bot", "বট", "jan", "জান", "sona", "সোনা"];

    // কেবল সরাসরি ডাকলে greeting; সাধারণ hi/hello-তে কোনো স্বয়ংক্রিয় reply নয়।
    if (singleTriggers.includes(normalized)) {
      return sendBotReply(message, getRandomGreeting(), {
        mentionSender: true,
        quoteMessage: true,
      });
    }

    // greeting বা আগের AI উত্তরের reply হলেই AI-তে পাঠাবে। অন্য কারও message-এর reply উপেক্ষা করবে।
    const contextInfo = getContextInfo(message);
    if (!isReplyToThisBot(message, contextInfo)) return;

    const replyText = await askAI(text, sender);
    return sendBotReply(message, replyText, {
      mentionSender: false,
      quoteMessage: true,
    });
  } catch (err) {
    console.error("Bot Event Error:", err);
  }
});
