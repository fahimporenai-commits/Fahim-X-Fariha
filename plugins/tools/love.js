import { Module } from "../../lib/plugins.js";

function getSock(message) {
  return message?.conn || message?.client || message?.sock || null;
}

function getChatId(message) {
  return message?.from || message?.key?.remoteJid || "";
}

function getQuoteTarget(message) {
  return (
    (typeof message?.getRaw === "function" ? message.getRaw() : null) ||
    message?.raw ||
    message?.gift ||
    undefined
  );
}

function cleanDigits(jid) {
  if (!jid) return "";
  return String(jid)
    .split("@")[0]
    .split(":")[0]
    .split("_")[0]
    .replace(/\D/g, "");
}

function toJid(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.includes("@")) return s;
  const d = cleanDigits(s);
  return d ? `${d}@s.whatsapp.net` : "";
}

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractMentions(message, match = "") {
  const ctx =
    message?.content?.contextInfo ||
    message?.raw?.message?.extendedTextMessage?.contextInfo ||
    message?.message?.extendedTextMessage?.contextInfo ||
    {};

  const list = [];
  if (Array.isArray(message?.mentionedJid)) list.push(...message.mentionedJid);
  if (Array.isArray(ctx?.mentionedJid)) list.push(...ctx.mentionedJid);

  const phoneMatches = String(match || "").match(/@(\d{5,15})/g) || [];
  for (const pm of phoneMatches) {
    const d = cleanDigits(pm);
    if (d) list.push(`${d}@s.whatsapp.net`);
  }

  const deduped = [];
  const seen = new Set();
  for (const item of list) {
    const jid = toJid(item);
    const digits = cleanDigits(jid);
    if (!jid || !digits || seen.has(digits)) continue;
    seen.add(digits);
    deduped.push(jid);
  }
  return deduped;
}

async function resolveSenderJid(message) {
  let digits = cleanDigits(message?.sender || message?.senderAlt || message?.key?.participant);
  if ((!digits || String(message?.sender || "").endsWith("@lid")) && typeof message?.getSenderNumber === "function") {
    const resolved = await message.getSenderNumber().catch(() => null);
    if (resolved) digits = cleanDigits(resolved);
  }
  return toJid(digits || message?.sender || message?.senderAlt);
}

