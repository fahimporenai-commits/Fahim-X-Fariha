import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys";
import { getTheme } from "../../Themes/themes.js";

const theme = getTheme();
const DEFAULT_LANG = "bn";
const PREFIX = ".";

function toBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return Boolean(v);
}

function safeJid(jid) {
  try {
    return jid ? jidNormalizedUser(jid) : "";
  } catch {
    return "";
  }
}

function getBotNumber(conn) {
  const jid = safeJid(conn?.user?.id);
  return jid ? jid.split("@")[0] : "bot";
}

function buildDetailsText(feature, cfg, prefix = PREFIX) {
  const label = feature === "welcome" ? "Welcome" : "Goodbye";
  const status = cfg && typeof cfg === "object" ? toBool(cfg.status) : false;
  const lang =
    cfg && typeof cfg === "object" && cfg.lang ? cfg.lang : DEFAULT_LANG;

  return `╭─〔 *${label} Settings* 〕
├─ 📊 *Status:* ${status ? "✅ ON" : "❌ OFF"}
├─ 🌐 *Language:* ${lang.toUpperCase()}
╰─➤

*📝 HOW TO USE:*
> \`${prefix}${feature}\`         *- Show this panel (also turns ON)*
> \`${prefix}${feature} on\`      *- Turn ON*
> \`${prefix}${feature} off\`     *- Turn OFF*
> \`${prefix}${feature} bn\`      *- Set language to Bengali*
> \`${prefix}${feature} en\`      *- Set language to English*
> \`${prefix}${feature} status\`  *- Show current status only (no change)*

*💡 INFO*
> ℹ️ Language & ON/OFF are independent — changing one keeps the other as-is.
> ​ㅤ
> ℹ️ Default language if never set: *${DEFAULT_LANG.toUpperCase()}*
>`;
}

function registerFeatureCommand(feature) {
  Module({
    command: feature,
    package: "group",
    description: `Turn per-group ${feature} ON/OFF, or set language: .${feature} on|off|bn|en (bare command turns ON + shows details)`,
  })(async (message, match) => {
    if (!message.isGroup) return message.send(theme.isGroup);

    await message.loadGroupInfo?.();
    if (!message.isAdmin && !message.isfromMe) {
      return message.send(theme.isAdmin);
    }

    const groupJid = message.from;
    const raw = (match || "").trim().toLowerCase();
    const botNumber = message.botnum;
    const key = `group:${groupJid}:${feature}`;

    if (!raw) {
      const existing = await db.getAsync(botNumber, key, null);
      const lang =
        existing && typeof existing === "object" && existing.lang
          ? existing.lang
          : DEFAULT_LANG;
      const cfg = { status: true, lang };

      await db.set(botNumber, key, cfg);
      await message.react?.("✅");
      return await message.send(buildDetailsText(feature, cfg));
    }

    if (raw === "on" || raw === "off") {
      const existing = await db.getAsync(botNumber, key, null);
      const lang =
        existing && typeof existing === "object" && existing.lang
          ? existing.lang
          : DEFAULT_LANG;
      const cfg = { status: raw === "on", lang };

      await db.set(botNumber, key, cfg);
      await message.react?.("✅");

      return await message.send(
        cfg.status
          ? `✅ ${feature === "welcome" ? "Welcome" : "Goodbye"} ENABLED for this group (lang: ${lang.toUpperCase()})`
          : `❌ ${feature === "welcome" ? "Welcome" : "Goodbye"} DISABLED for this group`
      );
    }

    if (raw === "bn" || raw === "en") {
      const existing = await db.getAsync(botNumber, key, null);
      const status =
        existing && typeof existing === "object"
          ? toBool(existing.status)
          : false;

      await db.set(botNumber, key, { status, lang: raw });
      await message.react?.("✅");

      return await message.send(
        `🌐 ${feature === "welcome" ? "Welcome" : "Goodbye"} language set to ${raw.toUpperCase()}`
      );
    }

    if (raw === "status") {
      const cfg = await db.getAsync(botNumber, key, null);
      const status =
        cfg && typeof cfg === "object" ? toBool(cfg.status) : false;
      const lang =
        cfg && typeof cfg === "object" && cfg.lang ? cfg.lang : DEFAULT_LANG;

      return await message.sendreply?.(
        `${feature === "welcome" ? "Welcome" : "Goodbye"} is ${status ? "✅ ON" : "❌ OFF"} for this group.\nLanguage: ${lang.toUpperCase()}`
      );
    }

    return await message.send?.(
      "❌ Invalid option. Use `on`, `off`, `bn`, `en`, or `status`."
    );
  });
}

