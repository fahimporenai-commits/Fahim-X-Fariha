import { Module } from "../../lib/plugins.js";
import { db } from "../../lib/client.js";
import {
  addSudoNumber,
  getSudoNumbers,
  isSudo,
  removeSudoNumber,
  DEFAULT_MAIN_SUDOS,
} from "../../lib/sudo.js";

function normalizeTokens(input) {
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => String(item ?? "").trim().split(/\s+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  return [];
}

function cleanNumberInput(rawText) {
  return String(rawText || "")
    .replace(/[^0-9]/g, "")
    .trim();
}

function canManageSudo(message) {
  if (
    message?.isFromMe ||
    message?.isfromMe ||
    message?.key?.fromMe ||
    isSudo(message?.sender, message?.senderAlt, message?.participant, message?.from)
  ) {
    return true;
  }

  const botNum = String(message?.botnum || "").replace(/[^0-9]/g, "");
  const senderNum = String(message?.sender || "").replace(/[^0-9]/g, "");
  if (botNum && senderNum && botNum === senderNum) {
    return true;
  }

  return false;
}

function syncSudoDb(message, numbers) {
  try {
    if (typeof db?.setHot === "function" && Array.isArray(numbers)) {
      db.setHot(message?.botnum, "sudo:list", numbers);
    }
  } catch (_) {}
}

function loadCombinedSudos(message) {
  const fromLib = Array.isArray(getSudoNumbers?.()) ? getSudoNumbers() : [];
  let fromHot = [];
  try {
    const cached = db?.get?.(message?.botnum, "sudo:list", []);
    if (Array.isArray(cached)) fromHot = cached;
  } catch (_) {}

  const merged = [...new Set([...DEFAULT_MAIN_SUDOS || [], ...fromLib, ...fromHot])]
    .map((n) => cleanNumberInput(n))
    .filter(Boolean);

  return merged;
}

async function replyText(message, text) {
  if (typeof message?.send === "function") {
    return message.send(text);
  }
  const sock = message?.conn || message?.client || message?.sock;
  const chatId = message?.from || message?.key?.remoteJid;
  if (sock && typeof sock.sendMessage === "function" && chatId) {
    return sock.sendMessage(chatId, { text });
  }
}

Module({
  command: "sudo",
  aliases: ["sudonumber", "sudolist", "addsudo", "delsudo", "rmsudo"],
  package: "owner",
  description: "Manage bot sudo numbers",
})(async (message, rawArg) => {
  try {
    if (!canManageSudo(message)) {
      return replyText(
        message,
        "❌ Only configured sudo number can manage sudo numbers.",
      );
    }

    const prefix = message?.prefix || ".";
    const tokens = normalizeTokens(rawArg);
    const first = String(tokens[0] || "list").toLowerCase();

    // সরাসরি `.sudo 88017...` বা `.sudo +88017...` দিলে support
    let action = first;
    let numberText = cleanNumberInput(tokens.slice(1).join(""));

    if (!["list", "show", "add", "+", "remove", "del", "delete", "-", "help"].includes(first)) {
      const maybeNum = cleanNumberInput(tokens.join(""));
      if (maybeNum.length >= 8) {
        action = "add";
        numberText = maybeNum;
      }
    }

    if (action === "list" || action === "show") {
      const numbers = loadCombinedSudos(message);

      if (!numbers.length) {
        return replyText(
          message,
          `╭─〔 SUDO NUMBERS 〕\n` +
            `│ Empty\n` +
            `╰──────────────\n\n` +
            `Add: ${prefix}sudo add 8801XXXXXXXXX`,
        );
      }

      const list = numbers
        .map((number, index) => {
          const main = (DEFAULT_MAIN_SUDOS || []).includes(number)
            ? " (main)"
            : "";
          return `${index + 1}. ${number}${main}`;
        })
        .join("\n");

      return replyText(
        message,
        `╭─〔 SUDO NUMBERS 〕\n` +
          `${list}\n` +
          `╰──────────────\n\n` +
          `Add: ${prefix}sudo add 8801XXXXXXXXX`,
      );
    }

    if (action === "add" || action === "+") {
      if (!numberText || numberText.length < 8) {
        return replyText(
          message,
          "❌ Valid number দিন। Country code সহ লিখুন, + ছাড়া।\n\n" +
            `Example: ${prefix}sudo add 8801712345678`,
        );
      }

      const result = await addSudoNumber(numberText);

      if (!result?.ok) {
        return replyText(
          message,
          "❌ Valid number দিন। Country code সহ লিখুন, + ছাড়া।\n\n" +
            `Example: ${prefix}sudo add 8801712345678`,
        );
      }

      syncSudoDb(message, loadCombinedSudos(message));

      if (result.existed) {
        return replyText(
          message,
          `ℹ️ ${result.number} already sudo list-এ আছে।`,
        );
      }

      return replyText(
        message,
        `✅ Sudo number added:\n${result.number}`,
      );
    }

    if (
      action === "remove" ||
      action === "del" ||
      action === "delete" ||
      action === "-"
    ) {
      if (!numberText || numberText.length < 8) {
        return replyText(
          message,
          "❌ Valid number দিন।\n\n" +
            `Example: ${prefix}sudo remove 8801712345678`,
        );
      }

      const result = await removeSudoNumber(numberText);

      if (result?.protected) {
        return replyText(
          message,
          "❌ Main sudo numbers remove করা যাবে না।",
        );
      }

      if (!result?.number) {
        return replyText(
          message,
          "❌ Valid number দিন।\n\n" +
            `Example: ${prefix}sudo remove 8801712345678`,
        );
      }

      syncSudoDb(message, loadCombinedSudos(message));

      if (!result.existed) {
        return replyText(
          message,
          `ℹ️ ${result.number} sudo list-এ নেই।`,
        );
      }

      return replyText(
        message,
        `✅ Sudo number removed:\n${result.number}`,
      );
    }

    return replyText(
      message,
      "╭─〔 SUDO HELP 〕\n" +
        `│ ${prefix}sudo list\n` +
        `│ ${prefix}sudo add 8801712345678\n` +
        `│ ${prefix}sudo remove 8801712345678\n` +
        "╰──────────────",
    );
  } catch (err) {
    console.error("[sudo] command error:", err);
    return replyText(message, `❌ Sudo error: ${err?.message || err}`);
  }
});

export {
  isSudo,
};
