import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Module } from "../../lib/plugins.js";

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "topmembers-counts.json");
let pendingWrite = Promise.resolve();

async function loadCounts() {
  try {
    const value = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function incrementCount(groupId, userId) {
  // Serialize read-modify-write operations to avoid losing nearby message updates.
  const operation = pendingWrite.then(async () => {
    const counts = await loadCounts();
    const group = counts[groupId] && typeof counts[groupId] === "object" ? counts[groupId] : {};
    const current = Number(group[userId]);
    group[userId] = (Number.isFinite(current) && current > 0 ? current : 0) + 1;
    counts[groupId] = group;
    await fs.writeFile(DATA_FILE, JSON.stringify(counts, null, 2), "utf8");
  });
  pendingWrite = operation.catch((error) => {
    console.error("TopMembers counter error:", error?.message || error);
  });
  return operation;
}

Module({
  command: "topmembers",
  aliases: ["top", "leaderboard"],
  package: "utility",
  description: "Shows group members ranked by recorded message count.",
})(async (message, args = "") => {
  const chatId = message?.from || message?.chat;
  if (!message?.isGroup) {
    return message?.send?.("⚠️ এই কমান্ডটি শুধুমাত্র গ্রুপে ব্যবহার করা যাবে!");
  }

  const requested = Number.parseInt(String(args).trim().split(/\s+/, 1)[0], 10);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 5;
  const counts = await loadCounts();
  const groupCounts = counts[chatId] && typeof counts[chatId] === "object" ? counts[chatId] : {};
  const sorted = Object.entries(groupCounts)
    .filter(([jid, count]) => typeof jid === "string" && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit);

  if (sorted.length === 0) {
    return message?.send?.("⚠️ এখনো কোনো মেসেজ রেকর্ড করা হয়নি!");
  }

  let response = `🏆 *TOP ${sorted.length} ACTIVE MEMBERS*\n\n`;
  sorted.forEach(([userId, count], index) => {
    response += `*${index + 1}.* @${userId.split("@")[0]} ━ 💬 *${Number(count)}* msgs\n`;
  });
  response += "\n> *ᥫ᭡⃝—͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ᭡࿐*";
  return message?.send?.(response, { mentions: sorted.map(([userId]) => userId) });
});

Module({
  on: "message",
  package: "utility",
  description: "Records incoming group messages for the topmembers leaderboard.",
})(async (message) => {
  try {
    const groupId = message?.from || message?.chat;
    const userId = message?.sender;
    if (!message?.isGroup || typeof groupId !== "string" || !groupId || typeof userId !== "string" || !userId) return;
    await incrementCount(groupId, userId);
  } catch (error) {
    console.error("TopMembers counter error:", error?.message || error);
  }
});
