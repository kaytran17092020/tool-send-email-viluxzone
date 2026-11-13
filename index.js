require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");
const { CLUB_COLLECTIONS } = require("./club-data");
const historyFiles = require("./sent-history");
const { createHistoryIndex, inspectDuplicate, recordSent } = historyFiles;
const cloud = require("./cloud-store");
const smtpSettings = require("./smtp-settings");
function loadSentHistory(file) { return cloud.current()?.history || historyFiles.loadSentHistory(file); }
function saveSentHistory(file, history) { if (cloud.current()) { cloud.current().history = history; cloud.dirty(); } else historyFiles.saveSentHistory(file, history); }

const app = express();
const port = Number(process.env.PORT || 3030);
const host = process.env.HOST || "127.0.0.1";
const dataDirectory = process.env.VERCEL ? "/tmp/nodemail" : path.join(__dirname, "data");
const databaseFile = path.join(dataDirectory, "mail-data.json");
const teamFilesDirectory = path.join(dataDirectory, "team-files");
const teamContentDirectory = path.join(dataDirectory, "team-content");
const sentHistoryFile = path.join(__dirname, "sent_history.json");
const defaultRecipientSetting = cleanText(process.env.DEFAULT_RECIPIENTS_FILE);
const defaultRecipientFile = defaultRecipientSetting ? path.resolve(__dirname, defaultRecipientSetting) : "";
const sendDelayMinMs = Math.max(Number(process.env.SEND_DELAY_MIN_MS || 60_000), 60_000);
const sendDelayMaxMs = Math.max(Number(process.env.SEND_DELAY_MAX_MS || 120_000), sendDelayMinMs);
const duplicateWindowMs = 3 * 24 * 60 * 60 * 1000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_request, file, done) => {
    const allowed = /\.(xlsx|csv)$/i.test(file.originalname);
    done(allowed ? null : new Error("Chỉ hỗ trợ file .xlsx hoặc .csv."), allowed);
  },
});

fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(teamFilesDirectory, { recursive: true });
fs.mkdirSync(teamContentDirectory, { recursive: true });
const newId = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
function cleanText(value) { return String(value ?? "").trim(); }
function looksLikeDateName(value) { const text = cleanText(value); return /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/.test(text); }
function cleanSubject(value) { return cleanText(value).replace(/[\r\n]+/g, " "); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value)); }
function normalizedHeader(value) { return cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, ""); }
function columnByPriority(headers, terms) { return headers.find((header) => terms.some((term) => normalizedHeader(header).includes(term))); }
function randomDelay() { return sendDelayMinMs + Math.floor(Math.random() * (sendDelayMaxMs - sendDelayMinMs + 1)); }
function contentFingerprint(subject, plainText) { return crypto.createHash("sha256").update(`${cleanSubject(subject)}\n${cleanText(plainText)}`, "utf8").digest("hex"); }

