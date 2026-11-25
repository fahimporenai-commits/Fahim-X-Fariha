import { Module } from "../../lib/plugins.js";

function getTargetJids(message) {
  // Mention করা user
  if (
    Array.isArray(message?.mentions) &&
    message.mentions.length > 0
  ) {
    return message.mentions.filter(Boolean);
  }

  // Reply করা user
  const quoted = message?.quoted;

  const quotedJid =
    quoted?.participant ||
    quoted?.sender ||
    quoted?.key?.participant;

  if (quotedJid) {
    return [quotedJid];
  }

  // নিজের profile picture
  return message?.sender
    ? [message.sender]
    : [];
}

async function resolveJid(message, jid) {
  if (
    jid &&
    jid.endsWith("@lid") &&
    typeof message?.conn?.getJidFromLid === "function"
  ) {
    try {
      const resolved =
        await message.conn.getJidFromLid(jid);

      if (resolved) {
        return resolved;
      }
    } catch {
      // Original JID ব্যবহার করা হবে
    }
  }

  return jid;
}

function getNumber(jid) {
  return String(jid || "")
    .split("@")[0]
    .split(":")[0];
}

Module({
  command: "profilepic",

  aliases: [
    "pp",
    "avatar",
    "fa",
  ],

  package: "tools",

  description:
    "Get profile picture of yourself or another user",
})(async (message) => {
  try {
    const targets = getTargetJids(message);

    if (!targets.length) {
      return message.send(
        "❌ User পাওয়া যায়নি। কাউকে mention করুন অথবা তার message reply করে command দিন।",
      );
    }

    await message.react?.("🖼️");

    for (const originalJid of targets) {
      const jid = await resolveJid(
        message,
        originalJid,
      );

      const number = getNumber(jid);

      try {
        const profileUrl =
          await message.profilePictureUrl(
            jid,
            "image",
          );

        if (!profileUrl) {
          throw new Error(
            "Profile picture not found",
          );
        }

        const isSelf =
          jid === message.sender ||
          number === getNumber(message.sender);

        await message.send({
          image: {
            url: profileUrl,
          },

          caption: isSelf
            ? "🖼️ Here is your profile picture!"
            : `🖼️ Profile picture of @${number}`,

          mentions: [jid],
        });
      } catch (error) {
        console.error(
          "[profilepic] error:",
          error?.message || error,
        );

        await message.send({
          text:
            `❌ @${number} এর profile picture পাওয়া যাচ্ছে না।\n` +
            "সম্ভবত profile picture private অথবা সেট করা নেই।",

          mentions: [jid],
        });
      }
    }

    await message.react?.("✅");
  } catch (error) {
    console.error(
      "[profilepic] command error:",
      error,
    );

    await message.react?.("❌");

    await message.send(
      "❌ Profile picture load করতে সমস্যা হয়েছে।",
    );
  }
});