registerFeatureCommand("welcome");
registerFeatureCommand("goodbye");

const fahimWelcomeLines = [
  "🌸 নতুন অতিথি এসেছে, গ্রুপের হাওয়া বদলে গেলো!",
  "✨ তোমায় পেয়ে আমাদের পরিবার আরও রঙিন!",
  "💙 হাসিমুখে থেকো, গ্রুপ জমিয়ে রাখবে আশা করি!",
  "🌺 নতুন রাজা এসে গেছে আমাদের গ্রুপে!",
  "🔥 চল আজকে একটু ভিন্নরকম মজা হোক!",
  "🎉 গ্রুপে ঢুকেই তোমার এন্ট্রি স্টাইলিশ!",
  "🌼 আশা করি তুমি দারুণ অ্যাক্টিভ থাকবে!",
  "😎 এসে যাও, এখন শুরু হোক আড্ডার রাজত্ব!",
  "💫 তোমার কারণে গ্রুপের মান আরও আপ!",
  "😂 গ্রুপের টেনশন এখন তোমার হাতে!",
  "🌟 তোমায় ছাড়া গ্রুপটা যেন অসম্পূর্ণ ছিলো!",
  "🌷 তোমাকে দেখে গ্রুপের ভাইব আপ হয়ে গেলো!",
  "🔥 মনে হচ্ছে আজ গ্রুপে ঝড় আসছে!",
  "🐥 গ্রুপে এক ফ্রেশ ভাইব ঢুকে গেছে!",
  "💖 সবাইকে চমক দিতে তুমি এসেছো!",
  "😄 গ্রুপে নতুন হাসির ঝিলিক!",
  "🌈 আজ গ্রুপটা ফ্রেশ কারণ তুমি এসেছো!",
  "⚡ তোমার এন্ট্রি = পুরো গ্রুপ চার্জড!",
  "🎭 এখন থেকে গ্রুপে শুরু হবে আসল মজা!",
  "💥 সাবধান! নতুন মেম্বার = নতুন ঝগড়া ও হাসি!",
  "😂 ভাবছো শুধু এড হয়েছো? না! এখন তুমি পরিবারের অংশ!",
  "🔮 মনে হচ্ছে তুমি গ্রুপের হিডেন লিজেন্ড!",
  "😻 তোমার এন্ট্রি গ্রুপে কিউট ভাইব এনেছে!",
  "🔥 গ্রুপে তোমার মতো একজনকেই দরকার ছিলো!",
];

