import axios from "axios";
import { Module } from "../../lib/plugins.js";

const menuText = `====「 𝐕𝐈𝐃𝐄𝐎 𝐀𝐋𝐁𝐔𝐌 」====
━━━━━━━━━━━━━
𝟙. 𝐋𝐎𝐕𝐄 𝐕𝐈𝐃𝐄𝐎 💞
𝟚. 𝐂𝐎𝐔𝐏𝐋𝐄 𝐕𝐈𝐃𝐄𝐎 💕
𝟛. 𝐒𝐇𝐎𝐑𝐓 𝐕𝐈𝐃𝐄𝐎 📽
𝟜. 𝐒𝐀𝐃 𝐕𝐈𝐃𝐄𝐎 😔
𝟝. 𝐒𝐓𝐀𝐓𝐔𝐒 𝐕𝐈𝐃𝐄𝐎 📝
𝟞. 𝐒𝐇𝐀𝐈𝐑𝐈
𝟟. 𝐁𝐀𝐁𝐘 𝐕𝐈𝐃𝐄𝐎 😻
𝟠. 𝐀𝐍𝐈𝐌𝐄 𝐕𝐈𝐃𝐄𝐎
𝟡. 𝐇𝐔𝐌𝐀𝐈𝐘𝐔𝐍 𝐅𝐎𝐑𝐈𝐃 𝐒𝐈𝐑 ❄
𝟙𝟘. 𝐈𝐒𝐋𝐀𝐌𝐈𝐊 𝐕𝐈𝐃𝐄𝐎 🤲

===「 𝟏𝟖+ 𝐕𝐈𝐃𝐄𝐎 」===
━━━━━━━━━━━━━
𝟙𝟙. 𝐇𝐎𝐑𝐍𝐘 𝐕𝐈𝐃𝐄𝐎 🥵
𝟙𝟚. 𝐇𝐎𝐓 🔞
𝟙𝟛. 𝐈𝐓𝐄𝐌

👉 Reply to this message with a category number (1-13).`;

const paths = {
  1: "/video/love", 2: "/video/cpl", 3: "/video/shortvideo",
  4: "/video/sadvideo", 5: "/video/status", 6: "/video/shairi",
  7: "/video/baby", 8: "/video/anime", 9: "/video/humaiyun",
  10: "/video/islam", 11: "/video/horny", 12: "/video/hot", 13: "/video/item",
};
const pendingMenus = new Map();

async function deliver(message, choice) {
  const n = Number.parseInt(String(choice).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 13) {
    return message.send?.("⚠️ Invalid choice! Please reply with a number between 1 and 13.");
  }
  try {
    const conn = message.conn;
    if (typeof conn?.sendMessage === "function") {
      await conn.sendMessage(message.from, { react: { text: "📥", key: message.key } });
    }
    const api = await axios.get("https://raw.githubusercontent.com/MOHAMMAD-NAYAN-OFFICIAL/Nayan/main/api.json", { timeout: 15000 });
    const baseUrl = String(api.data?.api || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("Video API endpoint unavailable");
    const res = await axios.get(`${baseUrl}${paths[n]}`, { timeout: 30000 });
    const videoUrl = res.data?.data;
    if (!videoUrl) return message.send?.("❌ Could not fetch video link!");
    const caption = `🎬 *Category:* ${res.data.nayan || "Video Album"}\n📊 *Total Videos:* ${res.data.count || 0}\n\n𝘍ᴀʜɪᴍ-𝘝ɪᴅᴇᴏ-ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟ\n—͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ᭡`;
    if (typeof conn?.sendMessage === "function") {
      await conn.sendMessage(message.from, { video: { url: videoUrl }, caption, mimetype: "video/mp4" }, { quoted: message.gift });
      await conn.sendMessage(message.from, { react: { text: "✅", key: message.key } });
    } else {
      await message.send?.({ video: { url: videoUrl }, caption, mimetype: "video/mp4" });
    }
  } catch (error) {
    console.error("Video2 fetch/send error:", error?.message || error);
    await message.send?.("❌ Failed to download or send video. Try again later!");
  }
}

Module({
  command: "video2",
  aliases: ["v2"],
  package: "media",
  description: "Show a category menu or fetch a random category video",
})(async (message, args = "") => {
  const choice = String(args).trim();
  if (/^\d{1,2}$/.test(choice)) return deliver(message, choice);
  try {
    const sent = await message.send?.(menuText);
    const id = sent?.key?.id || sent?.id;
    if (id && message.from) pendingMenus.set(`${message.from}:${id}`, Date.now() + 10 * 60_000);
  } catch (error) {
    console.error("Video2 menu error:", error?.message || error);
    await message.send?.("❌ Failed to open video menu!");
  }
});

// The legacy bot provided a reply callback. Hatsune has no reply-handler API,
// so recognize replies to recently sent menus in a regular message plugin.
Module({ on: "message", package: "media", description: "Handle replies to the video category menu" })(async (message) => {
  const body = String(message?.body || "").trim();
  if (!/^(?:[1-9]|1[0-3])$/.test(body)) return;
  const quotedId = message?.quoted?.key?.id || message?.quoted?.id || message?.quoted?.stanzaId || message?.contextInfo?.stanzaId || message?.key?.quoted?.id;
  if (!quotedId || !message.from) return;
  const key = `${message.from}:${quotedId}`;
  const expires = pendingMenus.get(key);
  if (!expires) return;
  pendingMenus.delete(key);
  if (expires < Date.now()) return;
  await deliver(message, body);
});
