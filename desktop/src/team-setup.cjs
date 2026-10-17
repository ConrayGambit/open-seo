// Team setup files: one person exports their API keys, locked with a password,
// and staff import the file on their own PC instead of pasting each key.
// AES-256-GCM with a scrypt-derived key; the file holds no plain secrets.
const crypto = require("node:crypto");

const FORMAT = "openseo-team-setup";
const MIN_PASSWORD_LENGTH = 8;

// Shared account keys only. Each install generates its own internal secrets.
const TEAM_KEYS = [
  "DATAFORSEO_API_KEY",
  "OPENROUTER_API_KEY",
  "CONTEXT_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function sealTeamSetup(settings, password) {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  const values = { samModel: settings.samModel };
  for (const key of TEAM_KEYS) if (settings[key]) values[key] = settings[key];
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveKey(password, salt),
    iv,
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

// Returns only known keys, so a crafted file can't set anything else.
function openTeamSetup(fileText, password) {
  let file;
  try {
    file = JSON.parse(fileText);
  } catch {
    file = null;
  }
  if (file?.format !== FORMAT || file.version !== 1)
    throw new Error("That isn't an OpenSEO team setup file.");
  let values;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveKey(password, Buffer.from(file.salt, "base64")),
      Buffer.from(file.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    values = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(file.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("The password doesn't match this team setup file.");
  }
  const result = {};
  for (const key of TEAM_KEYS)
    if (typeof values[key] === "string" && values[key])
      result[key] = values[key];
  if (typeof values.samModel === "string") result.samModel = values.samModel;
  return result;
}

module.exports = { sealTeamSetup, openTeamSetup };
