const { AsyncLocalStorage } = require("node:async_hooks");
const crypto = require("node:crypto");
const { get, put, del } = require("@vercel/blob");
const { QueueClient } = require("@vercel/queue");

const enabled = Boolean(process.env.VERCEL);
const contexts = new AsyncLocalStorage();
const queue = new QueueClient({ region: "sin1" });
const statePath = "nodemail/state.json";
const topic = "nodemail-send";

async function load() {
  const result = await get(statePath, { access: "private", useCache: false });
  if (!result) return { data: { recipients: [], campaigns: [], events: [] }, history: {}, teamContent: {}, etag: null, dirty: false, wake: null };
  const state = JSON.parse(await new Response(result.stream).text());
  return { ...state, etag: result.blob.etag, dirty: false, wake: null };
}

async function save(context) {
  if (!context.dirty) return;
  const options = { access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };
  if (context.etag) Object.assign(options, { allowOverwrite: true, ifMatch: context.etag });
  const result = await put(statePath, JSON.stringify({ data: context.data, history: context.history, teamContent: context.teamContent }), options);
  context.etag = result.etag;
  context.dirty = false;
}

function current() { return contexts.getStore(); }
function dirty() { current().dirty = true; }
function schedule(delayMs) { current().wake = Math.max(0, Math.ceil(delayMs / 1000)); }

async function publish(delay) {
  await queue.send(topic, { wake: crypto.randomUUID() }, { delaySeconds: delay, idempotencyKey: crypto.randomUUID() });
}

function middleware(request, response, next) {
  load().then((context) => contexts.run(context, () => {
    const originalEnd = response.end.bind(response);
    response.end = function (...args) {
      response.end = originalEnd;
      (async () => {
        await save(context);
        if (context.wake !== null) await publish(context.wake);
        originalEnd(...args);
      })().catch((error) => {
        console.error("Cloud persistence failed:", error.message);
        if (response.headersSent) return response.destroy(error);
        response.removeHeader("Content-Length");
        response.statusCode = 409;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        originalEnd(JSON.stringify({ error: "Dữ liệu đang thay đổi hoặc chưa lưu được. Tải lại và thử lại; không gửi lại chiến dịch nếu chưa kiểm tra dashboard." }));
      });
      return response;
    };
    next();
  })).catch(next);
}

async function transaction(update) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const context = await load();
    const value = update(context);
    try { await save(context); return value; } catch (error) {
      if (error.name !== "BlobPreconditionFailedError" && !/already exists/i.test(error.message)) throw error;
    }
  }
  throw new Error("Cloud data contention");
}

async function deliver(helpers) {
  const claimId = crypto.randomUUID();
  const claim = await transaction((context) => {
    const campaign = context.data.campaigns.find((item) => item.status === "running");
    if (!campaign) return null;
    const remaining = Date.parse(campaign.nextSendAt || "") - Date.now();
    if (remaining > 0) return { delay: Math.ceil(remaining / 1000) };
    if (campaign.recipients.some((recipient) => recipient.status === "sending")) {
      campaign.status = "paused";
      context.dirty = true;
      return null;
    }
    const recipient = campaign.recipients.find((item) => item.status === "queued");
    if (!recipient) {
      campaign.status = "completed";
      campaign.completedAt = new Date().toISOString();
      context.dirty = true;
      return null;
    }
    recipient.status = "sending";
    recipient.claimId = claimId;
    context.dirty = true;
    return { campaign: structuredClone(campaign), recipient: structuredClone(recipient) };
  });
  if (!claim) return;
  if (claim.delay) return publish(claim.delay);
  let sendError = null;
  try {
    await helpers.getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: claim.recipient.email,
      subject: helpers.personalize(claim.campaign.subject, claim.recipient),
      text: helpers.composeRecipientText(claim.campaign, claim.recipient),
    });
  } catch (error) { sendError = error.message; }
  const delay = await transaction((context) => {
    const campaign = context.data.campaigns.find((item) => item.id === claim.campaign.id);
    const recipient = campaign?.recipients.find((item) => item.claimId === claimId);
    if (!recipient || recipient.status !== "sending") return null;
    recipient.status = sendError ? "failed" : "sent";
    recipient.error = sendError;
    if (!sendError) {
      recipient.sentAt = new Date().toISOString();
      helpers.recordSent(context.history, { email: recipient.email, club: recipient.group,
        subject: helpers.personalize(campaign.subject, recipient), body: helpers.composeRecipientText(campaign, recipient), sentAt: recipient.sentAt });
    }
    helpers.finishCampaignIfDone(campaign);
    context.dirty = true;
    if (campaign.status !== "running") return null;
    const wait = helpers.randomDelay();
    campaign.nextSendAt = new Date(Date.now() + wait).toISOString();
    return Math.ceil(wait / 1000);
  });
  if (delay !== null) await publish(delay);
}

async function probe() {
  const pathname = `health/${crypto.randomUUID()}.json`;
  const uploaded = await put(pathname, '{"ok":true}', { access: "private", addRandomSuffix: false });
  try {
    const result = await get(uploaded.url, { access: "private", useCache: false });
    if (!result || !(await new Response(result.stream).json()).ok) throw new Error("Storage probe failed");
  } finally { await del(uploaded.url); }
}

async function queueProbe() {
  const result = await get("health/queue.json", { access: "private", useCache: false });
  const previous = result ? await new Response(result.stream).json() : null;
  await queue.send(topic, { probe: true }, { idempotencyKey: crypto.randomUUID() });
  return previous;
}

async function recordQueueProbe() {
  await put("health/queue.json", JSON.stringify({ processedAt: new Date().toISOString() }), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60,
  });
}

module.exports = { enabled, current, dirty, schedule, middleware, deliver, queue, probe, queueProbe, recordQueueProbe };