const fahimGoodbyeLines = [
  "⎯͢✧ পার্টি দেওয়ার ভয়ে @name পালিয়ে গেলো 😹",
  "⎯͢✧ গ্রুপের ড্রামা দেখে @name সাইলেন্ট লিভ দিলো 😂",
  "⎯͢✧ আজকের ভিকটিম @name — উধাও হয়ে গেলো 🤣",
  "⎯͢✧ @name মনে হয় WiFi অফ করে পালিয়েছে 😆",
  "⎯͢✧ মেসেজের ভয় পেয়ে @name দৌড় দিয়েছে 😹",
  "⎯͢✧ গ্রুপের পাগলামি সহ্য করতে না পেরে @name চলে গেলো 😂",
  "⎯͢✧ কেউ পার্টি বললেই @name হারিয়ে যায় 🤣",
  "⎯͢✧ @name বললো “আমি ব্যস্ত” তারপর অফলাইন 😹",
  "⎯͢✧ গ্রুপে ঢুকেই বুঝলো ভুল জায়গা—@name লিভ 😂",
  "⎯͢✧ অতিরিক্ত হাসি সহ্য না করে @name পালালো 🤣",
  "⎯͢✧ @name শেষ পর্যন্ত টিকতে পারলো না 😹",
  "⎯͢✧ গ্রুপের নোটিফিকেশন দেখে @name ভয়ে পালালো 😂",
  "⎯͢✧ কেউ ‘hi’ বলতেই @name উধাও 🤣",
  "⎯͢✧ @name বললো “bye” না বলেই bye দিলো 😹",
  "⎯͢✧ গ্রুপের এনার্জি সহ্য না করে @name লিভ 😂",
  "⎯͢✧ @name আর এই পাগল গ্রুপ সহ্য করতে পারলো না 🤣",
  "⎯͢✧ মেসেজ দেখে @name স্ট্রেস নিয়ে বের হয়ে গেলো 😹",
  "⎯͢✧ গ্রুপে ঢুকেই বুঝলো—এখানে টিকে থাকা কঠিন @name 😂",
];

