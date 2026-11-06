const state = { recipients: [], groups: {}, settings: {}, collections: {}, teams: [], dashboard: null, knownCompleted: new Set(), pollTimer: null, activeTeam: "", contentDirty: false };
const $ = (selector) => document.querySelector(selector);
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function showToast(message, type = "") { const toast = $("#toast"); toast.textContent = message; toast.className = `show ${type}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.className = ""; }, 5000); }
async function request(url, options = {}) { const response = await fetch(url, options); const body = response.status === 204 ? null : await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Không thể hoàn thành yêu cầu."); return body; }
function selectedGroups() { return [...document.querySelectorAll(".group-check:checked")].map((input) => input.value); }
function manualAddresses() { return [...new Set($("#manualEmails").value.split(/[\r\n,;\t ]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]; }
function defaultTeamMessage(group) {
  const label = group || "football";
  return {
    subject: `A fresh look for ${label} fans`,
    plainText: `We’ve put together a fresh Viluxzone collection inspired by ${label} colours and matchday spirit.\n\nBrowse the collection here:\n{{collection_url}}\n\nThanks for being part of the Viluxzone community.\n\nBest regards,\nViluxzone Team.`,
    htmlPreview: "",
    collectionUrl: state.collections[group] || "",
  };
}
function renderRecipients(data) {
  state.recipients = data.recipients; state.groups = data.groups;
  const groups = Object.entries(data.groups).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  const selected = selectedGroups()[0] || "";
  $("#groupList").innerHTML = groups.length ? groups.map(([name, count]) => { const team = state.teams.find((item) => item.group === name); return `<label class="group"><input class="group-check" name="targetGroup" type="radio" value="${escapeHtml(name)}" ${name === selected ? "checked" : ""}><span>${escapeHtml(name)} <small>· ${escapeHtml(team?.fileName || teamFileName(name))} · ${team?.historyCount || 0} lượt lịch sử · ${team?.contentSaved ? "đã có nội dung riêng" : "chưa lưu nội dung"}</small></span><b>${count}</b></label>`; }).join("") : '<p class="empty">Chưa có email. Hãy nhập file đã phân nhóm.</p>';
  const groupOptions = groups.map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${count} email</option>`).join("");
  for (const id of ["teamSelector", "teamFileGroup"]) {
    const select = $(`#${id}`), current = select.value;
    select.innerHTML = `${id === "teamSelector" ? '<option value="">Chỉ dùng danh sách nhập tay</option>' : '<option value="">Chọn đội…</option>'}${groupOptions}`;
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    else if (id === "teamSelector" && selected) select.value = selected;
    else if (id === "teamFileGroup" && selected) select.value = selected;
  }
  updateCollectionPicker();
  document.querySelectorAll(".group-check").forEach((input) => input.addEventListener("change", async () => { const previousTeam = state.activeTeam; if (state.contentDirty && previousTeam && previousTeam !== input.value) await saveTeamContent(previousTeam).catch((error) => showToast(error.message, "error")); updateSelection(); $("#teamSelector").value = input.value; updateCollectionPicker(); loadTeamContent(input.value).catch((error) => showToast(error.message, "error")); })); updateSelection();
  if ($("#teamSelector").value) { $("#teamSelector").value = selected || $("#teamSelector").value; loadTeamContent($("#teamSelector").value).catch((error) => showToast(error.message, "error")); }
}
function teamFileName(group) { return `${String(group).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team"}.json`; }
function updateSelection() {
  const count = state.recipients.filter((recipient) => selectedGroups().includes(recipient.group)).length;
  const manualCount = manualAddresses().length;
  $("#manualCount").textContent = `${manualCount} email nhập tay (đã loại dòng trùng)`;
  const delay = `${state.settings.delayMinMinutes || 1}–${state.settings.delayMaxMinutes || 2} phút/mail`;
  const total = new Set([...state.recipients.filter((recipient) => selectedGroups().includes(recipient.group)).map((recipient) => recipient.email.toLowerCase()), ...manualAddresses()]).size;
  $("#recipientSummary").textContent = `${count.toLocaleString("vi-VN")} trong đội · ${manualCount} nhập tay · ${total.toLocaleString("vi-VN")} tổng unique`;
  $("#sendHint").textContent = total ? `Sẽ gửi tối đa ${total.toLocaleString("vi-VN")} email · ${delay} · chỉ một đội mỗi lượt.` : "Chọn một đội hoặc nhập danh sách email thủ công.";
  $("#sendButton").disabled = !total;
  $("#exportTeamButton").disabled = !selectedGroups().length;
  if ($("#teamSelector").value !== (selectedGroups()[0] || "")) $("#teamSelector").value = selectedGroups()[0] || "";
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
async function loadTeams() { state.teams = await request("/api/teams"); }
function updateCollectionPicker() {
  const picker = $("#collectionPicker"), currentGroup = $("#teamSelector")?.value || selectedGroups()[0] || "";
  const options = Object.entries(state.collections).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  picker.innerHTML = '<option value="">Tự nhập link bên cạnh</option>' + options.map(([club, url]) => `<option value="${escapeHtml(url)}">${escapeHtml(club)}</option>`).join("");
  const defaultUrl = state.collections[currentGroup] || "";
  if (defaultUrl) { picker.value = defaultUrl; $("#collectionUrl").value = defaultUrl; }
  else picker.value = "";
}
async function loadTeamContent(group) {
  if (!group) return;
  const stored = await request(`/api/team-content?group=${encodeURIComponent(group)}`);
  const values = stored.subject || stored.plainText ? stored : defaultTeamMessage(group);
  $("#subject").value = values.subject || "";
  $("#plainText").value = values.plainText || "";
  $("#htmlPreview").value = values.htmlPreview || "";
  $("#collectionUrl").value = values.collectionUrl || state.collections[group] || "";
  updateCollectionPicker();
  $("#collectionUrl").value = values.collectionUrl || state.collections[group] || "";
  refreshHtmlPreview();
  state.activeTeam = group; state.contentDirty = false;
  $("#contentSaveStatus").textContent = stored.updatedAt ? `Đã lưu riêng cho ${group} · ${formatTime(stored.updatedAt)}` : `Nội dung nháp riêng cho ${group}; bấm Lưu để lưu file.`;
}
async function saveTeamContent(groupOverride = "") {
  const group = groupOverride || $("#teamSelector").value || selectedGroups()[0];
  if (!group) return showToast("Chọn đội để lưu nội dung riêng.", "error");
  const response = await request("/api/team-content", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group, subject: $("#subject").value, plainText: $("#plainText").value, htmlPreview: $("#htmlPreview").value, collectionUrl: $("#collectionUrl").value }) });
  const team = state.teams.find((item) => item.group === group); if (team) team.contentSaved = true;
  state.activeTeam = group; state.contentDirty = false;
  $("#contentSaveStatus").textContent = `Đã lưu file riêng ${teamFileName(group)} · ${formatTime(response.updatedAt)}`;
  showToast(`Đã lưu nội dung riêng cho ${group}.`, "success");
}
async function importRecipients(file, forcedGroup = "") { const form = new FormData(); form.append("file", file); $("#importMessage").textContent = "Đang đọc file…"; const result = await request(`/api/recipients/import${forcedGroup ? `?group=${encodeURIComponent(forcedGroup)}` : ""}`, { method: "POST", body: form }); await loadTeams(); renderRecipients(result.recipients); $("#importMessage").textContent = `Đã nhập ${result.imported} email${forcedGroup ? ` vào ${forcedGroup}` : " từ workbook"}${result.skippedInvalid ? ` · bỏ qua ${result.skippedInvalid} dòng không hợp lệ` : ""}.`; }
async function importDefaultSource() { $("#importSourceButton").disabled = true; try { const result = await request("/api/recipients/import-source", { method: "POST" }); await loadTeams(); renderRecipients(result.recipients); $("#importMessage").textContent = `Đã nhập ${result.imported} email từ file nguồn; dữ liệu được chia theo sheet/đội.`; } catch (error) { $("#importMessage").textContent = error.message; } finally { $("#importSourceButton").disabled = false; } }
function renderQueueStatus() {
  const active = state.dashboard?.campaigns?.find((campaign) => ["running", "paused"].includes(campaign.status)) || state.dashboard?.campaigns?.[0];
  const target = $("#queueStatus");
  if (!active) { target.innerHTML = ""; return; }
  const isActive = ["running", "paused"].includes(active.status);
  const action = active.status === "running" ? "pause" : "resume";
  const label = active.status === "running" ? "Pause gửi" : "Tiếp tục gửi";
  const stateLabel = active.status === "running" ? "Đang gửi" : active.status === "paused" ? "Đã tạm dừng" : active.failed ? "Hoàn tất, có email lỗi" : "Đã hoàn tất";
  const next = active.status === "running" && active.nextSendAt ? ` · lượt tiếp theo ${formatTime(active.nextSendAt)}` : "";
  const focusEmail = active.currentEmail ? `Đang gửi tới: ${active.currentEmail}` : active.lastSentEmail ? `Email gửi gần nhất: ${active.lastSentEmail} · ${formatTime(active.lastSentAt)}` : "Chưa có email gửi thành công.";
  target.innerHTML = `<div class="queue-main"><strong>${stateLabel}: ${escapeHtml(active.subject)}</strong><span>${active.sent}/${active.total} đã gửi · ${active.queued} đang chờ · ${active.failed} lỗi · ${active.blocked} trùng/lịch sử bị bỏ qua${next}</span><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, active.progressPercent || 0))}%"></div></div><small>${escapeHtml(focusEmail)}</small></div>${isActive ? `<button class="secondary" data-queue-action="${action}" data-campaign-id="${active.id}">${label}</button>` : ""}`;
  const button = target.querySelector("button"); if (button) button.addEventListener("click", () => controlCampaign(active.id, action));
}
async function controlCampaign(id, action) { try { const result = await request(`/api/campaigns/${id}/${action}`, { method: "POST" }); showToast(action === "pause" ? "Đã pause. Lịch sử và hàng chờ đã được lưu." : "Đã tiếp tục gửi chiến dịch.", "success"); await loadDashboard(); renderQueueStatus(); } catch (error) { showToast(error.message, "error"); } }
async function queueCampaign() {
  const groups = selectedGroups(), subject = $("#subject").value.trim(), plainText = $("#plainText").value.trim();
  const manualEmails = manualAddresses();
  if (!subject || !plainText || (!groups.length && !manualEmails.length)) return showToast("Chọn một đội hoặc nhập danh sách email, đồng thời điền tiêu đề và nội dung.", "error");
  if (groups.length > 1) return showToast("Mỗi lượt chỉ chọn một đội để tránh dùng nhầm nội dung của CLB khác.", "error");
  const button = $("#sendButton"); button.disabled = true; button.textContent = "Đang kiểm tra lịch sử…";
  const payload = { subject, plainText, htmlPreview: $("#htmlPreview").value, utmCampaign: $("#utmCampaign").value, addGreeting: $("#addGreeting").checked, groups, manualEmails: manualEmails.join("\n"), collectionUrl: $("#collectionUrl").value, funnel: $("#funnel").value };
  try {
    const preview = await request("/api/campaigns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let allowDuplicates = false;
    if (preview.duplicateCount) {
      const known = preview.duplicates.slice(0, 5).map((item) => item.email).join("\n");
      allowDuplicates = confirm(`${preview.duplicateCount} email đã có lịch sử trùng tiêu đề hoặc nội dung.\n${preview.duplicateHistory}\n\nVí dụ:\n${known}\n\nOK = cho gửi lại các email trùng. Cancel = bỏ qua email trùng, gửi các email còn lại.`);
    }
    const finalCount = preview.total - (allowDuplicates ? 0 : preview.duplicateCount);
    if (!confirm(`Bắt đầu gửi tối đa ${finalCount} email${preview.duplicateCount && !allowDuplicates ? ` (đã bỏ ${preview.duplicateCount} email trùng)` : ""}? Gửi sẽ bắt đầu thật nếu SMTP sẵn sàng.`)) return;
    button.textContent = "Đang tạo chiến dịch…";
    const result = await request("/api/campaigns/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, allowDuplicates }) });
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
$("#teamFileInput").addEventListener("change", async (event) => { const group = $("#teamFileGroup").value; if (!group) { showToast("Chọn đội trước khi nhập file riêng.", "error"); event.target.value = ""; return; } if (event.target.files[0]) try { await importRecipients(event.target.files[0], group); } catch (error) { $("#importMessage").textContent = error.message; } finally { event.target.value = ""; } });
$("#manualTxtInput").addEventListener("change", async (event) => { const file = event.target.files[0]; if (file) { $("#manualEmails").value = await file.text(); updateSelection(); } event.target.value = ""; });
$("#importSourceButton").addEventListener("click", importDefaultSource); $("#htmlPreview").addEventListener("input", refreshHtmlPreview); $("#sendButton").addEventListener("click", queueCampaign); $("#refreshDashboard").addEventListener("click", () => loadDashboard().then(() => showToast("Đã làm mới dữ liệu.", "success")).catch((error) => showToast(error.message, "error"))); $("#campaignFilter").addEventListener("change", renderTrackingRows);
$("#teamSelector").addEventListener("change", async () => { const group = $("#teamSelector").value, previousTeam = state.activeTeam; if (state.contentDirty && previousTeam && previousTeam !== group) await saveTeamContent(previousTeam).catch((error) => showToast(error.message, "error")); document.querySelectorAll(".group-check").forEach((input) => { input.checked = input.value === group; }); updateSelection(); updateCollectionPicker(); if (group) try { await loadTeamContent(group); } catch (error) { showToast(error.message, "error"); } else { state.activeTeam = ""; state.contentDirty = false; $("#subject").value = ""; $("#plainText").value = ""; $("#htmlPreview").value = ""; $("#collectionUrl").value = ""; refreshHtmlPreview(); $("#contentSaveStatus").textContent = "Danh sách nhập tay: hãy tự nhập tiêu đề và nội dung email."; } });
$("#collectionPicker").addEventListener("change", () => { $("#collectionUrl").value = $("#collectionPicker").value; markTeamContentDirty(); });
$("#collectionUrl").addEventListener("input", () => { const url = $("#collectionUrl").value; $("#collectionPicker").value = [...$("#collectionPicker").options].some((option) => option.value === url) ? url : ""; });
$("#saveTeamContent").addEventListener("click", () => saveTeamContent().catch((error) => showToast(error.message, "error")));
function markTeamContentDirty() { if (!state.activeTeam) return; state.contentDirty = true; $("#contentSaveStatus").textContent = `Có thay đổi chưa lưu cho ${state.activeTeam}; hệ thống sẽ lưu khi bạn chuyển đội.`; }
["#subject", "#plainText", "#htmlPreview", "#collectionUrl"].forEach((selector) => $(selector).addEventListener("input", markTeamContentDirty));
$("#manualEmails").addEventListener("input", updateSelection);
$("#exportTeamButton").addEventListener("click", () => { const group = selectedGroups()[0]; if (group) location.href = `/api/teams/export?group=${encodeURIComponent(group)}`; });
$("#clearRecipients").addEventListener("click", async () => { if (state.recipients.length && confirm("Xóa toàn bộ danh sách người nhận đã nhập? Lịch sử gửi vẫn được giữ.")) { await request("/api/recipients", { method: "DELETE" }); state.teams = []; renderRecipients({ recipients: [], groups: {} }); } });
(async () => { try { const [recipients] = await Promise.all([request("/api/recipients"), loadSettings(), loadDashboard(), loadTeams()]); state.collections = await request("/api/club-collections"); renderRecipients(recipients); refreshHtmlPreview(); state.pollTimer = setInterval(() => loadDashboard().catch(() => {}), 2_000); } catch (error) { showToast(error.message, "error"); } })();
