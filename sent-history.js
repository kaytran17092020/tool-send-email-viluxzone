const crypto = require("crypto");
const fs = require("fs");

function normalizeEmail(value) { return String(value ?? "").trim().toLowerCase(); }
function normalizeSubject(value) { return String(value ?? "").trim().replace(/[\r\n]+/g, " ").toLowerCase(); }
function normalizeBody(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function bodyFingerprint(body) { return crypto.createHash("sha256").update(normalizeBody(body), "utf8").digest("hex"); }
function loadSentHistory(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Không đọc được sent_history.json: ${error.message}`);
  }
}
function saveSentHistory(filePath, history) {
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(history, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}
function createHistoryIndex(history) {
  const index = new Map();
  for (const [key, value] of Object.entries(history)) {
    const [keyEmail, keySubject] = key.split("___");
    const email = normalizeEmail(value?.email || keyEmail || "");
    if (!email) continue;
    if (!index.has(email)) index.set(email, []);
    index.get(email).push({ email, subject: value?.subject || keySubject || "", bodyHash: value?.bodyHash || "", sentAt: value?.sentAt || null });
  }
  return index;
}
function inspectDuplicate(history, email, subject, body) {
  const cleanEmail = normalizeEmail(email), cleanSubject = normalizeSubject(subject), cleanHash = bodyFingerprint(body);
  let sameSubject = null, sameContent = null;
  const entries = history instanceof Map ? (history.get(cleanEmail) || []) : createHistoryIndex(history).get(cleanEmail) || [];
  for (const value of entries) {
    const itemSubject = normalizeSubject(value.subject || "");
    const itemHash = String(value.bodyHash || "");
    if (!sameSubject && itemSubject && itemSubject === cleanSubject) {
      sameSubject = { sentAt: value.sentAt || null, subject: value.subject || subject, hasBodyHash: Boolean(itemHash) };
    }
    if (!sameContent && itemHash && itemHash === cleanHash) {
      sameContent = { sentAt: value.sentAt || null, subject: value.subject || "" };
    }
  }
  // Older indexAI records only saved email + subject; their body cannot be reconstructed.
  return { bodyHash: cleanHash, sameSubject, sameContent, isDuplicate: Boolean(sameSubject || sameContent) };
}
function recordSent(history, { email, club, subject, body, sentAt = new Date().toISOString(), funnel = "" }) {
  const cleanEmail = normalizeEmail(email), cleanSubject = String(subject ?? "").trim(), bodyHash = bodyFingerprint(body);
  const key = `${cleanEmail}___${normalizeSubject(cleanSubject)}___${bodyHash}`;
  history[key] = { email: cleanEmail, club: club || "", subject: cleanSubject, sentAt, bodyHash, funnel };
  return history;
}

module.exports = { normalizeEmail, normalizeSubject, normalizeBody, bodyFingerprint, loadSentHistory, saveSentHistory, createHistoryIndex, inspectDuplicate, recordSent };