function loadDatabase() {
  if (!fs.existsSync(databaseFile)) return { recipients: [], campaigns: [], events: [] };
  try {
    const stored = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    return {
      recipients: Array.isArray(stored.recipients) ? stored.recipients.map((recipient) => looksLikeDateName(recipient.name) ? { ...recipient, name: "" } : recipient) : [],
      campaigns: Array.isArray(stored.campaigns) ? stored.campaigns : [],
      events: Array.isArray(stored.events) ? stored.events : [],
    };
  } catch (error) {
    console.error("Không đọc được dữ liệu cũ:", error.message);
    return { recipients: [], campaigns: [], events: [] };
  }
}
const localDatabase = loadDatabase();
const database = new Proxy(localDatabase, {
  get(target, key) { return (cloud.current()?.data || target)[key]; },
  set(target, key, value) { (cloud.current()?.data || target)[key] = value; return true; },
});
function saveDatabase() {
  if (cloud.current()) { cloud.dirty(); return; }
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2), "utf8");
  fs.renameSync(temporaryFile, databaseFile);
}
function teamFileSlug(group) {
  return String(group || "team").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
}
function defaultTeamCampaign(group) {
  return {
    group,
    subject: `A fresh look for ${group} fans`,
    plainText: "",
    htmlBody: "",
    collectionUrl: CLUB_COLLECTIONS[group] || "",
    updatedAt: new Date().toISOString(),
    isDefault: true,
  };
}
function writeTeamFiles() {
  if (cloud.current()) return;
  const groups = new Map();
  for (const recipient of database.recipients) {
    const group = recipient.group || "Chưa phân loại";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(recipient);
  }
  for (const [group, recipients] of groups) {
    const slug = teamFileSlug(group);
    fs.writeFileSync(path.join(teamFilesDirectory, `${slug}.json`), JSON.stringify({ group, updatedAt: new Date().toISOString(), recipients }, null, 2), "utf8");
    const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = ["Email,Name,Team", ...recipients.map((recipient) => [recipient.email, recipient.name, group].map(quote).join(","))].join("\r\n");
    fs.writeFileSync(path.join(teamFilesDirectory, `${slug}.csv`), `\ufeff${csv}`, "utf8");
    const contentPath = resolveTeamContentFile(group);
    if (!fs.existsSync(contentPath)) fs.writeFileSync(contentPath, JSON.stringify(defaultTeamCampaign(group), null, 2), "utf8");
  }
}
function resolveTeamContentFile(group) { return path.join(teamContentDirectory, `${teamFileSlug(group)}.json`); }
function loadTeamContent(group) {
  if (cloud.current()) return cloud.current().teamContent[teamFileSlug(group)] || null;
  try { return JSON.parse(fs.readFileSync(resolveTeamContentFile(group), "utf8")); } catch { return null; }
}
function getPublicBaseUrl(request) {
  const configured = cleanText(process.env.TRACKER_PUBLIC_URL).replace(/\/$/, "");
  return configured || `${request.protocol}://${request.get("host")}`;
}
function addUtmParameters(rawUrl, campaign, recipient) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", "email");
    url.searchParams.set("utm_medium", "internal_nodemail");
    url.searchParams.set("utm_campaign", campaign.utmCampaign);
    url.searchParams.set("utm_content", recipient.token);
    if (recipient.group) url.searchParams.set("utm_term", recipient.group);
    return url.toString();
  } catch { return rawUrl; }
}
function trackedUrl(rawUrl, campaign, recipient, baseUrl) { return `${baseUrl}/r/${encodeURIComponent(recipient.token)}?url=${encodeURIComponent(addUtmParameters(rawUrl, campaign, recipient))}`; }
function personalize(content, recipient) { return content.replace(/{{\s*name\s*}}/gi, recipient.name || "there").replace(/{{\s*email\s*}}/gi, recipient.email).replace(/{{\s*group\s*}}/gi, recipient.group || ""); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
function decodeHtmlEntities(value) {
  return String(value ?? "").replace(/&(?:amp|lt|gt|quot|apos|nbsp|copy|reg|trade|ndash|mdash|rsquo|lsquo|rdquo|ldquo);|&#(?:x([\da-f]{1,6})|(\d+));/gi, (match, hex, decimal) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": " ", "&copy;": "©", "&reg;": "®", "&trade;": "™", "&ndash;": "–", "&mdash;": "—", "&rsquo;": "’", "&lsquo;": "‘", "&rdquo;": "”", "&ldquo;": "“" };
    if (Object.hasOwn(named, match.toLowerCase())) return named[match.toLowerCase()];
    const code = hex ? Number.parseInt(hex, 16) : Number(decimal);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
function htmlToText(html) {
  return decodeHtmlEntities(String(html ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, "\n\n").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function looksLikeHtml(value) { return /<\s*(?:!doctype|html|body|div|table|p|a|span|br|h[1-6])\b/i.test(String(value || "")); }
function campaignHtmlSource(campaign) {
  const htmlBody = String(campaign.htmlBody || campaign.htmlPreview || "").trim();
  if (htmlBody) return htmlBody;
  return looksLikeHtml(campaign.plainText) ? campaign.plainText : plainTextToHtml(campaign.plainText, campaign);
}
function campaignPlainText(body) {
  const plainText = cleanText(body.plainText);
  if (plainText && !looksLikeHtml(plainText)) return decodeHtmlEntities(plainText);
  return htmlToText(plainText || body.htmlBody || body.htmlPreview || "");
}
function hideUrlsFromText(text) {
  return String(text || "").replace(/https?:\/\/[^\s<>"']+/gi, (url, offset, source) => {
    const lineStart = source.lastIndexOf("\n", offset) + 1;
    const lineEnd = source.indexOf("\n", offset);
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
    return friendlyLinkLabel(url.replace(/[),.;!?]+$/, ""), line);
  });
}
function friendlyLinkLabel(url, line = "") {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch {}
  if (/facebook/i.test(line) || host.includes("facebook.com")) return "Viluxzone Official";
  if (/collection|browse|shop|product/i.test(line) || /\/collections?\/|\/products?\//i.test(url)) return "Explore the collection";
  if (/official website|website/i.test(line) || host.includes("viluxzone.com")) return "Viluxzone.com";
  return "Visit website";
}
function plainTextToHtml(text, campaign = {}) {
  const content = decodeHtmlEntities(String(text || "").replace(/{{\s*collection_url\s*}}/gi, campaign.collectionUrl || "")).trim();
  const paragraphs = content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const blocks = paragraphs.map((paragraph) => {
    const lines = paragraph.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rendered = lines.map((line) => {
      const urlPattern = /https?:\/\/[^\s<>"]+/gi;
      const onlyUrl = line.match(/^https?:\/\/[^\s<>"]+$/i);
      if (onlyUrl) {
        const destination = safeDestination(onlyUrl[0]);
        return destination ? `<a href="${escapeHtml(destination)}" style="color:#526579;text-decoration:underline">${escapeHtml(friendlyLinkLabel(destination, paragraph))}</a>` : "";
      }
      const escaped = escapeHtml(line).replace(urlPattern, (rawUrl) => {
        const cleanUrl = rawUrl.replace(/[),.;!?]+$/, "");
        const destination = safeDestination(cleanUrl);
        if (!destination) return "";
        const suffix = rawUrl.slice(cleanUrl.length);
        return `<a href="${escapeHtml(destination)}" style="color:#526579;text-decoration:underline">${escapeHtml(friendlyLinkLabel(destination, line))}</a>${escapeHtml(suffix)}`;
      });
      return escaped;
    });
    const joined = rendered.join("<br>");
    if (/^\s*(?:👉\s*)?(?:explore|browse|shop)\b/i.test(lines[0]) || /^\s*👉/.test(lines[0])) {
      const firstUrl = paragraph.match(/https?:\/\/[^\s<>"]+/i)?.[0];
      const destination = safeDestination(firstUrl || campaign.collectionUrl || "");
      const label = lines[0].replace(/^\s*👉\s*/, "").replace(/https?:\/\/[^\s<>"]+/gi, "").replace(/[.:\s]+$/, "") || "Explore the collection";
      return `<p style="margin:24px 0;text-align:center"><a href="${escapeHtml(destination || "#")}" style="display:inline-block;padding:13px 22px;border-radius:5px;background:#102a43;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(label)}</a></p>`;
    }
    if (/^20%\s*off\b/i.test(lines[0])) return `<p style="margin:18px 0;font-size:16px"><strong style="color:#d9534f">${joined.replace(/^20%\s*OFF/i, "20% OFF")}</strong></p>`;
    if (/^your code\s*:/i.test(lines[0])) {
      const codeLine = lines.map((line) => escapeHtml(line).replace(/^(your code\s*:)/i, '<strong>Your Code:</strong> ').replace(/(XMAS\d+|[A-Z][A-Z0-9_-]{3,})\s*$/i, '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#f1f3f5;color:#d9534f;font-weight:bold">$1</span>'));
      return `<p style="margin:14px 0">${codeLine.join("<br>")}</p>`;
    }
    if (/^(official website|facebook official)\s*:/i.test(lines[0])) return `<p style="margin:5px 0;color:#6b7280;font-size:13px">${joined}</p>`;
    if (/^20\d\d\s+(?:©|&copy;)/i.test(lines[0])) return `<p style="margin:5px 0;color:#6b7280;font-size:13px">${joined.replace(/&amp;copy;/gi, "©")}</p>`;
    if (/^gear up\b/i.test(lines[0])) return `<p style="margin:18px 0;color:#536273"><em>${joined}</em></p>`;
    return `<p style="margin:0 0 16px">${joined}</p>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#263445"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f7"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:34px 38px;font-size:15px;line-height:1.7">${blocks}</td></tr></table></td></tr></table></body></html>`;
}
function personalizeHtml(content, campaign, recipient) {
  let html = String(content || "").slice(0, 500_000)
    .replace(/<\s*(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
  html = html.replace(/{{\s*collection_url\s*}}/gi, escapeHtml(campaign.collectionUrl || ""))
    .replace(/{{\s*name\s*}}/gi, escapeHtml(recipient.name || "there"))
    .replace(/{{\s*email\s*}}/gi, escapeHtml(recipient.email))
    .replace(/{{\s*group\s*}}/gi, escapeHtml(recipient.group || ""));
  return html.replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a\s*>/gi, (match, before, quote, encodedUrl, after, labelHtml) => {
    const destination = safeDestination(encodedUrl.replace(/&amp;/gi, "&").replace(/&#0*38;/gi, "&"));
    if (!destination) return match;
    const visibleLabel = htmlToText(labelHtml).trim();
    const friendlyLabel = /^https?:\/\//i.test(visibleLabel) ? escapeHtml(friendlyLinkLabel(destination, visibleLabel)) : labelHtml;
    return `<a${before}href=${quote}${escapeHtml(trackedUrl(destination, campaign, recipient, campaign.trackerBaseUrl))}${quote}${after}>${friendlyLabel}</a>`;
  });
}
function composeRecipientText(campaign, recipient) {
  const source = campaignPlainText(campaign);
  const withCollection = source.replace(/{{\s*collection_url\s*}}/gi, campaign.collectionUrl || "");
  const body = hideUrlsFromText(personalize(withCollection, recipient));
  const greeting = campaign.addGreeting && recipient.name ? `Dear ${recipient.name},\n\n` : "";
  return `${greeting}${body}`;
}
function safeDestination(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function getSmtpConfig(encrypted) { return smtpSettings.decrypt(encrypted || cloud.current()?.smtp) || smtpSettings.environment(); }
function getTransporter(encrypted) {
  const config = getSmtpConfig(encrypted);
  const host = cleanText(config.host), user = cleanText(config.user), password = config.password;
  if (!host || !user || !password) throw new Error("Thiếu SMTP_HOST, SMTP_USER hoặc SMTP_PASS trong file .env.");
  if (/your-domain|replace-with/i.test(`${user} ${password}`)) throw new Error("SMTP vẫn dùng thông tin mẫu. Hãy điền biến môi trường SMTP hợp lệ.");
  return nodemailer.createTransport({ host, port: config.port, secure: config.secure, requireTLS: !config.secure,
    from: config.from || user, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 25000, auth: { user, pass: password } });
}
function recipientPayload() {
  const groups = {};
  database.recipients.forEach((recipient) => { groups[recipient.group || "Chưa phân loại"] = (groups[recipient.group || "Chưa phân loại"] || 0) + 1; });
  return { recipients: database.recipients, groups };
}
function isRecentlySentSameContent(email, fingerprint) {
  const cutoff = Date.now() - duplicateWindowMs;
  return database.campaigns.some((campaign) => campaign.contentHash === fingerprint && campaign.recipients.some((recipient) => recipient.email === email && recipient.status === "sent" && Date.parse(recipient.sentAt) >= cutoff));
}
function campaignSummary(campaign) {
  const events = database.events.filter((event) => event.campaignId === campaign.id);
  const uniqueByEvent = (type) => new Set(events.filter((event) => event.type === type).map((event) => event.token)).size;
  const count = (status) => campaign.recipients.filter((recipient) => recipient.status === status).length;
  return {
    id: campaign.id, subject: campaign.subject, createdAt: campaign.createdAt, status: campaign.status || "completed", nextSendAt: campaign.nextSendAt || null, completedAt: campaign.completedAt || null,
    total: campaign.recipients.length, queued: count("queued"), sending: count("sending"), sent: count("sent"), failed: count("failed"), blocked: count("blocked"),
    progressPercent: campaign.recipients.length ? Math.round((count("sent") + count("failed") + count("blocked")) * 100 / campaign.recipients.length) : 100,
    currentEmail: campaign.recipients.find((recipient) => recipient.status === "sending")?.email || "",
    lastSentEmail: campaign.recipients.filter((recipient) => recipient.status === "sent").sort((a, b) => Date.parse(b.sentAt || 0) - Date.parse(a.sentAt || 0))[0]?.email || "",
    lastSentAt: campaign.recipients.filter((recipient) => recipient.status === "sent").sort((a, b) => Date.parse(b.sentAt || 0) - Date.parse(a.sentAt || 0))[0]?.sentAt || null,
    clicked: uniqueByEvent("click"), addedToCart: uniqueByEvent("add_to_cart"), checkout: uniqueByEvent("begin_checkout"), purchased: uniqueByEvent("purchase"),
  };
}
const eventLabel = (type) => ({ click: "Đã bấm link", add_to_cart: "Đã thêm giỏ", begin_checkout: "Đã checkout", purchase: "Đã mua hàng", view_link: "Đã xem link" })[type] || type;

let workerTimer = null;
let workerBusy = false;
function clearWorkerTimer() { if (workerTimer) clearTimeout(workerTimer); workerTimer = null; }
function scheduleWorker(delayMs = 0) {
  if (cloud.enabled) { cloud.schedule(delayMs); return; }
  clearWorkerTimer();
  workerTimer = setTimeout(() => { workerTimer = null; runQueue().catch((error) => console.error("Queue error:", error)); }, Math.max(delayMs, 0));
}
function finishCampaignIfDone(campaign) {
  if (!campaign.recipients.some((recipient) => ["queued", "sending"].includes(recipient.status))) {
    campaign.status = "completed";
    campaign.completedAt = campaign.completedAt || new Date().toISOString();
    campaign.nextSendAt = null;
  }
}
async function runQueue() {
  if (workerBusy) return;
  const campaign = database.campaigns.find((item) => item.status === "running");
  if (!campaign) return;
  const recipient = campaign.recipients.find((item) => item.status === "queued");
  if (!recipient) { finishCampaignIfDone(campaign); saveDatabase(); scheduleWorker(0); return; }
  const waitUntil = Date.parse(campaign.nextSendAt || "");
  if (Number.isFinite(waitUntil) && waitUntil > Date.now()) { scheduleWorker(waitUntil - Date.now()); return; }
  workerBusy = true;
  recipient.status = "sending";
  saveDatabase();
  try {
    const transporter = getTransporter();
    const trackerBaseUrl = campaign.trackerBaseUrl;
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipient.email,
      subject: personalize(campaign.subject, recipient),
      text: composeRecipientText(campaign, recipient),
      html: personalizeHtml(campaignHtmlSource(campaign), campaign, recipient),
    });
    recipient.status = "sent";
    recipient.sentAt = new Date().toISOString();
    try {
      const history = loadSentHistory(sentHistoryFile);
      recordSent(history, { email: recipient.email, club: recipient.group, subject: personalize(campaign.subject, recipient), body: composeRecipientText(campaign, recipient), sentAt: recipient.sentAt, funnel: campaign.funnel || campaign.type || "" });
      saveSentHistory(sentHistoryFile, history);
    } catch (historyError) {
      recipient.historyError = `Email đã gửi; ghi sent_history thất bại: ${historyError.message}`;
      console.error(recipient.historyError);
    }
  } catch (error) {
    recipient.status = "failed";
    recipient.error = error.message;
  } finally {
    workerBusy = false;
  }
  if (campaign.status === "running") {
    finishCampaignIfDone(campaign);
    if (campaign.status === "running") campaign.nextSendAt = new Date(Date.now() + randomDelay()).toISOString();
  }
  saveDatabase();
  if (campaign.status === "running") scheduleWorker(Date.parse(campaign.nextSendAt) - Date.now());
  else scheduleWorker(0);
}

function parseRecipientWorkbook(buffer, forcedGroup = "") {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: "buffer", raw: false }); } catch { throw new Error("Không thể đọc file bảng tính này."); }
  const imported = [], invalidRows = [], existing = new Set(database.recipients.map((recipient) => recipient.email.toLowerCase()));
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    const emailColumn = columnByPriority(headers, ["email", "mail", "emailaddress"]);
    if (!emailColumn) continue;
    const groupColumn = columnByPriority(headers, ["team", "group", "segment", "club", "doi", "nhom", "category"]);
    const nameColumn = headers.find((header) => ["name", "fullname", "customername", "firstname", "customerfirst", "customerfirstname", "ten", "tenkhachhang"].includes(normalizedHeader(header)));
    rows.forEach((row, index) => {
      const email = cleanText(row[emailColumn]).toLowerCase();
      if (!email) return;
      if (!isEmail(email)) { invalidRows.push({ sheet: sheetName, row: index + 2 }); return; }
      if (existing.has(email)) return;
      existing.add(email);
      imported.push({ id: newId("recipient"), email, name: nameColumn ? cleanText(row[nameColumn]) : "", group: forcedGroup || (groupColumn ? cleanText(row[groupColumn]) || "Chưa phân loại" : sheetName), sourceSheet: sheetName, createdAt: new Date().toISOString() });
    });
  }
  if (!imported.length) throw new Error("Không tìm thấy email mới. Cần cột Email, Team/Group hoặc Segment.");
  database.recipients.push(...imported);
  saveDatabase();
  writeTeamFiles();
  return { imported: imported.length, skippedInvalid: invalidRows.length, recipients: recipientPayload() };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
if (cloud.enabled) app.use(cloud.middleware);
app.get("/api/health", async (request, response) => {
  if (cloud.enabled && request.query.probe === "true") await cloud.probe();
  const queueProbe = cloud.enabled && request.query.queue === "true" ? await cloud.queueProbe(request.query.wake === "true") : null;
  if (request.query.smtp === "true") {
    try { await getTransporter().verify(); }
    catch (error) { return response.status(503).json({ ok: false, storage: "connected", smtp: "unavailable", code: error.code || "SMTP_ERROR" }); }
  }
  response.json({ ok: true, storage: cloud.enabled ? "private-blob" : "local", smtp: request.query.smtp === "true" ? "verified" : "not-tested", queueProbe });
});
app.get("/api/smtp-settings", (_request, response) => {
  const config = getSmtpConfig();
  response.set("Cache-Control", "no-store").json({ host: config.host, port: config.port, secure: config.secure,
    user: /your-domain/.test(config.user) ? "" : config.user, from: /your-domain/.test(config.from) ? "" : config.from,
    passwordSaved: smtpSettings.configured(config), editable: cloud.enabled });
});
app.put("/api/smtp-settings", (request, response) => {
  if (!cloud.current()) return response.status(400).json({ error: "Bản local dùng file .env." });
  if (database.campaigns.some((campaign) => campaign.status === "running")) return response.status(409).json({ error: "Pause chiến dịch trước khi đổi SMTP." });
  const previous = getSmtpConfig();
  const config = { host: cleanText(request.body.host), port: Number(request.body.port), secure: request.body.secure === true,
    user: cleanText(request.body.user), password: String(request.body.password || "") || (previous.user === cleanText(request.body.user) ? previous.password : ""),
    from: cleanText(request.body.from) || cleanText(request.body.user) };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.host) || ![465, 587].includes(config.port) || !isEmail(config.user) || !smtpSettings.configured(config)
      || config.password.length > 4096 || /[\r\n]/.test(config.from)) return response.status(400).json({ error: "Điền host, cổng 465/587, email và mật khẩu SMTP hợp lệ." });
  cloud.current().smtp = smtpSettings.encrypt(config);
  cloud.dirty();
  response.json({ ok: true });
});
app.post("/api/smtp-verify", async (_request, response) => {
  try { await getTransporter().verify(); response.json({ ok: true, message: "Kết nối SMTP thành công. Chưa gửi email." }); }
  catch (error) { response.status(400).json({ error: `Không kết nối được SMTP (${error.code || "CONFIG_ERROR"}). Kiểm tra host, email và mật khẩu hộp thư.` }); }
});
app.get("/api/settings", (request, response) => response.json({
  trackerBaseUrl: getPublicBaseUrl(request), trackerIsPublic: Boolean(process.env.TRACKER_PUBLIC_URL) && (!cloud.enabled || process.env.TRACKER_PUBLIC_ACCESS === "true"), googleMeasurementId: process.env.GA4_MEASUREMENT_ID || "G-029PNZ8EV2",
  smtpConfigured: smtpSettings.configured(getSmtpConfig()), from: getSmtpConfig().from,
  defaultRecipientFileConfigured: Boolean(defaultRecipientFile), defaultRecipientFileName: defaultRecipientFile ? path.basename(defaultRecipientFile) : "", delayMinMinutes: sendDelayMinMs / 60_000, delayMaxMinutes: sendDelayMaxMs / 60_000,
}));
app.post("/api/recipients/import", upload.single("file"), (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Chọn file danh sách email trước khi nhập." });
  try { response.json(parseRecipientWorkbook(request.file.buffer, cleanText(request.query.group))); } catch (error) { response.status(400).json({ error: error.message }); }
});
app.post("/api/recipients/import-source", (_request, response) => {
  if (!defaultRecipientFile) return response.status(400).json({ error: "Chưa cấu hình DEFAULT_RECIPIENTS_FILE trong file .env." });
  try { response.json(parseRecipientWorkbook(fs.readFileSync(defaultRecipientFile))); } catch (error) { response.status(400).json({ error: `Không thể nhập file nguồn: ${error.message}` }); }
});
app.get("/api/recipients", (_request, response) => response.json(recipientPayload()));
app.delete("/api/recipients", (_request, response) => { database.recipients = []; saveDatabase(); writeTeamFiles(); response.status(204).end(); });
app.get("/api/club-collections", (_request, response) => response.json(CLUB_COLLECTIONS));
app.get("/api/teams", (_request, response) => {
  const groups = recipientPayload().groups;
  const history = loadSentHistory(sentHistoryFile);
  response.json(Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], "vi")).map(([group, count]) => ({ group, count, collectionUrl: CLUB_COLLECTIONS[group] || "", contentSaved: Boolean(loadTeamContent(group)), historyCount: Object.values(history).filter((entry) => entry?.club === group).length, fileName: `${teamFileSlug(group)}.csv` })));
});
app.get("/api/team-content", (request, response) => {
  const group = cleanText(request.query.group);
  if (!group || group.length > 100) return response.status(400).json({ error: "Chọn một đội hợp lệ." });
  response.json(loadTeamContent(group) || { group, subject: "", plainText: "", htmlBody: "", collectionUrl: CLUB_COLLECTIONS[group] || "" });
});
app.put("/api/team-content", (request, response) => {
  const group = cleanText(request.body.group);
  if (!group || group.length > 100) return response.status(400).json({ error: "Chọn một đội hợp lệ." });
  const rawCollectionUrl = cleanText(request.body.collectionUrl), collectionUrl = rawCollectionUrl ? safeDestination(rawCollectionUrl) : "";
  if (rawCollectionUrl && !collectionUrl) return response.status(400).json({ error: "Collection URL cần là liên kết http/https hợp lệ." });
  const content = {
    group,
    subject: cleanSubject(request.body.subject).slice(0, 200),
    plainText: String(request.body.plainText ?? "").slice(0, 100_000),
    htmlBody: String(request.body.htmlBody ?? request.body.htmlPreview ?? "").slice(0, 500_000),
    collectionUrl,
    updatedAt: new Date().toISOString(),
  };
  if (cloud.current()) { cloud.current().teamContent[teamFileSlug(group)] = content; cloud.dirty(); }
  else fs.writeFileSync(resolveTeamContentFile(group), JSON.stringify(content, null, 2), "utf8");
  response.json({ ok: true, group: content.group, updatedAt: content.updatedAt });
});
app.get("/api/teams/export", (request, response) => {
  const group = cleanText(request.query.group);
  if (!group) return response.status(400).send("Chọn đội cần xuất.");
  const rows = database.recipients.filter((recipient) => recipient.group === group);
  if (!rows.length) return response.status(404).send("Đội này chưa có email.");
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = ["Email,Name,Team", ...rows.map((recipient) => [recipient.email, recipient.name, recipient.group].map(quote).join(","))].join("\r\n");
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${teamFileSlug(group)}.csv"`);
  response.send(`\ufeff${csv}`);
});

function campaignRequestedRecipients(body, persistManual = false) {
  const selectedGroups = Array.isArray(body.groups) ? body.groups.map(cleanText).filter(Boolean) : [];
  if (selectedGroups.length > 1) throw new Error("Gửi từng đội một để dùng đúng nội dung riêng của từng đội.");
  let requested = database.recipients.filter((recipient) => selectedGroups.includes(recipient.group));
  const rawManual = String(body.manualEmails ?? "").split(/[\r\n,;\t ]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const invalidManual = rawManual.filter((email) => !isEmail(email));
  if (invalidManual.length) throw new Error(`Có ${invalidManual.length} địa chỉ email nhập tay không hợp lệ.`);
  const uniqueManual = [...new Set(rawManual)];
  for (const email of uniqueManual) {
    const existsInRequested = requested.some((recipient) => recipient.email.toLowerCase() === email);
    if (existsInRequested) continue;
    let existing = database.recipients.find((recipient) => recipient.email.toLowerCase() === email);
    if (!existing) {
      existing = { id: newId("recipient"), email, name: "", group: selectedGroups[0] || "Danh sách nhập tay", sourceSheet: "manual", createdAt: new Date().toISOString() };
      if (persistManual) database.recipients.push(existing);
    }
    requested.push(existing);
  }
  const deduped = [...new Map(requested.map((recipient) => [recipient.email.toLowerCase(), recipient])).values()];
  return { requested: deduped, selectedGroups, manualCount: uniqueManual.length };
}
function inspectCampaignDuplicates(body, recipients) {
  const history = createHistoryIndex(loadSentHistory(sentHistoryFile));
  const collectionUrl = safeDestination(cleanText(body.collectionUrl)) || "";
  return recipients.map((recipient) => {
    const campaign = { plainText: campaignPlainText(body).replace(/{{\s*collection_url\s*}}/gi, collectionUrl), addGreeting: body.addGreeting !== false, trackerBaseUrl: "", utmCampaign: "" };
    const finalBody = personalize(campaign.plainText, recipient);
    const greeting = campaign.addGreeting && recipient.name ? `Dear ${recipient.name},\n\n` : "";
    const result = inspectDuplicate(history, recipient.email, personalize(cleanSubject(body.subject), recipient), `${greeting}${finalBody}`);
    result.recentCampaign = isRecentlySentSameContent(recipient.email, contentFingerprint(cleanSubject(body.subject), campaign.plainText));
    result.isDuplicate = result.isDuplicate || result.recentCampaign;
    return { email: recipient.email, group: recipient.group, ...result };
  });
}
app.post("/api/campaigns/preview", (request, response) => {
  const subject = cleanSubject(request.body.subject), plainText = campaignPlainText(request.body);
  if (!subject || !plainText) return response.status(400).json({ error: "Cần có tiêu đề và nội dung HTML." });
  const rawCollectionUrl = cleanText(request.body.collectionUrl), collectionUrl = rawCollectionUrl ? safeDestination(rawCollectionUrl) : "";
  if (rawCollectionUrl && !collectionUrl) return response.status(400).json({ error: "Collection URL cần là liên kết http/https hợp lệ." });
  if (/{{\s*collection_url\s*}}/i.test(`${plainText}\n${request.body.htmlBody || ""}`) && !collectionUrl) return response.status(400).json({ error: "Nội dung đang có {{collection_url}} nhưng chưa chọn/dán Collection URL." });
  let audience;
  try { audience = campaignRequestedRecipients(request.body, false); } catch (error) { return response.status(400).json({ error: error.message }); }
  const duplicates = inspectCampaignDuplicates(request.body, audience.requested).filter((item) => item.isDuplicate);
  response.json({ total: audience.requested.length, manualCount: audience.manualCount, duplicateCount: duplicates.length, duplicates: duplicates.slice(0, 100), duplicateHistory: "Lịch sử cũ được so email + tiêu đề; các lượt gửi mới được so cả nội dung chuẩn hóa." });
});

app.post("/api/campaigns/send", async (request, response) => {
  const subject = cleanSubject(request.body.subject), plainText = campaignPlainText(request.body);
  const htmlBody = String(request.body.htmlBody ?? request.body.htmlPreview ?? "").trim().slice(0, 500_000);
  if (!subject || (!plainText && !htmlBody)) return response.status(400).json({ error: "Cần có tiêu đề và nội dung HTML." });
  if (database.campaigns.some((campaign) => ["running", "paused"].includes(campaign.status))) return response.status(409).json({ error: "Đang có một chiến dịch chưa hoàn tất. Hãy Pause/Resume hoặc chờ chiến dịch đó gửi xong." });
  let audience;
  try { audience = campaignRequestedRecipients(request.body, true); } catch (error) { return response.status(400).json({ error: error.message }); }
  const { requested, selectedGroups } = audience;
  if (!requested.length) return response.status(400).json({ error: "Chưa chọn đội hoặc nhóm email." });
  const collectionUrl = safeDestination(cleanText(request.body.collectionUrl)) || "";
  if (cleanText(request.body.collectionUrl) && !collectionUrl) return response.status(400).json({ error: "Collection URL cần là liên kết http/https hợp lệ." });
  if (/{{\s*collection_url\s*}}/i.test(`${plainText}\n${htmlBody}`) && !collectionUrl) return response.status(400).json({ error: "Nội dung đang có {{collection_url}} nhưng chưa chọn/dán Collection URL." });
  const duplicateChecks = inspectCampaignDuplicates(request.body, requested);
  const duplicatesByEmail = new Map(duplicateChecks.filter((item) => item.isDuplicate).map((item) => [item.email.toLowerCase(), item]));
  saveDatabase();
  writeTeamFiles();
  try { const transporter = getTransporter(); await transporter.verify(); } catch (error) { return response.status(400).json({ error: `SMTP chưa sẵn sàng: ${error.message}` }); }
  const fingerprint = contentFingerprint(subject, plainText);
  const seenInCycle = new Set();
  const recipients = requested.map((recipient) => {
    const base = { recipientId: recipient.id, email: recipient.email, name: recipient.name, group: recipient.group, token: newId("mail"), status: "queued", sentAt: null, error: null };
    if (seenInCycle.has(recipient.email)) return { ...base, status: "blocked", blockedReason: "Trùng email trong vòng gửi hiện tại" };
    seenInCycle.add(recipient.email);
    const historyDuplicate = duplicatesByEmail.get(recipient.email.toLowerCase());
    if (historyDuplicate && request.body.allowDuplicates !== true) {
      const reasons = [historyDuplicate.sameSubject && "đã nhận cùng tiêu đề", historyDuplicate.sameContent && "đã nhận cùng nội dung"].filter(Boolean).join(" và ");
      return { ...base, status: "blocked", blockedReason: `sent_history.json: ${reasons || "trùng lịch sử"}` };
    }
    if (isRecentlySentSameContent(recipient.email, fingerprint) && request.body.allowDuplicates !== true) return { ...base, status: "blocked", blockedReason: "Đã nhận cùng nội dung trong 3 ngày gần nhất" };
    return base;
  });
  const campaign = {
    id: newId("campaign"), createdAt: new Date().toISOString(), subject, plainText, htmlBody, contentHash: fingerprint,
    group: selectedGroups[0] || "Danh sách nhập tay", collectionUrl, funnel: cleanText(request.body.funnel), type: cleanText(request.body.type),
    utmCampaign: cleanText(request.body.utmCampaign) || `email_${Date.now()}`, trackerBaseUrl: getPublicBaseUrl(request), addGreeting: request.body.addGreeting !== false, recipients, status: "running", nextSendAt: null, completedAt: null,
  };
  finishCampaignIfDone(campaign);
  database.campaigns.unshift(campaign); saveDatabase();
  if (campaign.status === "running") scheduleWorker(0);
  const summary = campaignSummary(campaign);
  response.status(202).json({ campaign: summary, duplicateBlocked: summary.blocked, message: summary.blocked ? `${summary.blocked} email đã bị chặn vì trùng nội dung trong 3 ngày hoặc trùng vòng gửi.` : "Chiến dịch đã vào hàng đợi gửi." });
});
app.post("/api/campaigns/:id/pause", (request, response) => {
  const campaign = database.campaigns.find((item) => item.id === request.params.id);
  if (!campaign || campaign.status !== "running") return response.status(400).json({ error: "Chỉ có thể pause chiến dịch đang gửi." });
  campaign.status = "paused"; campaign.nextSendAt = null; saveDatabase(); clearWorkerTimer();
  response.json({ campaign: campaignSummary(campaign) });
});
app.post("/api/campaigns/:id/resume", (request, response) => {
  const campaign = database.campaigns.find((item) => item.id === request.params.id);
  if (!campaign || campaign.status !== "paused") return response.status(400).json({ error: "Chỉ có thể tiếp tục chiến dịch đang pause." });
  if (!campaign.recipients.some((recipient) => recipient.status === "queued")) { finishCampaignIfDone(campaign); saveDatabase(); return response.json({ campaign: campaignSummary(campaign) }); }
  campaign.status = "running"; campaign.nextSendAt = null; saveDatabase(); scheduleWorker(0);
  response.json({ campaign: campaignSummary(campaign) });
});

app.get("/api/dashboard", (_request, response) => {
  const campaigns = database.campaigns.map(campaignSummary);
  const rows = database.campaigns.flatMap((campaign) => campaign.recipients.map((recipient) => {
    const events = database.events.filter((event) => event.token === recipient.token), has = (type) => events.some((event) => event.type === type);
    const status = recipient.status === "blocked" ? "Đã chặn trùng" : recipient.status === "queued" ? "Đang chờ gửi" : recipient.status === "sending" ? "Đang gửi" : recipient.status === "failed" ? "Gửi lỗi" : has("purchase") ? "Đã mua hàng" : has("begin_checkout") ? "Đã checkout" : has("add_to_cart") ? "Đã thêm giỏ" : has("view_link") ? "Đã xem link" : has("click") ? "Đã bấm link" : recipient.status === "sent" ? "Đã gửi" : "Chưa có tương tác";
    return { campaignId: campaign.id, campaignSubject: campaign.subject, email: recipient.email, name: recipient.name, group: recipient.group, sentAt: recipient.sentAt, status, blockedReason: recipient.blockedReason || "", events: events.map((event) => ({ ...event, label: eventLabel(event.type) })) };
  }));
  response.json({ campaigns, rows });
});
app.get("/r/:token", (request, response) => {
  const campaign = database.campaigns.find((item) => item.recipients.some((recipient) => recipient.token === request.params.token));
  const recipient = campaign?.recipients.find((item) => item.token === request.params.token), destination = safeDestination(cleanText(request.query.url));
  if (!campaign || !recipient || !destination) return response.status(400).send("Liên kết không hợp lệ.");
  database.events.push({ id: newId("event"), campaignId: campaign.id, token: recipient.token, type: "click", createdAt: new Date().toISOString(), url: destination }); saveDatabase(); response.redirect(destination);
});
app.options("/event/:token", (_request, response) => response.set("Access-Control-Allow-Origin", "*").set("Access-Control-Allow-Headers", "Content-Type").sendStatus(204));
app.post("/event/:token", (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  const allowedTypes = new Set(["add_to_cart", "begin_checkout", "purchase", "view_link"]), type = cleanText(request.body.event || request.query.event);
  const campaign = database.campaigns.find((item) => item.recipients.some((recipient) => recipient.token === request.params.token));
  if (!campaign || !allowedTypes.has(type)) return response.status(400).json({ error: "Token hoặc loại sự kiện không hợp lệ." });
  database.events.push({ id: newId("event"), campaignId: campaign.id, token: request.params.token, type, createdAt: new Date().toISOString(), value: Number(request.body.value || 0) || undefined }); saveDatabase(); response.status(201).json({ ok: true });
});
app.use((error, _request, response, _next) => { console.error(error); response.status(400).json({ error: error.message || "Yêu cầu không hợp lệ." }); });
if (!cloud.enabled) {
  writeTeamFiles();
  app.listen(port, host, () => { console.log(`Nodemail đang chạy tại http://127.0.0.1:${port}`); if (database.campaigns.some((campaign) => campaign.status === "running")) scheduleWorker(0); });
}
module.exports = app;
module.exports.queueHelpers = { getTransporter, personalize, composeRecipientText, campaignHtmlSource, personalizeHtml, recordSent, finishCampaignIfDone, randomDelay };

