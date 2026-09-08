require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");

const app = express();
const port = Number(process.env.PORT || 3030);
const dataDirectory = path.join(__dirname, "data");
const databaseFile = path.join(dataDirectory, "mail-data.json");
const defaultRecipientFile = cleanText(process.env.DEFAULT_RECIPIENTS_FILE);
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
const newId = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
function cleanText(value) { return String(value ?? "").trim(); }
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
      recipients: Array.isArray(stored.recipients) ? stored.recipients : [],
      campaigns: Array.isArray(stored.campaigns) ? stored.campaigns : [],
      events: Array.isArray(stored.events) ? stored.events : [],
    };
  } catch (error) {
    console.error("Không đọc được dữ liệu cũ:", error.message);
    return { recipients: [], campaigns: [], events: [] };
  }
}
let database = loadDatabase();
function saveDatabase() {
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2), "utf8");
  fs.renameSync(temporaryFile, databaseFile);
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
function replaceLinks(content, campaign, recipient, baseUrl) { return content.replace(/https?:\/\/[^\s<>\")]+/gi, (url) => trackedUrl(url, campaign, recipient, baseUrl)); }
function personalize(content, recipient) { return content.replace(/{{\s*name\s*}}/gi, recipient.name || "").replace(/{{\s*email\s*}}/gi, recipient.email).replace(/{{\s*group\s*}}/gi, recipient.group || ""); }
function composeRecipientText(campaign, recipient) {
  const body = personalize(campaign.plainText, recipient);
  const greeting = campaign.addGreeting && recipient.name ? `Dear ${recipient.name},\n\n` : "";
  return replaceLinks(`${greeting}${body}`, campaign, recipient, campaign.trackerBaseUrl);
}
function safeDestination(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function getTransporter() {
  const host = cleanText(process.env.SMTP_HOST), user = cleanText(process.env.SMTP_USER), password = cleanText(process.env.SMTP_PASS);
  if (!host || !user || !password) throw new Error("Thiếu SMTP_HOST, SMTP_USER hoặc SMTP_PASS trong file .env.");
  return nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || 465), secure: cleanText(process.env.SMTP_SECURE || "true").toLowerCase() !== "false", auth: { user, pass: password } });
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
    clicked: uniqueByEvent("click"), addedToCart: uniqueByEvent("add_to_cart"), checkout: uniqueByEvent("begin_checkout"), purchased: uniqueByEvent("purchase"),
  };
}
const eventLabel = (type) => ({ click: "Đã bấm link", add_to_cart: "Đã thêm giỏ", begin_checkout: "Đã checkout", purchase: "Đã mua hàng", view_link: "Đã xem link" })[type] || type;

let workerTimer = null;
let workerBusy = false;
function clearWorkerTimer() { if (workerTimer) clearTimeout(workerTimer); workerTimer = null; }
function scheduleWorker(delayMs = 0) {
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
    });
    recipient.status = "sent";
    recipient.sentAt = new Date().toISOString();
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

function parseRecipientWorkbook(buffer) {
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
    const nameColumn = columnByPriority(headers, ["name", "fullname", "customer", "first", "ten"]);
    rows.forEach((row, index) => {
      const email = cleanText(row[emailColumn]).toLowerCase();
      if (!email) return;
      if (!isEmail(email)) { invalidRows.push({ sheet: sheetName, row: index + 2 }); return; }
      if (existing.has(email)) return;
      existing.add(email);
      imported.push({ id: newId("recipient"), email, name: nameColumn ? cleanText(row[nameColumn]) : "", group: groupColumn ? cleanText(row[groupColumn]) || "Chưa phân loại" : sheetName, sourceSheet: sheetName, createdAt: new Date().toISOString() });
    });
  }
  if (!imported.length) throw new Error("Không tìm thấy email mới. Cần cột Email, Team/Group hoặc Segment.");
  database.recipients.push(...imported);
  saveDatabase();
  return { imported: imported.length, skippedInvalid: invalidRows.length, recipients: recipientPayload() };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/settings", (request, response) => response.json({
  trackerBaseUrl: getPublicBaseUrl(request), trackerIsPublic: Boolean(process.env.TRACKER_PUBLIC_URL), googleMeasurementId: process.env.GA4_MEASUREMENT_ID || "G-029PNZ8EV2",
  smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS), from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  defaultRecipientFileConfigured: Boolean(defaultRecipientFile), defaultRecipientFileName: defaultRecipientFile ? path.basename(defaultRecipientFile) : "", delayMinMinutes: sendDelayMinMs / 60_000, delayMaxMinutes: sendDelayMaxMs / 60_000,
}));
app.post("/api/recipients/import", upload.single("file"), (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Chọn file danh sách email trước khi nhập." });
  try { response.json(parseRecipientWorkbook(request.file.buffer)); } catch (error) { response.status(400).json({ error: error.message }); }
});
app.post("/api/recipients/import-source", (_request, response) => {
  if (!defaultRecipientFile) return response.status(400).json({ error: "Chưa cấu hình DEFAULT_RECIPIENTS_FILE trong file .env." });
  try { response.json(parseRecipientWorkbook(fs.readFileSync(defaultRecipientFile))); } catch (error) { response.status(400).json({ error: `Không thể nhập file nguồn: ${error.message}` }); }
});
app.get("/api/recipients", (_request, response) => response.json(recipientPayload()));
app.delete("/api/recipients", (_request, response) => { database.recipients = []; saveDatabase(); response.status(204).end(); });

app.post("/api/campaigns/send", async (request, response) => {
  const subject = cleanSubject(request.body.subject), plainText = cleanText(request.body.plainText);
  const selectedGroups = Array.isArray(request.body.groups) ? request.body.groups.map(cleanText) : [];
  if (!subject || !plainText) return response.status(400).json({ error: "Cần có tiêu đề và nội dung Text." });
  if (database.campaigns.some((campaign) => ["running", "paused"].includes(campaign.status))) return response.status(409).json({ error: "Đang có một chiến dịch chưa hoàn tất. Hãy Pause/Resume hoặc chờ chiến dịch đó gửi xong." });
  const requested = database.recipients.filter((recipient) => selectedGroups.includes(recipient.group));
  if (!requested.length) return response.status(400).json({ error: "Chưa chọn đội hoặc nhóm email." });
  try { const transporter = getTransporter(); await transporter.verify(); } catch (error) { return response.status(400).json({ error: `SMTP chưa sẵn sàng: ${error.message}` }); }
  const fingerprint = contentFingerprint(subject, plainText);
  const seenInCycle = new Set();
  const recipients = requested.map((recipient) => {
    const base = { recipientId: recipient.id, email: recipient.email, name: recipient.name, group: recipient.group, token: newId("mail"), status: "queued", sentAt: null, error: null };
    if (seenInCycle.has(recipient.email)) return { ...base, status: "blocked", blockedReason: "Trùng email trong vòng gửi hiện tại" };
    seenInCycle.add(recipient.email);
    if (isRecentlySentSameContent(recipient.email, fingerprint)) return { ...base, status: "blocked", blockedReason: "Đã nhận cùng nội dung trong 3 ngày gần nhất" };
    return base;
  });
  const campaign = {
    id: newId("campaign"), createdAt: new Date().toISOString(), subject, plainText, htmlPreview: cleanText(request.body.htmlPreview), contentHash: fingerprint,
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
app.listen(port, () => { console.log(`Nodemail đang chạy tại http://localhost:${port}`); if (database.campaigns.some((campaign) => campaign.status === "running")) scheduleWorker(0); });
