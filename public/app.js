const state = { recipients: [], groups: {}, settings: {}, dashboard: null, knownCompleted: new Set(), pollTimer: null };
const $ = (selector) => document.querySelector(selector);
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function showToast(message, type = "") { const toast = $("#toast"); toast.textContent = message; toast.className = `show ${type}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.className = ""; }, 5000); }
async function request(url, options = {}) { const response = await fetch(url, options); const body = response.status === 204 ? null : await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Không thể hoàn thành yêu cầu."); return body; }
function selectedGroups() { return [...document.querySelectorAll(".group-check:checked")].map((input) => input.value); }
function renderRecipients(data) {
  state.recipients = data.recipients; state.groups = data.groups;
  const groups = Object.entries(data.groups).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  $("#groupList").innerHTML = groups.length ? groups.map(([name, count]) => `<label class="group"><input class="group-check" type="checkbox" value="${escapeHtml(name)}" checked><span>${escapeHtml(name)}</span><b>${count}</b></label>`).join("") : '<p class="empty">Chưa có email. Hãy nhập file đã phân nhóm.</p>';
  document.querySelectorAll(".group-check").forEach((input) => input.addEventListener("change", updateSelection)); updateSelection();
}
function updateSelection() {
  const count = state.recipients.filter((recipient) => selectedGroups().includes(recipient.group)).length;
  const delay = `${state.settings.delayMinMinutes || 1}–${state.settings.delayMaxMinutes || 2} phút/mail`;
  $("#recipientSummary").textContent = `${count.toLocaleString("vi-VN")} người nhận được chọn`;
  $("#sendHint").textContent = count ? `Sẽ xếp hàng ${count.toLocaleString("vi-VN")} email · ngẫu nhiên ${delay}.` : "Chọn ít nhất một đội trước khi gửi.";
  $("#sendButton").disabled = !count;
}
function refreshHtmlPreview() { $("#htmlFrame").srcdoc = $("#htmlPreview").value || "<p style='font-family:Arial;color:#6b7280'>Bản xem trước HTML xuất hiện ở đây.</p>"; }
function formatTime(value) { return value ? new Date(value).toLocaleString("vi-VN") : "—"; }
async function loadSettings() {
  state.settings = await request("/api/settings");
  $("#trackerUrl").textContent = state.settings.trackerBaseUrl; $("#gaId").textContent = state.settings.googleMeasurementId;
  $("#connectionState").textContent = state.settings.smtpConfigured ? "SMTP sẵn sàng" : "Cần cấu hình SMTP"; $("#connectionState").classList.toggle("ready", state.settings.smtpConfigured);
  $("#importSourceButton").hidden = !state.settings.defaultRecipientFileConfigured;
  $("#sourceFileName").textContent = state.settings.defaultRecipientFileConfigured ? state.settings.defaultRecipientFileName : "";
  $("#integrationCode").textContent = `// Chạy trên website khi có event ecommerce. Token đến từ utm_content.\nconst token = new URLSearchParams(location.search).get('utm_content');\nif (token) fetch('${state.settings.trackerBaseUrl}/event/{TOKEN}', {\n  method: 'POST', headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ event: 'add_to_cart' })\n});\n\n// event hợp lệ: add_to_cart, begin_checkout, purchase, view_link`;
}
async function importRecipients(file) { const form = new FormData(); form.append("file", file); $("#importMessage").textContent = "Đang đọc file…"; const result = await request("/api/recipients/import", { method: "POST", body: form }); renderRecipients(result.recipients); $("#importMessage").textContent = `Đã nhập ${result.imported} email mới${result.skippedInvalid ? ` · bỏ qua ${result.skippedInvalid} dòng không hợp lệ` : ""}.`; }
async function importDefaultSource() { $("#importSourceButton").disabled = true; try { const result = await request("/api/recipients/import-source", { method: "POST" }); renderRecipients(result.recipients); $("#importMessage").textContent = `Đã nhập ${result.imported} email từ file nguồn.`; } catch (error) { $("#importMessage").textContent = error.message; } finally { $("#importSourceButton").disabled = false; } }
function renderQueueStatus() {
  const active = state.dashboard?.campaigns?.find((campaign) => ["running", "paused"].includes(campaign.status));
  const target = $("#queueStatus");
  if (!active) { target.innerHTML = ""; return; }
  const action = active.status === "running" ? "pause" : "resume";
  const label = active.status === "running" ? "Pause gửi" : "Tiếp tục gửi";
  const next = active.status === "running" && active.nextSendAt ? ` · lượt tiếp theo ${formatTime(active.nextSendAt)}` : "";
  target.innerHTML = `<div><strong>${active.status === "running" ? "Đang gửi" : "Đã tạm dừng"}: ${escapeHtml(active.subject)}</strong><span>${active.sent}/${active.total} đã gửi · ${active.queued} đang chờ · ${active.blocked} bị chặn trùng${next}</span></div><button class="secondary" data-queue-action="${action}" data-campaign-id="${active.id}">${label}</button>`;
  target.querySelector("button").addEventListener("click", () => controlCampaign(active.id, action));
}
async function controlCampaign(id, action) { try { const result = await request(`/api/campaigns/${id}/${action}`, { method: "POST" }); showToast(action === "pause" ? "Đã pause. Lịch sử và hàng chờ đã được lưu." : "Đã tiếp tục gửi chiến dịch.", "success"); await loadDashboard(); renderQueueStatus(); } catch (error) { showToast(error.message, "error"); } }
async function queueCampaign() {
  const groups = selectedGroups(), subject = $("#subject").value.trim(), plainText = $("#plainText").value.trim();
  if (!subject || !plainText || !groups.length) return showToast("Hãy chọn đội, tiêu đề và nội dung Text.", "error");
  const total = state.recipients.filter((recipient) => groups.includes(recipient.group)).length;
  if (!confirm(`Xếp hàng gửi ${total} email? Mỗi mail cách nhau ngẫu nhiên 1–2 phút. Các email đã nhận đúng nội dung này trong 3 ngày sẽ bị chặn.`)) return;
  const button = $("#sendButton"); button.disabled = true; button.textContent = "Đang xếp hàng…";
  try {
    const result = await request("/api/campaigns/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, plainText, htmlPreview: $("#htmlPreview").value, utmCampaign: $("#utmCampaign").value, addGreeting: $("#addGreeting").checked, groups }) });
    showToast(`${result.message} ${result.campaign.queued} email đang chờ gửi.`, result.duplicateBlocked ? "error" : "success"); await loadDashboard(); renderQueueStatus();
  } catch (error) { showToast(error.message, "error"); } finally { button.textContent = "Xếp hàng gửi"; updateSelection(); }
}
function renderDashboard(data) {
  const wasRunning = new Set((state.dashboard?.campaigns || []).filter((campaign) => ["running", "paused"].includes(campaign.status)).map((campaign) => campaign.id));
  state.dashboard = data;
  data.campaigns.filter((campaign) => campaign.status === "completed" && wasRunning.has(campaign.id) && !state.knownCompleted.has(campaign.id)).forEach((campaign) => { state.knownCompleted.add(campaign.id); showToast(`Đã gửi xong “${campaign.subject}”: ${campaign.sent}/${campaign.total} email.`, campaign.failed ? "error" : "success"); });
  const totals = data.campaigns.reduce((result, campaign) => { ["sent", "clicked", "addedToCart", "checkout", "purchased"].forEach((key) => result[key] += campaign[key]); return result; }, { sent: 0, clicked: 0, addedToCart: 0, checkout: 0, purchased: 0 });
  $("#metricCards").innerHTML = [["Đã gửi", totals.sent], ["Bấm link", totals.clicked], ["Thêm giỏ", totals.addedToCart], ["Checkout", totals.checkout], ["Đã mua", totals.purchased]].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value.toLocaleString("vi-VN")}</strong></div>`).join("");
  const filter = $("#campaignFilter"), current = filter.value; filter.innerHTML = '<option value="">Tất cả</option>' + data.campaigns.map((campaign) => `<option value="${campaign.id}">${escapeHtml(campaign.subject)} · ${campaign.sent}/${campaign.total}</option>`).join(""); filter.value = current; renderTrackingRows(); renderQueueStatus();
}
function renderTrackingRows() {
  const campaignId = $("#campaignFilter").value, rows = (state.dashboard?.rows || []).filter((row) => !campaignId || row.campaignId === campaignId);
  $("#trackingRows").innerHTML = rows.length ? rows.map((row) => `<tr><td><strong>${escapeHtml(row.name || row.email)}</strong>${row.name ? `<small>${escapeHtml(row.email)}</small>` : ""}</td><td>${escapeHtml(row.group)}</td><td>${escapeHtml(row.campaignSubject)}</td><td><span class="status ${row.status.replaceAll(" ", "-").toLowerCase()}">${escapeHtml(row.status)}</span>${row.blockedReason ? `<small>${escapeHtml(row.blockedReason)}</small>` : ""}</td><td>${row.events.length ? row.events.map((event) => `<small>${escapeHtml(event.label)} · ${formatTime(event.createdAt)}</small>`).join("") : "—"}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">Chưa có dữ liệu theo điều kiện này.</td></tr>';
}
async function loadDashboard() { renderDashboard(await request("/api/dashboard")); }
function switchView(name) { document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === name)); document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name)); if (name === "tracking") loadDashboard().catch((error) => showToast(error.message, "error")); }
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#fileInput").addEventListener("change", async (event) => { if (event.target.files[0]) try { await importRecipients(event.target.files[0]); } catch (error) { $("#importMessage").textContent = error.message; } finally { event.target.value = ""; } });
$("#importSourceButton").addEventListener("click", importDefaultSource); $("#htmlPreview").addEventListener("input", refreshHtmlPreview); $("#sendButton").addEventListener("click", queueCampaign); $("#refreshDashboard").addEventListener("click", () => loadDashboard().then(() => showToast("Đã làm mới dữ liệu.", "success")).catch((error) => showToast(error.message, "error"))); $("#campaignFilter").addEventListener("change", renderTrackingRows);
$("#clearRecipients").addEventListener("click", async () => { if (state.recipients.length && confirm("Xóa toàn bộ danh sách người nhận đã nhập? Lịch sử gửi vẫn được giữ.")) { await request("/api/recipients", { method: "DELETE" }); renderRecipients({ recipients: [], groups: {} }); } });
(async () => { try { const [recipients] = await Promise.all([request("/api/recipients"), loadSettings(), loadDashboard()]); renderRecipients(recipients); refreshHtmlPreview(); state.pollTimer = setInterval(() => loadDashboard().catch(() => {}), 10_000); } catch (error) { showToast(error.message, "error"); } })();
