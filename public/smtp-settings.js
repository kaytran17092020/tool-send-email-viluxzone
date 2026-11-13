(async () => {
  const panel = document.getElementById("smtpSettingsPanel");
  const form = document.getElementById("smtpSettingsForm");
  const message = document.getElementById("smtpMessage");
  const field = (name) => document.getElementById(`smtp${name}`);
  async function call(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Không lưu được cấu hình.");
    return data;
  }
  try {
    const config = await call("/api/smtp-settings");
    if (!config.editable) { panel.hidden = true; return; }
    field("Host").value = config.host;
    field("Port").value = String(config.port);
    field("User").value = config.user;
    field("From").value = config.from;
    panel.open = !config.passwordSaved;
    message.textContent = config.passwordSaved ? "Đã có cấu hình SMTP." : "Cần nhập tài khoản và mật khẩu hộp thư.";
  } catch (error) { message.textContent = error.message; }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const buttons = form.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await call("/api/smtp-settings", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: field("Host").value, port: Number(field("Port").value), secure: field("Port").value === "465",
          user: field("User").value, password: field("Password").value, from: field("From").value }) });
      field("Password").value = "";
      message.textContent = "Đã lưu mã hóa. Bấm Kiểm tra kết nối trước khi gửi.";
      await loadSettings();
    } catch (error) { message.textContent = error.message; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  });
  field("Verify").addEventListener("click", async (event) => {
    event.target.disabled = true;
    message.textContent = "Đang kết nối Namecheap…";
    try { const result = await call("/api/smtp-verify", { method: "POST" }); message.textContent = result.message; }
    catch (error) { message.textContent = error.message; }
    finally { event.target.disabled = false; }
  });
})();
