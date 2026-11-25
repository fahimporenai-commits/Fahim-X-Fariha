import { Module } from "../../lib/plugins.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getChatId(message) {
  return message?.from || message?.key?.remoteJid || "";
}

function resolveMentionedUser(message) {
  const mentioned = Array.isArray(message?.mentions) ? message.mentions : [];
  if (mentioned.length > 0 && mentioned[0]) {
    const jid = String(mentioned[0]).trim();
    const num = jid.split("@")[0].split(":")[0];
    if (num) {
      return {
        jid: jid.includes("@") ? jid : `${num}@s.whatsapp.net`,
        tag: `@${num}`,
      };
    }
  }

  const quotedSender =
    message?.quoted?.sender ||
    message?.quoted?.participant ||
    message?.quoted?.key?.participant ||
    "";
  if (quotedSender) {
    const jid = String(quotedSender).trim();
    const num = jid.split("@")[0].split(":")[0];
    if (num) {
      return {
        jid: jid.includes("@") ? jid : `${num}@s.whatsapp.net`,
        tag: `@${num}`,
      };
    }
  }

  return null;
}

async function sendStepMessage(message, chatId, text, mentions = []) {
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
  command: "hack",
  aliases: ["prankhack", "fakepwn"],
  package: "fun",
  description: "Extended step-by-step hacker loading and funny prank messages with optional mention",
})(async (message) => {
  const chatId = getChatId(message);
  if (!chatId) return;

  const target = resolveMentionedUser(message);
  const who = target ? target.tag : "target";
  const mentions = target ? [target.jid] : [];

  const loadingSteps = target
    ? [
        `⏳ *Hacking ${who}... 8%* \`[█░░░░░░░░░░░]\`\n💻 Connecting to ${who}'s terminal...`,
        `⏳ *Hacking ${who}... 19%* \`[██░░░░░░░░░░]\`\n🌐 Tracing IP & open ports of ${who}...`,
        `⏳ *Hacking ${who}... 32%* \`[████░░░░░░░░]\`\n🔓 Bypassing ${who}'s firewall with 2 cups of tea...`,
        `⏳ *Hacking ${who}... 46%* \`[█████░░░░░░░]\`\n📡 Injecting funny prank packet into ${who}'s chat...`,
        `⏳ *Hacking ${who}... 60%* \`[███████░░░░░]\`\n📂 Scanning ${who}'s secret memes & stickers...`,
        `⏳ *Hacking ${who}... 74%* \`[█████████░░░]\`\n🔐 Decrypting ${who}'s late-night snack logs...`,
        `⏳ *Hacking ${who}... 88%* \`[██████████░░]\`\n⚡ Almost done hacking ${who}...`,
        `⏳ *Hacking ${who}... 96%* \`[███████████░]\`\n🛰️ Finalizing prank payload for ${who}...`,
        `✅ *100% Complete!* \`[████████████]\`\n🎉 Hack simulation finished on ${who}!`,
      ]
    : [
        "⏳ *Loading... 8%* `[█░░░░░░░░░░░]`\n💻 Booting hacker console...",
        "⏳ *Loading... 19%* `[██░░░░░░░░░░]`\n🌐 Establishing encrypted prank tunnel...",
        "⏳ *Loading... 32%* `[████░░░░░░░░]`\n🔓 Breaking weak passwords like `123456`...",
        "⏳ *Loading... 46%* `[█████░░░░░░░]`\n📡 Scanning chat server & sticker pack...",
        "⏳ *Loading... 60%* `[███████░░░░░]`\n📂 Checking secret memes & gallery folders...",
        "⏳ *Loading... 74%* `[█████████░░░]`\n🔐 Reading late-night fridge raid history...",
        "⏳ *Loading... 88%* `[██████████░░]`\n⚡ Bypassing anti-nonsense protection...",
        "⏳ *Loading... 96%* `[███████████░]`\n🛰️ Wrapping up final scan...",
        "✅ *100% Complete!* `[████████████]`\n🎉 System scan finished!",
      ];

  for (const stepText of loadingSteps) {
    await sendStepMessage(message, chatId, stepText, mentions);
    await sleep(1050);
  }

  const funnyMessages = target
    ? [
        `🕵️‍♂️ *Report #1:* ${who}-এর WiFi পাসওয়ার্ড পাওয়া গেছে: \`ami_wifi_dibona_123\``,
        `🍕 *Report #2:* ${who} রাত ২টায় ফ্রিজ খুলে কী খেয়েছিল সেটার লগ বের হয়েছে!`,
        `💸 *Report #3:* ${who}-এর ব্যালেন্স চেক করে দেখা গেল—সব টাকা ফুচকা আর বার্গারে শেষ!`,
        `📱 *Report #4:* ${who}-এর ফোনে ৯৯৯টা আনরিড মেসেজ আর ৪৫০টা ফানি স্টিকার পাওয়া গেছে!`,
        `😂 *Just For Fun:* ভয় পাবেন না ${who}! এটা শুধুই একটা মজার **Fake Hack** প্র্যাঙ্ক ছিল।`,
      ]
    : [
        "🕵️‍♂️ *Report #1:* WiFi password found: `12345678` (very strong 😄)",
        "🍕 *Report #2:* Late-night fridge raid detected at 2:00 AM!",
        "💸 *Report #3:* Balance check: 0 taka left — all spent on biryani & coffee!",
        "📱 *Report #4:* Found 999+ unread chats and 450 funny stickers!",
        "😂 *Just For Fun:* Relax! This is a harmless fake hack prank.",
      ];

  for (const funnyText of funnyMessages) {
    await sleep(950);
    await sendStepMessage(message, chatId, funnyText, mentions);
  }
});
