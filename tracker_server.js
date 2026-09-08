const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000; // Bạn có thể đổi cổng tùy thích
const CSV_FILE = path.join(__dirname, "tracking_clicks.csv");

// Khởi tạo file CSV với tiêu đề cột nếu file chưa có
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(CSV_FILE, "Email,Vietnam_Time,UK_Time,Target_URL\n", "utf8");
}

app.get("/track/click", (req, res) => {
  const email = req.query.email || "Unknown";
  const redirectTarget = req.query.url || "https://viluxzone.com";

  const now = new Date();

  // Định dạng giờ Việt Nam (UTC+7)
  const vnTime = now.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });

  // Định dạng giờ UK (London - tự động cập nhật giờ mùa hè BST/GMT)
  const ukTime = now.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
  });

  // Dòng dữ liệu cần ghi vào file
  const logRow = `"${email}","${vnTime}","${ukTime}","${redirectTarget}"\n`;

  // Ghi nối tiếp vào file tracking_clicks.csv
  fs.appendFile(CSV_FILE, logRow, (err) => {
    if (err) console.error("Lỗi ghi file CSV:", err);
  });

  console.log(`[CLICK RECORDED] ${email} | VN: ${vnTime} | UK: ${ukTime}`);

  // Chuyển hướng khách hàng tới website Viluxzone
  res.redirect(redirectTarget);
});

app.listen(PORT, () => {
  console.log(`Tracking Server đang chạy tại: http://localhost:${PORT}`);
});