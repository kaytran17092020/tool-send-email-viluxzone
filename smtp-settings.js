const crypto = require("node:crypto");

function key() {
  const value = Buffer.from(process.env.SMTP_CONFIG_KEY || "", "base64");
  if (value.length !== 32) throw new Error("Thiếu khóa mã hóa cấu hình SMTP trên server.");
  return value;
}

function encrypt(config) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decrypt(value) {
  if (!value) return null;
  const payload = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8"));
}

function environment() {
  return { host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false", user: process.env.SMTP_USER || "", password: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "" };
}

function configured(config) {
  return Boolean(config.host && config.user && config.password && !/your-domain|replace-with/i.test(`${config.user} ${config.password}`));
}

module.exports = { encrypt, decrypt, environment, configured };
