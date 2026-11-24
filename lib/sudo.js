import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// এখানে যত খুশি নাম্বার যোগ করতে পারবেন — সবগুলো সমান Full Owner Access পাবে
const DEFAULT_MAIN_SUDOS = [
  "8801300285514",
  "8801719298647",
  "8801614753663",
];

const DEFAULT_MAIN_SUDO = DEFAULT_MAIN_SUDOS[0];

const SUDO_FILE =
  process.env.SUDO_FILE ||
  path.join(__dirname, "..", "data", "sudo-numbers.json");

function normalizeNumber(value) {
  if (value == null) return "";

  if (typeof value === "object") {
    return normalizeNumber(
      value.senderAlt ||
        value.participantAlt ||
        value.sender ||
        value.participant ||
        value.id ||
        value.jid ||
        "",
    );
  }

  let number = String(value).trim();

  // @lid হলে সরাসরি ফোন নাম্বার নয়, তাই আলাদা রাখা
  if (number.endsWith("@lid")) {
    return "";
  }

  if (number.includes("@")) {
    number = number.split("@")[0];
  }

  if (number.includes(":")) {
    number = number.split(":")[0];
  }

  number = number.replace(/\D/g, "");

  if (number.startsWith("00")) {
    number = number.slice(2);
  }

  // বাংলাদেশি লোকাল নাম্বার (01XXXXXXXXX -> 8801XXXXXXXXX) অটো কনভার্ট
  if (number.length === 11 && number.startsWith("01")) {
    number = `88${number}`;
  }

  return number;
}

function configuredMainNumbers() {
  const values = process.env.MAIN_SUDO_NUMBERS
    ? process.env.MAIN_SUDO_NUMBERS.split(",")
    : DEFAULT_MAIN_SUDOS;

  return new Set(values.map(normalizeNumber).filter(Boolean));
}

function readNumbers() {
  let values = [];

  try {
    if (fs.existsSync(SUDO_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUDO_FILE, "utf8"));
      values = Array.isArray(parsed) ? parsed : parsed?.numbers;
    }
  } catch (error) {
    console.error("[sudo] Could not read sudo-numbers.json:", error.message);
  }

  const numbers = new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeNumber)
      .filter(Boolean),
  );

  for (const number of configuredMainNumbers()) {
    numbers.add(number);
  }

  return numbers;
}

let sudoNumbers = readNumbers();

function saveNumbers() {
  try {
    fs.mkdirSync(path.dirname(SUDO_FILE), {
      recursive: true,
    });

    const temporaryFile = `${SUDO_FILE}.tmp`;

    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify([...sudoNumbers].sort(), null, 2)}\n`,
    );

    fs.renameSync(temporaryFile, SUDO_FILE);
  } catch (error) {
    console.error("[sudo] Could not save sudo-numbers.json:", error.message);
  }
}

if (!fs.existsSync(SUDO_FILE)) {
  saveNumbers();
}

export function reloadSudoNumbers() {
  sudoNumbers = readNumbers();
  return [...sudoNumbers];
}

export function getSudoNumbers() {
  for (const num of configuredMainNumbers()) {
    sudoNumbers.add(num);
  }
  return [...sudoNumbers];
}

function extractCandidateIdentities(input) {
  if (!input) return [];

  if (typeof input === "object" && !Array.isArray(input)) {
    return [
      input.sender,
      input.senderAlt,
      input.participant,
      input.participantAlt,
      input.from,
      input.key?.participant,
      input.key?.participantAlt,
      input.key?.remoteJid,
      input.key?.remoteJidAlt,
      input.raw?.key?.participant,
      input.raw?.key?.participantAlt,
      input.jid,
      input.id,
    ].filter(Boolean);
  }

  return [input];
}

export function isSudo(...identities) {
  const candidates = identities
    .flat(Infinity)
    .flatMap(extractCandidateIdentities)
    .filter(Boolean);

  return candidates.some((identity) => {
    const number = normalizeNumber(identity);
    return Boolean(number && sudoNumbers.has(number));
  });
}

// Owner চেকের জন্য alias (যাতে isOwner বা isSudo দুটোই সব নাম্বারকে চেনে)
export function isOwner(...identities) {
  return isSudo(...identities);
}

// মেসেজ অবজেক্টে ফুল ওনার/সুডো পারমিশন বসিয়ে দেওয়ার হেল্পার
export function applySudoPermissions(message) {
  if (!message || typeof message !== "object") return false;

  const matched =
    Boolean(message.isFromMe || message.isfromMe || message.key?.fromMe) ||
    isSudo(message);

  if (matched) {
    message.isSudo = true;
    message.isOwner = true;
    message.isCreator = true;
    message.isFromMe = true;
    message.isfromMe = true;
  }

  return matched;
}

export function addSudoNumber(value) {
  const number = normalizeNumber(value);

  if (!number || number.length < 8) {
    return {
      ok: false,
      number,
    };
  }

  const existed = sudoNumbers.has(number);

  sudoNumbers.add(number);
  saveNumbers();

  return {
    ok: true,
    number,
    existed,
  };
}

export function removeSudoNumber(value) {
  const number = normalizeNumber(value);

  if (!number || configuredMainNumbers().has(number)) {
    return {
      ok: false,
      number,
      protected: true,
    };
  }

  const existed = sudoNumbers.delete(number);

  if (existed) {
    saveNumbers();
  }

  return {
    ok: true,
    number,
    existed,
  };
}

export {
  normalizeNumber,
  SUDO_FILE,
  DEFAULT_MAIN_SUDO,
  DEFAULT_MAIN_SUDOS,
};
