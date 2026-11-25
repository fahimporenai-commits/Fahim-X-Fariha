import { Module } from "../../lib/plugins.js";
import { isSudo } from "../../lib/sudo.js";

const activeJobs = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getChatId(message) {
  return message?.from || message?.key?.remoteJid || "";
}

async function hasPermission(message) {
  if (!message) return false;

  if (
    message.isFromMe ||
    message.isfromMe ||
    message.key?.fromMe ||
    message.isOwner ||
    message.isCreator ||
    message.isSudo
  ) {
    return true;
  }

  if (
    isSudo(
      message,
      message.sender,
      message.senderAlt,
      message.participant,
      message.key?.participant,
      message.key?.participantAlt,
    )
  ) {
    return true;
  }

  if (typeof message.getSenderNumber === "function") {
    const num = await message.getSenderNumber().catch(() => null);
    if (num && isSudo(num)) return true;
  }

  if (message.isGroup) {
    if (typeof message.loadGroupInfo === "function") {
      await message.loadGroupInfo().catch(() => {});
    }
    if (message.isAdmin) return true;
  }

  return false;
}

async function sendPayload(message, chatId, payload) {
  const sock = getSock(message);
  if (sock && typeof sock.sendMessage === "function") {
    return sock.sendMessage(chatId, payload);
  }
  if (typeof message?.send === "function") {
    return message.send(payload);
  }
  return null;
}

async function extractQuotedPayload(message) {
  const q = message?.quoted;
  if (!q) return null;

  const qType = String(q.type || "");
  const qBody = String(q.body || "").trim();

  if (
    qType === "stickerMessage" ||
    q.msg?.isAnimated !== undefined ||
    q.msg?.mimetype === "image/webp"
  ) {
    if (typeof q.download === "function") {
      const stickerBuf = await q.download();
      if (Buffer.isBuffer(stickerBuf) && stickerBuf.length > 0) {
        return { sticker: stickerBuf };
      }
    }
  }

  if (qType === "imageMessage") {
    if (typeof q.download === "function") {
      const imgBuf = await q.download();
      if (Buffer.isBuffer(imgBuf) && imgBuf.length > 0) {
        return qBody ? { image: imgBuf, caption: qBody } : { image: imgBuf };
      }
    }
  }

  if (qType === "videoMessage" || qType === "ptvMessage") {
    if (typeof q.download === "function") {
      const vidBuf = await q.download();
      if (Buffer.isBuffer(vidBuf) && vidBuf.length > 0) {
        return qBody ? { video: vidBuf, caption: qBody } : { video: vidBuf };
      }
    }
  }

  if (qType === "audioMessage") {
    if (typeof q.download === "function") {
      const audBuf = await q.download();
      if (Buffer.isBuffer(audBuf) && audBuf.length > 0) {
        return {
          audio: audBuf,
          mimetype: q.msg?.mimetype || "audio/mp4",
          ptt: Boolean(q.msg?.ptt),
        };
      }
    }
  }

  const fallbackText =
    qBody ||
    q.msg?.text ||
    q.msg?.caption ||
    (typeof q.msg === "string" ? q.msg : "");

  if (String(fallbackText || "").trim()) {
    return { text: String(fallbackText).trim() };
  }

  return null;
}

function parseFahimCommand(match, hasQuoted) {
  const raw = String(match || "").trim();
  const lower = raw.toLowerCase();

  if (lower === "stop" || lower === "cancel" || lower === "off") {
    return { mode: "stop", text: "", count: 0 };
  }

  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      return {
        mode: "run",
        text: "",
        count: Math.min(Math.floor(num), 500),
      };
    }
  }

  if (!raw && hasQuoted) {
    return {
      mode: "run",
      text: "",
      count: 10,
    };
  }

  if (!raw) {
    return { mode: "help", text: "", count: 0 };
  }

  const endNumMatch = raw.match(/^(.*?)\s+(\d+)\s*$/);
  if (endNumMatch) {
    const textPart = String(endNumMatch[1] || "").trim();
    const numPart = Number(endNumMatch[2]);
    if (textPart && Number.isFinite(numPart) && numPart > 0) {
      return {
        mode: "run",
        text: textPart,
        count: Math.min(Math.floor(numPart), 500),
      };
    }
  }

  const startNumMatch = raw.match(/^(\d+)\s+(.*)$/);
  if (startNumMatch) {
    const numPart = Number(startNumMatch[1]);
    const textPart = String(startNumMatch[2] || "").trim();
    if (textPart && Number.isFinite(numPart) && numPart > 0) {
      return {
        mode: "run",
        text: textPart,
        count: Math.min(Math.floor(numPart), 500),
      };
    }
  }

  return {
    mode: "run",
    text: raw,
    count: 10,
  };
}

Module({
  command: "fahim2",
  aliases: ["lol", "fuck", "bal"],
  package: "fun",
  description: "Repeat custom text or quoted sticker/message/media (Owner/Sudo or Group Admin only)",
})(async (message, match) => {
  const chatId = getChatId(message);
  if (!chatId) return;

  const allowed = await hasPermission(message);
  if (!allowed) {
    return sendPayload(message, chatId, {
      text: "🚫 *এই কমান্ডটি শুধুমাত্র* *Bot Owner রাই ব্যবহার করতে পারবেন*!",
    });
  }

  const prefix = message?.prefix || ".";
  const hasQuoted = Boolean(message?.quoted);
  const parsed = parseFahimCommand(match, hasQuoted);

  if (parsed.mode === "help") {
    return sendPayload(message, chatId, {
      text:
        `📌 *FAHIM REPEAT SENDER*\n\n` +
        `👉 \`${prefix}fahim hello 20\` — লেখা ২০ বার পাঠাবে\n` +
        `👉 স্টিকার বা মেসেজে রিপ্লাই দিয়ে \`${prefix}fahim 100\` — ওই স্টিকার/মেসেজ ১০০ বার পাঠাবে\n` +
        `👉 \`${prefix}fahim stop\` — চলমান পাঠানো বন্ধ করবে`,
    });
  }

  if (parsed.mode === "stop") {
    const currentJob = activeJobs.get(chatId);
    if (currentJob) {
      currentJob.cancelled = true;
      activeJobs.delete(chatId);
      return sendPayload(message, chatId, {
        text: "🛑 পাঠানো বন্ধ করা হয়েছে।",
      });
    }
    return sendPayload(message, chatId, {
      text: "⚠️ এই চ্যাটে কোনো রানিং টাস্ক নেই।",
    });
  }

  let targetPayload = null;

  if (parsed.text) {
    targetPayload = { text: parsed.text };
  } else if (hasQuoted) {
    targetPayload = await extractQuotedPayload(message);
  }

  if (!targetPayload) {
    return sendPayload(message, chatId, {
      text: `⚠️ কোনো মেসেজ লিখুন অথবা স্টিকার/মেসেজে রিপ্লাই দিয়ে \`${prefix}fahim 20\` দিন!`,
    });
  }

  const prevJob = activeJobs.get(chatId);
  if (prevJob) {
    prevJob.cancelled = true;
    activeJobs.delete(chatId);
  }

  const jobState = { cancelled: false };
  activeJobs.set(chatId, jobState);

  try {
    for (let i = 1; i <= parsed.count; i++) {
      if (jobState.cancelled || activeJobs.get(chatId) !== jobState) {
        break;
      }

      await sendPayload(message, chatId, targetPayload);

      if (i < parsed.count) {
        await sleep(350);
      }
    }
  } finally {
    if (activeJobs.get(chatId) === jobState) {
      activeJobs.delete(chatId);
    }
  }
});
