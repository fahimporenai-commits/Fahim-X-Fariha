import { Module } from "../../lib/plugins.js";

const INFO_IMAGE_URL = "https://i.postimg.cc/HLrXC065/IMG-20260425-111124.jpg";

const INFO_MESSAGE = `
☞𓋜𝐍ꫝ𝐦𝐞: —͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ𓂃 ࣪˖ ִֶָ
𓋜𝐀𝐠𝐞: 😒+✮⃝🖤
𓋜𝐂𝐥𝐚𝐬𝐬: 𝐇ɪᴅᴇ 𓂃 ࣪˖ ִֶָ✨🌊
𓋜𝐟𝐯𝐭 𝐢𝐦𝐨𝐣𝐢: 🎀🕊️💗 𓂃 ࣪˖ ִֶָ
𓋜𝐅𝐫𝐨𝐦: 𝐒ʏʟʜᴇᴛ𓂃 ࣪˖ ִֶָ📍
𓋜𝐑𝐞𝐥𝐢𝐠𝐢𝐨𝐧: 𝐈𝐬𝐥𝐚𝐦 𓂃 ࣪˖ ִֶ
╰═════════════╯
╭══──────══╮
  𓋜𝐑𝐥𝐬: 😅🥹𓂃
╰══──────══╯
\`\`\`
╭══──────══╮
   ʙᴏᴛ ᴏᴡɴᴇʀ 
  𝐅ꫝнιм ᗷᗷᘔ
╰══──────══╯
\`\`\``;

function getSocket(message) {
  return message?.client || message?.conn || message?.sock || null;
}

async function sendReaction(message, emoji) {
  const chatId = message?.from || message?.key?.remoteJid;
  const sock = getSocket(message);

  if (!message?.key) return;

  try {
    if (typeof message.send === "function") {
      await message.send({ react: { text: emoji, key: message.key } });
      return;
    }
    if (sock && typeof sock.sendMessage === "function" && chatId) {
      await sock.sendMessage(chatId, { react: { text: emoji, key: message.key } });
    }
  } catch (_) {}
}

async function sendInfoCard(message) {
  const chatId = message?.from || message?.key?.remoteJid;
  const sock = getSocket(message);
  const quoted = message?.raw || message;

  if (typeof message?.send === "function") {
    try {
      await message.send(
        {
          image: { url: INFO_IMAGE_URL },
          caption: INFO_MESSAGE,
        },
        { quoted }
      );
      return;
    } catch (_) {}
  }

  if (sock && typeof sock.sendMessage === "function" && chatId) {
    await sock.sendMessage(
      chatId,
      {
        image: { url: INFO_IMAGE_URL },
        caption: INFO_MESSAGE,
      },
      { quoted }
    );
  }
}

Module({
  command: "info",
  alias: ["about", "intro", "admininfo"],
  package: "Owner",
  description: "Show owner and bot info.",
})(async (message) => {
  try {
    await sendReaction(message, "📇");
    await sendInfoCard(message);
  } catch (error) {
    console.error("Info Command Error:", error);
    await message.send("❌ An error occurred while fetching info.", {
      quoted: message?.raw || message,
    });
  }
});
