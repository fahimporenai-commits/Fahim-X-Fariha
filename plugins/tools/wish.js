import { Module } from "../../lib/plugins.js";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const SESSIONS = new Map();
const SESSION_TTL_MS = 6 * 60 * 1000;

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

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFilePart(str = "") {
  return (
    String(str || "wish")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "wish"
  );
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

async function resolveSenderKeys(message, chatId) {
  const keys = new Set();
  const candidates = [
    message?.sender,
    message?.senderAlt,
    message?.key?.participant,
    message?.participant,
  ];

  for (const c of candidates) {
    if (!c) continue;
    keys.add(`${chatId}:${String(c).trim()}`);
    const d = cleanDigits(c);
    if (d) keys.add(`${chatId}:${d}`);
  }

  if (typeof message?.getSenderNumber === "function") {
    const resolved = await message.getSenderNumber().catch(() => null);
    const d = cleanDigits(resolved);
    if (d) keys.add(`${chatId}:${d}`);
  }

  if (chatId && !chatId.endsWith("@g.us")) {
    const chatDigits = cleanDigits(chatId);
    keys.add(`${chatId}:${chatId}`);
    if (chatDigits) keys.add(`${chatId}:${chatDigits}`);
  }

  return [...keys];
}

function findActiveSession(message, chatId) {
  for (const [key, sess] of SESSIONS.entries()) {
    if (sess.chatId !== chatId) continue;
    if (Date.now() > sess.expiresAt) {
      SESSIONS.delete(key);
      continue;
    }
    const rawCandidates = [
      message?.sender,
      message?.senderAlt,
      message?.key?.participant,
      message?.participant,
      !chatId.endsWith("@g.us") ? chatId : "",
    ].filter(Boolean);

    const msgDigits = rawCandidates.map(cleanDigits).filter(Boolean);
    const sessDigits = cleanDigits(sess.senderJid);

    if (
      sess.keys?.some((k) => {
        const kd = cleanDigits(k.split(":")[1] || "");
        return kd && msgDigits.includes(kd);
      }) ||
      (sessDigits && msgDigits.includes(sessDigits))
    ) {
      return { key, session: sess };
    }
  }
  return null;
}

async function getAvatarDataUrl(sock, targetJid) {
  if (!targetJid || !sock || typeof sock.profilePictureUrl !== "function") {
    return "";
  }
  try {
    const url = await sock.profilePictureUrl(targetJid, "image").catch(() => null);
    if (!url) return "";
    const res = await fetch(url);
    if (!res.ok) return "";
    const arrBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrBuf);
    if (!buf.length) return "";
    const mime = res.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

function getMessageText(message) {
  const rawMsg = message?.raw?.message || message?.message || {};
  return String(
    message?.body ??
      message?.text ??
      message?.msg ??
      rawMsg?.conversation ??
      rawMsg?.extendedTextMessage?.text ??
      rawMsg?.imageMessage?.caption ??
      "",
  ).trim();
}

async function extractImageDataUrl(message) {
  const rawMsg = message?.raw?.message || message?.message || {};
  const ctxQuoted =
    message?.content?.contextInfo?.quotedMessage ||
    rawMsg?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null;

  const directImg =
    rawMsg?.imageMessage ||
    rawMsg?.viewOnceMessage?.message?.imageMessage ||
    rawMsg?.viewOnceMessageV2?.message?.imageMessage ||
    null;

  const quotedImg =
    ctxQuoted?.imageMessage ||
    ctxQuoted?.viewOnceMessage?.message?.imageMessage ||
    ctxQuoted?.viewOnceMessageV2?.message?.imageMessage ||
    message?.quoted?.msg ||
    null;

  const targetImg = directImg || quotedImg;
  if (!targetImg) return "";

  try {
    if (Buffer.isBuffer(message?.quoted?.buffer) && message.quoted.buffer.length > 0) {
      const mime = targetImg.mimetype || "image/jpeg";
      return `data:${mime};base64,${message.quoted.buffer.toString("base64")}`;
    }

    if (typeof message?.quoted?.download === "function") {
      const buf = await message.quoted.download();
      if (Buffer.isBuffer(buf) && buf.length > 0) {
        const mime = targetImg.mimetype || "image/jpeg";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
    }

    const stream = await downloadContentFromMessage(targetImg, "image");
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) return "";
    const mime = targetImg.mimetype || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

const PREMIUM_THEMES = [
  {
    name: "Pastel Rose Glass",
    bg: "radial-gradient(circle at top left, #ff9a9e 0%, #fecfef 42%, #ff758c 100%)",
    cardBg: "rgba(255, 255, 255, 0.80)",
    cardBorder: "rgba(255, 255, 255, 0.94)",
    textMain: "#6b113c",
    textSub: "#9d174d",
    boxBg: "rgba(255, 240, 246, 0.92)",
    boxBorder: "rgba(244, 114, 182, 0.36)",
    btnGrad: "linear-gradient(135deg, #db2777, #f43f5e)",
    badgeBg: "rgba(219, 39, 119, 0.14)",
    badgeColor: "#be185d",
  },
  {
    name: "Midnight Velvet Rose",
    bg: "radial-gradient(circle at top, #4a0e2e 0%, #240717 55%, #12030b 100%)",
    cardBg: "rgba(38, 9, 25, 0.84)",
    cardBorder: "rgba(251, 113, 133, 0.45)",
    textMain: "#ffe4e6",
    textSub: "#fda4af",
    boxBg: "rgba(76, 15, 48, 0.72)",
    boxBorder: "rgba(244, 114, 182, 0.32)",
    btnGrad: "linear-gradient(135deg, #e11d48, #ec4899)",
    badgeBg: "rgba(244, 114, 182, 0.18)",
    badgeColor: "#fbcfe8",
  },
  {
    name: "Sunset Love Aura",
    bg: "linear-gradient(135deg, #ff758c 0%, #ff7eb3 45%, #fad0c4 100%)",
    cardBg: "rgba(255, 250, 252, 0.82)",
    cardBorder: "rgba(255, 255, 255, 0.92)",
    textMain: "#701a45",
    textSub: "#9d174d",
    boxBg: "rgba(255, 228, 238, 0.92)",
    boxBorder: "rgba(251, 113, 133, 0.38)",
    btnGrad: "linear-gradient(135deg, #ec4899, #fb7185)",
    badgeBg: "rgba(236, 72, 153, 0.15)",
    badgeColor: "#be185d",
  },
];

function renderAvatarElement(dataUrl, label, sizeClass = "single") {
  const safeAlt = escapeHtml(label);
  const initial = escapeHtml((label || "♥").slice(0, 1).toUpperCase());
  if (dataUrl) {
    return `<img src="${dataUrl}" alt="${safeAlt}" class="avatar-img ${sizeClass}" />`;
  }
  return `<div class="avatar-fallback ${sizeClass}">${initial}</div>`;
}

function buildWishHtml({
  isCouple,
  femaleName,
  maleName,
  singleName,
  captionText,
  senderLabel,
  avatarA,
  avatarB,
}) {
  const theme = PREMIUM_THEMES[Math.floor(Math.random() * PREMIUM_THEMES.length)];
  const safeCaption = escapeHtml(captionText);
  const safeSender = escapeHtml(senderLabel);

  const safeFemale = escapeHtml(femaleName || "Her");
  const safeMale = escapeHtml(maleName || "Him");
  const safeSingle = escapeHtml(singleName || "Someone Special");

  const headingText = isCouple
    ? `${safeFemale} 💕 ${safeMale}`
    : `For ${safeSingle} 💕`;

  const subTitleBadge = isCouple
    ? "💗 Romantic Couple Wish & Love Note 💗"
    : "💗 Special Wish & Love Note 💗";

  const mediaSection = isCouple
    ? `
    <div class="couple-row">
      <div class="couple-person">
        <div class="avatar-wrap couple-ring">${renderAvatarElement(avatarA, safeFemale, "couple")}</div>
        <div class="person-tag">♀ ${safeFemale}</div>
      </div>
      <div class="heart-bridge">💖</div>
      <div class="couple-person">
        <div class="avatar-wrap couple-ring">${renderAvatarElement(avatarB, safeMale, "couple")}</div>
        <div class="person-tag">♂ ${safeMale}</div>
      </div>
    </div>`
    : `
    <div class="avatar-wrap single-ring">
      ${renderAvatarElement(avatarA, safeSingle, "single")}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${isCouple ? `${safeFemale} & ${safeMale}` : `For ${safeSingle}`} — Special Wish</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: ${theme.bg};
    color: ${theme.textMain};
    overflow-x: hidden;
    cursor: pointer;
  }
  .hearts-bg {
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }
  .floating-heart {
    position: absolute;
    bottom: -40px;
    font-size: 20px;
    opacity: 0.6;
    animation: rise linear infinite;
  }
  @keyframes rise {
    0% { transform: translateY(0) scale(0.9) rotate(0deg); opacity: 0; }
    15% { opacity: 0.7; }
    85% { opacity: 0.55; }
    100% { transform: translateY(-110vh) scale(1.25) rotate(24deg); opacity: 0; }
  }
  .tap-ripple {
    position: fixed;
    width: 24px;
    height: 24px;
    margin-left: -12px;
    margin-top: -12px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 18px rgba(244, 63, 94, 0.65);
    pointer-events: none;
    z-index: 20;
    animation: rippleWave 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  @keyframes rippleWave {
    0% { transform: scale(0.3); opacity: 1; }
    100% { transform: scale(5.2); opacity: 0; }
  }
  .tap-pop {
    position: fixed;
    pointer-events: none;
    z-index: 21;
    font-size: 24px;
    animation: tapPopAnim 1.15s ease-out forwards;
  }
  @keyframes tapPopAnim {
    0% { transform: translate(-50%, -50%) scale(0.4) rotate(0deg); opacity: 1; }
    60% { transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% - 45px)) scale(1.25) rotate(var(--rot, 12deg)); opacity: 1; }
    100% { transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% - 95px)) scale(0.85) rotate(var(--rot, -12deg)); opacity: 0; }
  }
  .card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 480px;
    background: ${theme.cardBg};
    backdrop-filter: blur(18px);
    border: 2px solid ${theme.cardBorder};
    border-radius: 30px;
    padding: 32px 24px 26px;
    text-align: center;
    box-shadow: 0 24px 64px rgba(90, 10, 46, 0.28);
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease;
  }
  .card.tap-bounce {
    transform: scale(1.025);
    box-shadow: 0 28px 72px rgba(219, 39, 119, 0.38);
  }
  .badge {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 999px;
    background: ${theme.badgeBg};
    color: ${theme.badgeColor};
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.8px;
    margin-bottom: 20px;
  }
  .avatar-wrap {
    margin: 0 auto 16px;
    border-radius: 50%;
    padding: 4px;
    background: linear-gradient(135deg, #ec4899, #fb7185, #fbcfe8);
    box-shadow: 0 12px 28px rgba(219, 39, 119, 0.3);
    transition: transform 0.3s ease;
  }
  .card.tap-bounce .avatar-wrap {
    transform: scale(1.06) rotate(2deg);
  }
  .single-ring {
    width: 128px;
    height: 128px;
  }
  .couple-ring {
    width: 108px;
    height: 108px;
    margin-bottom: 8px;
  }
  .avatar-img, .avatar-fallback {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .avatar-fallback {
    background: linear-gradient(135deg, #f43f5e, #ec4899);
    color: #fff;
    font-weight: 800;
  }
  .avatar-fallback.single { font-size: 46px; }
  .avatar-fallback.couple { font-size: 36px; }
  .couple-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .couple-person {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 145px;
  }
  .person-tag {
    font-size: 13px;
    font-weight: 700;
    color: ${theme.textSub};
    word-break: break-word;
  }
  .heart-bridge {
    font-size: 28px;
    animation: pulseHeart 1.4s infinite ease-in-out;
  }
  @keyframes pulseHeart {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.22); }
  }
  h1 {
    font-size: 26px;
    color: ${theme.textMain};
    margin-bottom: 10px;
    word-break: break-word;
  }
  .message-box {
    margin: 16px auto 22px;
    padding: 18px 16px;
    border-radius: 20px;
    background: ${theme.boxBg};
    border: 1px solid ${theme.boxBorder};
    font-size: 16px;
    line-height: 1.65;
    color: ${theme.textMain};
    white-space: pre-wrap;
    word-break: break-word;
  }
  .controls {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  button {
    border: none;
    outline: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 11px 18px;
    font-size: 14px;
    font-weight: 700;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  button:active { transform: scale(0.96); }
  .btn-music {
    background: ${theme.btnGrad};
    color: #fff;
    box-shadow: 0 8px 20px rgba(219, 39, 119, 0.32);
  }
  .btn-love {
    background: #fff;
    color: #be185d;
    border: 1.5px solid #f9a8d4;
  }
  .status-note {
    font-size: 12px;
    color: ${theme.textSub};
    min-height: 18px;
    margin-bottom: 10px;
  }
  .footer {
    font-size: 12px;
    color: ${theme.textSub};
    opacity: 0.92;
  }
  .dev-tag {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 700;
    color: ${theme.textMain};
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
  <div class="hearts-bg" id="heartsBg"></div>

  <main class="card" id="wishCard">
    <div class="badge">${subTitleBadge}</div>
    ${mediaSection}
    <h1>${headingText}</h1>
    <div class="message-box">${safeCaption}</div>

    <div class="controls">
      <button class="btn-music" id="musicBtn" type="button">🎵 Play Romantic Song</button>
      <button class="btn-love" id="heartBurstBtn" type="button">💖 Send Love</button>
    </div>
    <div class="status-note" id="musicStatus">Tap anywhere for heart &amp; sparkle animation ✨</div>
    <div class="footer">From ${safeSender}</div>
    <div class="dev-tag">✨ Developer: Fahim Bbz 💗</div>
  </main>

  <script>
    const heartsContainer = document.getElementById("heartsBg");
    const wishCard = document.getElementById("wishCard");
    const heartSymbols = ["💗", "💖", "💕", "💘", "🌸", "✨"];

    for (let i = 0; i < 18; i++) {
      const el = document.createElement("div");
      el.className = "floating-heart";
      el.textContent = heartSymbols[i % heartSymbols.length];
      el.style.left = Math.random() * 100 + "%";
      el.style.animationDuration = (6 + Math.random() * 6) + "s";
      el.style.animationDelay = (Math.random() * 5) + "s";
      el.style.fontSize = (18 + Math.random() * 16) + "px";
      heartsContainer.appendChild(el);
    }

    // Soft lyrical romantic melody sequence
    let audioCtx = null;
    let loopTimer = null;
    let isPlaying = false;
    const notes = [
      587.33, 659.25, 783.99, 880.00,
      783.99, 659.25, 587.33, 493.88,
      523.25, 659.25, 783.99, 987.77,
      880.00, 783.99, 659.25, 587.33
    ];
    let step = 0;

    function playTone(freq, duration = 0.46) {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.075, audioCtx.currentTime + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0008, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration + 0.02);
    }

    function startSong() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === "suspended") audioCtx.resume();
      if (isPlaying) return;

      isPlaying = true;
      document.getElementById("musicBtn").textContent = "⏸ Pause Song";
      document.getElementById("musicStatus").textContent = "🎶 Romantic melody playing...";
      playTone(notes[step % notes.length], 0.48);
      step++;

      loopTimer = setInterval(() => {
        playTone(notes[step % notes.length], 0.48);
        step++;
      }, 500);
    }

    function stopSong() {
      isPlaying = false;
      if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }
      document.getElementById("musicBtn").textContent = "🎵 Play Romantic Song";
      document.getElementById("musicStatus").textContent = "Song paused";
    }

    document.getElementById("musicBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (isPlaying) stopSong();
      else startSong();
    });

    function triggerTapAnimation(x, y) {
      const ripple = document.createElement("div");
      ripple.className = "tap-ripple";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 800);

      const burstChars = ["💗", "💖", "✨", "🌸", "💕"];
      for (let i = 0; i < 5; i++) {
        const pop = document.createElement("div");
        pop.className = "tap-pop";
        pop.textContent = burstChars[(i + Math.floor(Math.random() * burstChars.length)) % burstChars.length];
        pop.style.left = x + "px";
        pop.style.top = y + "px";
        pop.style.setProperty("--dx", ((Math.random() - 0.5) * 110).toFixed(0) + "px");
        pop.style.setProperty("--rot", ((Math.random() - 0.5) * 45).toFixed(0) + "deg");
        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1200);
      }

      wishCard.classList.remove("tap-bounce");
      void wishCard.offsetWidth;
      wishCard.classList.add("tap-bounce");
      setTimeout(() => wishCard.classList.remove("tap-bounce"), 320);

      if (!isPlaying) {
        try { startSong(); } catch {}
      }
    }

    document.addEventListener("pointerdown", (e) => {
      triggerTapAnimation(e.clientX, e.clientY);
    });

    document.getElementById("heartBurstBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = wishCard.getBoundingClientRect();
      triggerTapAnimation(rect.left + rect.width / 2, rect.top + rect.height * 0.45);
      document.getElementById("musicStatus").textContent = "💘 Sending lots of love!";
    });

    window.addEventListener("load", () => {
      setTimeout(() => {
        try { startSong(); } catch {}
      }, 250);
    });
  </script>
</body>
</html>`;
}

async function askForCaption(sock, chatId, targetLabel, quoteTarget) {
  return sock.sendMessage(
    chatId,
    {
      text:
        `📝 *For:* *${targetLabel}*\n\n` +
        `এখন কী বলতে চান তার একটি সুন্দর *Caption / Message* লিখে এই মেসেজে রিপ্লাই দিন।`,
    },
    quoteTarget ? { quoted: quoteTarget } : {},
  );
}

Module({
  command: "wish",
  aliases: ["propose", "lovewish", "makewish"],
  package: "fun",
  description: "Create a custom romantic wish/couple HTML document with names, photos, caption, tap animation, and music",
})(async (message) => {
  const sock = getSock(message);
  const chatId = getChatId(message);
  const quoted = getQuoteTarget(message);
  if (!sock || !chatId) return;

  const keys = await resolveSenderKeys(message, chatId);
  const primaryKey = keys[0] || `${chatId}:${message?.sender || "unknown"}`;
  const senderJid = toJid(message?.sender || message?.senderAlt || "");
  const mentioned = extractMentions(message, getMessageText(message));

  if (mentioned.length >= 2) {
    const partner1 = mentioned[0];
    const partner2 = mentioned[1];
    const [avatarA, avatarB] = await Promise.all([
      getAvatarDataUrl(sock, partner1),
      getAvatarDataUrl(sock, partner2),
    ]);

    const promptMsg = await sock.sendMessage(
      chatId,
      {
        text:
          `💑 *COUPLE WISH GENERATOR*\n\n` +
          `✨ *Mentioned:* @${cleanDigits(partner1)} & @${cleanDigits(partner2)}\n\n` +
          `প্রথমে *Partner (Female)*-এর নাম লিখে এই মেসেজে রিপ্লাই দিন।`,
        mentions: [partner1, partner2],
      },
      quoted ? { quoted } : {},
    );

    SESSIONS.set(primaryKey, {
      mode: "couple",
      step: "await_female_name",
      chatId,
      keys,
      senderJid,
      avatarA,
      avatarB,
      femaleName: "",
      maleName: "",
      singleName: "",
      awaitingMsgId: promptMsg?.key?.id || "",
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return;
  }

  const partnerJid = mentioned[0] || "";
  const avatarA = partnerJid ? await getAvatarDataUrl(sock, partnerJid) : "";

  const promptMsg = await sock.sendMessage(
    chatId,
    {
      text:
        `💌 *WISH & PROPOSAL GENERATOR*\n\n` +
        `আপনার *Partner*-এর নাম লিখে এই মেসেজে রিপ্লাই দিন।` +
        (partnerJid
          ? `\n✨ *Mentioned:* @${cleanDigits(partnerJid)} (Profile pic taken!)`
          : `\n📸 _মেনশন যেহেতু করেননি, নামের পরের ধাপে এই মেসেজের রিপ্লাই করে একটি ছবি দিতে পারবেন।_`),
      ...(partnerJid ? { mentions: [partnerJid] } : {}),
    },
    quoted ? { quoted } : {},
  );

  SESSIONS.set(primaryKey, {
    mode: "single",
    step: "await_name",
    chatId,
    keys,
    senderJid,
    partnerJid,
    avatarA,
    avatarB: "",
    femaleName: "",
    maleName: "",
    singleName: "",
    awaitingMsgId: promptMsg?.key?.id || "",
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
});

Module({
  on: "message",
  package: "fun",
  description: "Handle reply steps for .wish HTML document generator",
})(async (message) => {
  const sock = getSock(message);
  const chatId = getChatId(message);
  if (!sock || !chatId) return;

  const found = findActiveSession(message, chatId);
  if (!found) return;

  const msgId = message?.key?.id || "";
  if (msgId && msgId === found.session.awaitingMsgId) return;

  const text = getMessageText(message);
  if (text && /^[./!]/.test(text)) return;

  const { key: senderKey, session } = found;
  const quoteTarget = getQuoteTarget(message);

  if (session.mode === "couple" && session.step === "await_female_name") {
    if (!text) return;
    session.femaleName = text.slice(0, 80);
    session.step = "await_male_name";
    session.expiresAt = Date.now() + SESSION_TTL_MS;

    const malePrompt = await sock.sendMessage(
      chatId,
      {
        text:
          `👩 *Female Partner:* *${session.femaleName}*\n\n` +
          `এখন *Partner (Male)*-এর নাম লিখে এই মেসেজে রিপ্লাই দিন।`,
      },
      quoteTarget ? { quoted: quoteTarget } : {},
    );
    session.awaitingMsgId = malePrompt?.key?.id || "";
    SESSIONS.set(senderKey, session);
    return;
  }

  if (session.mode === "couple" && session.step === "await_male_name") {
    if (!text) return;
    session.maleName = text.slice(0, 80);
    session.step = "await_caption";
    session.expiresAt = Date.now() + SESSION_TTL_MS;

    const captionPrompt = await askForCaption(
      sock,
      chatId,
      `${session.femaleName} & ${session.maleName}`,
      quoteTarget,
    );
    session.awaitingMsgId = captionPrompt?.key?.id || "";
    SESSIONS.set(senderKey, session);
    return;
  }

  if (session.mode === "single" && session.step === "await_name") {
    if (!text) return;
    const partnerName = text.slice(0, 80);
    session.singleName = partnerName;
    session.expiresAt = Date.now() + SESSION_TTL_MS;

    if (!session.partnerJid) {
      session.step = "await_photo";
      const photoPrompt = await sock.sendMessage(
        chatId,
        {
          text:
            `📸 *${partnerName}*-এর জন্য একটি ছবি পাঠান!\n\n` +
            `এই মেসেজের *Reply* করে একটি সুন্দর ছবি দিন *(ছবি না দিলে \`skip\` লিখে রিপ্লাই দিন)*।`,
        },
        quoteTarget ? { quoted: quoteTarget } : {},
      );
      session.awaitingMsgId = photoPrompt?.key?.id || "";
      SESSIONS.set(senderKey, session);
      return;
    }

    session.step = "await_caption";
    const captionPrompt = await askForCaption(sock, chatId, partnerName, quoteTarget);
    session.awaitingMsgId = captionPrompt?.key?.id || "";
    SESSIONS.set(senderKey, session);
    return;
  }

  if (session.mode === "single" && session.step === "await_photo") {
    const lower = text.toLowerCase();
    if (lower !== "skip" && lower !== "no") {
      const imgUrl = await extractImageDataUrl(message);
      if (!imgUrl) {
        await sock.sendMessage(
          chatId,
          {
            text: `⚠️ ছবি পাওয়া যায়নি! দয়া করে এই মেসেজের *Reply* করে একটি ছবি পাঠান অথবা \`skip\` লিখুন।`,
          },
          quoteTarget ? { quoted: quoteTarget } : {},
        );
        return;
      }
      session.avatarA = imgUrl;
    }

    session.step = "await_caption";
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    const captionPrompt = await askForCaption(sock, chatId, session.singleName, quoteTarget);
    session.awaitingMsgId = captionPrompt?.key?.id || "";
    SESSIONS.set(senderKey, session);
    return;
  }

  if (session.step === "await_caption") {
    if (!text) return;
    SESSIONS.delete(senderKey);

    const captionText = text.slice(0, 1000);
    const senderDigits = cleanDigits(session.senderJid);
    const senderLabel = senderDigits ? `@${senderDigits}` : "Someone Special";
    const isCouple = session.mode === "couple";

    const htmlContent = buildWishHtml({
      isCouple,
      femaleName: session.femaleName,
      maleName: session.maleName,
      singleName: session.singleName,
      captionText,
      senderLabel,
      avatarA: session.avatarA,
      avatarB: session.avatarB,
    });

    const docBuffer = Buffer.from(htmlContent, "utf8");
    const slugBase = isCouple
      ? `${session.femaleName}-${session.maleName}`
      : session.singleName;
    const fileName = `wish-${sanitizeFilePart(slugBase)}.html`;
    const mentions = session.senderJid ? [session.senderJid] : [];

    await sock.sendMessage(
      chatId,
      {
        document: docBuffer,
        mimetype: "text/html",
        fileName,
        caption:
          `🎀 *আপনাদের Wish Ready!* 🎀\n\n` +
          `📄 _ডকুমেন্টটিতে ক্লিক করে আপনার পছন্দের_ *Browser* _দিয়ে ওপেন করে দেখে আসুন_ _এবং যাকে দিতে চান তাকে Forward করে দিন_🌚💗`,
        ...(mentions.length ? { mentions } : {}),
      },
      quoteTarget ? { quoted: quoteTarget } : {},
    );
  }
});