async function getGroupCandidateJids(sock, chatId, message) {
  const pool = [];
  if (Array.isArray(message?.groupMetadata?.participants)) {
    for (const p of message.groupMetadata.participants) {
      const id = toJid(p?.id || p?.jid || p?.phoneNumber);
      if (id) pool.push(id);
    }
  } else if (sock && typeof sock.groupMetadata === "function" && chatId?.endsWith("@g.us")) {
    const meta = await sock.groupMetadata(chatId).catch(() => null);
    if (Array.isArray(meta?.participants)) {
      for (const p of meta.participants) {
        const id = toJid(p?.id || p?.jid || p?.phoneNumber);
        if (id) pool.push(id);
      }
    }
  }
  const seen = new Set();
  return pool.filter((jid) => {
    const d = cleanDigits(jid);
    if (!d || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

async function fetchProfileBuffer(sock, jid, fallbackLabel, sharp) {
  try {
    if (sock && typeof sock.profilePictureUrl === "function" && jid) {
      const url = await sock.profilePictureUrl(jid, "image").catch(() => null);
      if (url) {
        const res = await fetch(url);
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          const rawBuf = Buffer.from(arrBuf);
          if (rawBuf.length > 0) {
            return await sharp(rawBuf)
              .resize(260, 260, { fit: "cover" })
              .png()
              .toBuffer();
          }
        }
      }
    }
  } catch (_) {}

  const letter = escapeXml((fallbackLabel || "?").slice(0, 1).toUpperCase());
  const fallbackSvg = `
<svg width="260" height="260" viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="av" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff758c"/>
      <stop offset="100%" stop-color="#ff7eb3"/>
    </linearGradient>
  </defs>
  <rect width="260" height="260" rx="130" fill="url(#av)"/>
  <circle cx="130" cy="96" r="42" fill="#ffffff" fill-opacity="0.9"/>
  <path d="M52 222 C52 172, 208 172, 208 222" fill="#ffffff" fill-opacity="0.9"/>
  <text x="130" y="112" text-anchor="middle" fill="#db2777" font-family="sans-serif" font-size="42" font-weight="800">${letter}</text>
</svg>`.trim();

  return sharp(Buffer.from(fallbackSvg)).png().toBuffer();
}

async function makeCircularPng(imgBuf, size, sharp) {
  const resized = await sharp(imgBuf)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();

  const half = size / 2;
  const ringStroke = 8;
  const maskSvg = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${half}" cy="${half}" r="${half - 2}" fill="#ffffff"/>
</svg>`.trim();

  const borderSvg = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${half}" cy="${half}" r="${half - ringStroke / 2 - 2}" fill="none" stroke="#ffffff" stroke-width="${ringStroke}"/>
</svg>`.trim();

  const masked = await sharp(resized)
    .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(masked)
    .composite([{ input: Buffer.from(borderSvg), blend: "over" }])
    .png()
    .toBuffer();
}

async function renderRomanticCoupleCard({ sock, userA, userB, cmdName }) {
  const { default: sharp } = await import("sharp");

  const mainTitle = cmdName === "love" ? "LOVE MATCH" : "COUPLE GOALS";
  const subLine =
    cmdName === "love"
      ? "Written in the stars, felt in every beat"
      : "Two hearts, one soul, endless love";

  const [rawA, rawB] = await Promise.all([
    fetchProfileBuffer(sock, userA, cleanDigits(userA) || "A", sharp),
    fetchProfileBuffer(sock, userB, cleanDigits(userB) || "B", sharp),
  ]);

  const avatarSize = 236;
  const [circleA, circleB] = await Promise.all([
    makeCircularPng(rawA, avatarSize, sharp),
    makeCircularPng(rawB, avatarSize, sharp),
  ]);

  const bgSvg = `
<svg width="860" height="540" viewBox="0 0 860 540" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pinkBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff9a9e"/>
      <stop offset="48%" stop-color="#fecfef"/>
      <stop offset="100%" stop-color="#ff758c"/>
    </linearGradient>
    <linearGradient id="glassCard" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.18"/>
    </linearGradient>
  </defs>

  <rect width="860" height="540" rx="34" fill="url(#pinkBg)"/>

  <!-- Soft romantic glow circles -->
  <circle cx="130" cy="95" r="120" fill="#ffffff" fill-opacity="0.16"/>
  <circle cx="745" cy="445" r="145" fill="#be185d" fill-opacity="0.12"/>
  <circle cx="430" cy="255" r="210" fill="#fff0f6" fill-opacity="0.22"/>

  <!-- Floating hearts -->
  <text x="72" y="74" fill="#ffffff" fill-opacity="0.65" font-family="sans-serif" font-size="30">💗</text>
  <text x="765" y="84" fill="#ffffff" fill-opacity="0.65" font-family="sans-serif" font-size="32">💖</text>
  <text x="95" y="485" fill="#ffffff" fill-opacity="0.55" font-family="sans-serif" font-size="26">💕</text>
  <text x="720" y="485" fill="#ffffff" fill-opacity="0.55" font-family="sans-serif" font-size="26">💘</text>

  <!-- Main glass frame -->
  <rect x="38" y="34" width="784" height="472" rx="28" fill="url(#glassCard)" stroke="#ffffff" stroke-opacity="0.65" stroke-width="2"/>

  <!-- Left & Right Avatar Frames -->
  <circle cx="215" cy="212" r="126" fill="#ffffff" fill-opacity="0.45"/>
  <circle cx="645" cy="212" r="126" fill="#ffffff" fill-opacity="0.45"/>

  <!-- Center Heart Badge -->
  <circle cx="430" cy="212" r="46" fill="#ffffff"/>
  <circle cx="430" cy="212" r="40" fill="#be185d"/>
  <text x="430" y="226" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="36">❤</text>

  <!-- Title & Romantic Line below -->
  <text x="430" y="392" text-anchor="middle" fill="#831843" font-family="sans-serif" font-size="34" font-weight="800" letter-spacing="3">${escapeXml(mainTitle)}</text>
  <text x="430" y="428" text-anchor="middle" fill="#9d174d" font-family="Georgia, serif" font-style="italic" font-size="21">${escapeXml(subLine)}</text>

  <!-- Small corner signature: Fahim bbz -->
  <text x="796" y="492" text-anchor="end" fill="#831843" fill-opacity="0.82" font-family="Georgia, serif" font-style="italic" font-size="15">Fahim bbz</text>
</svg>`.trim();

  const leftPos = 215 - avatarSize / 2;
  const topPos = 212 - avatarSize / 2;
  const rightPos = 645 - avatarSize / 2;

  return sharp(Buffer.from(bgSvg))
    .composite([
      { input: circleA, left: leftPos, top: topPos },
      { input: circleB, left: rightPos, top: topPos },
    ])
    .png()
    .toBuffer();
}

async function handleCoupleOrLove(message, match, cmdName) {
  const sock = getSock(message);
  const chatId = getChatId(message);
  const quoted = getQuoteTarget(message);
  if (!sock || !chatId) return;

  if (typeof message.loadGroupInfo === "function") {
    await message.loadGroupInfo().catch(() => {});
  }

  const senderJid = await resolveSenderJid(message);
  const mentioned = extractMentions(message, match);
  const quotedSender = toJid(
    message?.quoted?.sender ||
      message?.content?.contextInfo?.participant ||
      message?.raw?.message?.extendedTextMessage?.contextInfo?.participant ||
      "",
  );

  let pairA = "";
  let pairB = "";

  if (cmdName === "love") {
    if (mentioned.length >= 2) {
      pairA = mentioned[0];
      pairB = mentioned[1];
    } else if (mentioned.length === 1) {
      pairA = senderJid || mentioned[0];
      pairB = mentioned[0];
    } else if (quotedSender) {
      pairA = senderJid || quotedSender;
      pairB = quotedSender;
    } else {
      const pool = await getGroupCandidateJids(sock, chatId, message);
      const filtered = pool.filter((j) => cleanDigits(j) !== cleanDigits(senderJid));
      if (filtered.length >= 2) {
        const shuffled = [...filtered].sort(() => Math.random() - 0.5);
        pairA = shuffled[0];
        pairB = shuffled[1];
      } else if (filtered.length === 1) {
        pairA = senderJid || filtered[0];
        pairB = filtered[0];
      } else {
        pairA = senderJid || "8801000000001@s.whatsapp.net";
        pairB = "8801000000002@s.whatsapp.net";
      }
    }
  } else {
    if (mentioned.length >= 2) {
      pairA = mentioned[0];
      pairB = mentioned[1];
    } else if (mentioned.length === 1) {
      pairA = senderJid || mentioned[0];
      pairB = mentioned[0];
    } else if (quotedSender) {
      pairA = senderJid || quotedSender;
      pairB = quotedSender;
    } else {
      const pool = await getGroupCandidateJids(sock, chatId, message);
      const filtered = pool.filter((j) => cleanDigits(j) !== cleanDigits(senderJid));
      if (senderJid && filtered.length >= 1) {
        pairA = senderJid;
        pairB = filtered[Math.floor(Math.random() * filtered.length)];
      } else if (pool.length >= 2) {
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        pairA = shuffled[0];
        pairB = shuffled[1];
      } else {
        pairA = senderJid || "8801000000001@s.whatsapp.net";
        pairB = "8801000000002@s.whatsapp.net";
      }
    }
  }

  const cardBuffer = await renderRomanticCoupleCard({
    sock,
    userA: pairA,
    userB: pairB,
    cmdName,
  });

  await sock.sendMessage(
    chatId,
    {
      image: cardBuffer,
      botFooter: "FAHIM XMD",
    },
    quoted ? { quoted } : {},
  );
}

Module({
  command: "cpl",
  aliases: ["cp", "🤤"],
  package: "fun",
  description: "Create a romantic pink couple card using profile pictures",
})(async (message, match) => {
  try {
    await handleCoupleOrLove(message, match, "couple");
  } catch (err) {
    console.error("[couple] error:", err);
    await message.send("❌ Couple card তৈরি করতে সমস্যা হয়েছে!");
  }
});

Module({
  command: "love",
  aliases: ["lovematch", "match"],
  package: "fun",
  description: "Create a romantic pink love match card for two users or random users",
})(async (message, match) => {
  try {
    await handleCoupleOrLove(message, match, "love");
  } catch (err) {
    console.error("[love] error:", err);
    await message.send("❌ Love card তৈরি করতে সমস্যা হয়েছে!");
  }
});