Module({ on: "group-participants.update" })(async (_msg, event, conn) => {
  try {
    if (!event?.id || !event.action || !Array.isArray(event.participants)) {
      return;
    }

    const groupJid = event.id;
    const groupName = event.groupName || event.groupMetadata?.subject || "";
    const groupSize =
      typeof event.groupSize === "number"
        ? event.groupSize
        : event.groupMetadata?.participants?.length || 0;
    const botNumber = getBotNumber(conn);
    const action = String(event.action).toLowerCase();
    const botJidFull = safeJid(conn?.user?.id);
    const isWelcome = ["add", "invite", "joined"].includes(action);
    const isGoodbye = ["remove", "leave", "left", "kicked"].includes(action);

    const [welcomeConfig, goodbyeConfig] = await Promise.all([
      isWelcome
        ? db.getAsync(botNumber, `group:${groupJid}:welcome`, null)
        : null,
      isGoodbye
        ? db.getAsync(botNumber, `group:${groupJid}:goodbye`, null)
        : null,
    ]);

    for (const p of event.participants) {
      const participantJid = safeJid(
        typeof p === "string" ? p : p?.id || p?.jid || ""
      );

      if (!participantJid || (botJidFull && participantJid === botJidFull)) {
        continue;
      }

      const username = `@${participantJid.split("@")[0]}`;

      if (
        isWelcome &&
        welcomeConfig &&
        typeof welcomeConfig === "object" &&
        toBool(welcomeConfig.status)
      ) {
        let profilePicUrl = null;

        try {
          profilePicUrl = await conn.profilePictureUrl(
            participantJid,
            "image"
          );
        } catch {
          // Profile picture unavailable.
        }

        const line =
          fahimWelcomeLines[
            Math.floor(Math.random() * fahimWelcomeLines.length)
          ];

        const welcomeMessage = `🦢 *⎯͢✧ 𝐇ᴇʏ ${username}, ⎯͢✧ আমাদের গ্রুপ ${groupName}-এ তোমাকে স্বাগতম!* ✨\n\n💗 *⎯͢✧ ${line}* 🎧...\n\n🏠 *⎯͢✧ মোট সদস্য:* ${groupSize}\n\n🌟 *⎯͢✧ নিয়ম:* অ্যাক্টিভ থাকো, সবাইকে রেসপেক্ট দাও ও মজা করো!\n\n⎯͢✧🤖 𝐁𝐨𝐭 𝐎𝐰𝐧𝐞𝐫 ⎯͢✧🐱\n\n⎯͢✧🌷 > *ᥫ᭡⃝—͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ᭡..࿐🌼⃠*`;

        if (profilePicUrl) {
          try {
            await conn.sendMessage(groupJid, {
              image: { url: profilePicUrl },
              caption: welcomeMessage,
              mentions: [participantJid],
            });
          } catch {
            await conn.sendMessage(groupJid, {
              text: welcomeMessage,
              mentions: [participantJid],
            });
          }
        } else {
          await conn.sendMessage(groupJid, {
            text: welcomeMessage,
            mentions: [participantJid],
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));

        const introMessage = `╭══──────══╮\n   𝘎𝘪𝘷𝘦 𝘠𝘰𝘶𝘳 𝘐𝘯𝘵𝘳ο \n   ${username}\n${groupName}\n╰══──────══╯\n\n╭══──────══╮\n ☞𓋜𝐍ꫝ𝐦𝐞: 𓂃 ࣪˖ ִֶָ\n𓋜𝐀𝐠𝐞: ✮⃝🖤\n𓋜𝐂𝐥𝐚𝐬𝐬: 𓂃 ࣪˖ ִֶָ✨\n𓋜𝐟𝐯𝐭 𝐢𝐦𝐨𝐣𝐢: 𓂃 ࣪˖ ִֶָ\n𓋜𝐅𝐫𝐨𝐦: 𓂃 ࣪˖ ִֶָ📍\n𓋜𝐑𝐞𝐥𝐢𝐠𝐢𝐨𝐧:  𓂃 ࣪˖ ִֶ\n╰═════════════\n╭══──────══╮\n𝐓ʜɴᴋ ʏᴏᴜ ꜰᴏʀ ɪɴᴛʀᴏ..\n> *ᥫ᭡⃝—͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ᭡\n╰══──────══╯`;

        try {
          await conn.sendMessage(groupJid, {
            text: introMessage,
            mentions: [participantJid],
          });
        } catch (introError) {
          console.error(
            "[welcome-goodbye] intro send error:",
            introError?.message || introError
          );
        }
      }

      if (
        isGoodbye &&
        goodbyeConfig &&
        typeof goodbyeConfig === "object" &&
        toBool(goodbyeConfig.status)
      ) {
        const line =
          fahimGoodbyeLines[
            Math.floor(Math.random() * fahimGoodbyeLines.length)
          ].replace("@name", username);

        await conn.sendMessage(groupJid, {
          text: `${line}\n\n> *ᥫ᭡⃝—͞𝐅𝐚𝐡𝐢𝐦 𝐁𝐛𝐳ᥫ᭡..࿐🌼⃠*`,
          mentions: [participantJid],
        });
      }

      // Preserve Hatsune's unrelated promote/demote group-event notices.
      if (action === "promote" || action === "demote") {
        const owner = botJidFull || null;
        const ownerMention = owner
          ? `@${owner.split("@")[0]}`
          : conn.user?.id
            ? `@${String(conn.user.id).split(":")[0]}`
            : "Owner";
        const actor = event.actor || event.author || event.by || null;
        const actorText = actor ? `@${actor.split("@")[0]}` : "Admin";
        const targetText = `@${participantJid.split("@")[0]}`;
        const actionText = action === "promote" ? "promoted" : "demoted";
        const sendText = `╭─〔 *🎉 Admin Event* 〕\n├─ ${actorText} has ${actionText} ${targetText}\n├─ Group: ${groupName}\n╰─➤`;

        try {
          const mentions = [actor, participantJid, botJidFull, ownerMention].filter(
            Boolean
          );

          await conn.sendMessage(groupJid, {
            text: sendText,
            mentions,
          });
        } catch (e) {
          console.error(
            "[welcome-goodbye] promote/demote send error:",
            e?.message || e
          );

          try {
            await conn.sendMessage(groupJid, { text: sendText });
          } catch {
            // Ignore fallback failure.
          }
        }
      }
    }
  } catch (err) {
    console.error("[welcome-goodbye] event handler error:", err?.message || err);
  }
});
