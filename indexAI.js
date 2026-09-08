const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const nodemailer = require("nodemailer");

// =========================================================================
// 1. TÀI KHOẢN & MẬT KHẨU MAIL
// =========================================================================
const SMTP_USER = "support@viluxzone.com";
const SMTP_PASS = "tranluongmmo98*#*#";

const HISTORY_FILE = path.join(__dirname, "sent_history.json");

// =========================================================================
// 2. CẤU HÌNH ĐỘ TRỄ NGẪU NHIÊN (60 ĐẾN 120 GIÂY)
// =========================================================================
const MIN_SECONDS = 60;   // 1 phút
const MAX_SECONDS = 120;  // 2 phút

// =========================================================================
// 3. CHỌN ĐỘI BÓNG & DÁN DANH SÁCH EMAIL
// =========================================================================
const SELECTED_CLUB = "Newcastle United";

const arr = [
  "denis.hunter11@outlook.co",
  "paulmcpake@live.co.uk",
  "jackielatcham@gmail.com",
  "robbie_w60@hotmail.co.uk",
  "dawnsmith60@outlook.com",
  "abrooks47@icloud.com",
  "brown22ajm@gmail.com",
  "linda293@hotmail.co.uk",
  "veecurry1616@gmail.com",
  "parkerp792@aol.com",
  "robertmiddleton246@gmail.com",
  "jimmyaa49@msn.com",
  "loganbell11@googlemail.com",
  "k.a.thompson2009@gmail.com",
  "tedshiel58@gmail.com",
  "jackylewis7@icloud.com",
  "glynnlambert@hotmail.co.uk",
  "l.robson1957@gmail.com",
  "neil.bridgewood@yahoo.com",
  "steve.ranson64@gmail.com",
  "jeanetteblacklock@yahoo.co.uk",
  "tonyomalley2013@gmail.com",
  "rob28251@outlook.com",
  "samejttocs@gmail.com",
  "forshaw.andrew@yahoo.com",
  "broncobilly0071@gmail.com",
  "m66huntington@hotmail.com",
  "george.hall.gh@googlemail.com",
  "dawnpendlebury3@googlemail.com",
  "turkishbobsut@live.co.uk",
  "maxinejolly@aol.com",
  "kerryann8219q@live.co.uk",
  "eileencolledge@live.co.uk",
  "frankieijones@yahoo.com",
  "coxsam41@gmail.com",
  "bobbyboost2000@yahoo.co.uk",
  "trevormoyle01@gmail.com",
  "abbyleigh1@sky.com",
  "madscott1970@yahoo.com",
  "davediamond67@outlook.com",
  "allanr@hotmail.co.uk",
  "southseasid@hotmail.co.uk",
  "val_morrison1947@icloud.com",
  "harrybenton@rocketmail.com",
  "freemanrobert69@yahoo.co.uk",
  "pdgascoigne52@gmail.com",
  "mickgutter@gmail.com",
  "jackielatcham@gmail.co",
  "psadlerpaul@aol.com",
  "helenede25@gmail.com",
  "aclasper1@hotmail.co.uk",
  "agcon@supanet.com",
  "marzimae8@gmail.com",
  "andreamcgregor5@outlook.com",
  "russellhenderson8911@gmail.com",
  "gedwilson26@gmail.com",
  "murdocd30@blueyonder.co.uk",
  "fairleyharry7@gmail.com",
  "chrisboylin123@hotmail.com",
  "bethanykatebarrass@gmail.com"
];

// =========================================================================
// 4. TIÊU ĐỀ & NỘI DUNG EMAIL
// =========================================================================
const subject = "Wear the black & white with pride ⚪⚫";

function getEmailContent(targetUrl, recipientEmail) {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #222222; max-width: 600px; margin: 0 auto;">
    <p>Dear Magpie,</p>
    <p>I am Qiana, manager from Viluxzone Store.</p>
    
    <p>Supporting Newcastle United isn’t just about watching a match—it’s about the noise at St. James' Park, the loyalty, and that unmistakable black-and-white pride.</p>
    <p>As a fellow supporter of the Toon Army, here’s a special thank-you from Viluxzone:</p>
    
    <p><strong style="color: #000;">20% off</strong> your next piece of Newcastle gear.</p>
    <p><strong>Your Code:</strong> <span style="background-color: #f1f1f1; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 16px;">EPL20</span></p>
    
    <p style="margin: 22px 0;">
      👉 <strong><a href="${targetUrl}" target="_blank" rel="noopener noreferrer" style="color: #0b57d0; text-decoration: underline; font-size: 16px;">Explore the Collection</a></strong>
    </p>
    
    <p><em>Gear up before matchday. Code valid for the next 30 days.</em></p>
    
    <p style="margin-top: 18px;">
      Howay the Lads!<br>
      <strong>Qiana</strong> | Viluxzone Support
    </p>
    
    <hr style="border: none; border-top: 1px solid #eaeaea; margin: 24px 0;">
    
    <div style="font-size: 13px; color: #666666;">
      <div>Official website: <a href="https://www.viluxzone.com/?utm_source=email&utm_medium=footer" target="_blank" rel="noopener noreferrer" style="color: #666666;">https://www.viluxzone.com</a></div>
      <div>Facebook Official: <a href="https://www.facebook.com/viluxzone.official" target="_blank" rel="noopener noreferrer" style="color: #666666;">https://www.facebook.com/viluxzone.official</a></div>
      <div style="margin-top: 6px;">2026 &copy; Viluxzone</div>
      <div style="text-align: left; margin-top: 10px;">
        <img src="https://img.thesitebase.net/files/10251165/2025/06/26/1750919312d1e0951694.jpeg?width=256&amp;height=0&amp;min_height=33" alt="Viluxzone" width="160" style="display: block; height: auto;" />
      </div>
    </div>
  </div>
  `;
}

// =========================================================================
// 5. DANH SÁCH COLLECTION LINK
// =========================================================================
const CLUB_COLLECTIONS = {
  "Newcastle United": "https://viluxzone.com/collections/newcastle-united-f-c",
  "Arsenal": "https://viluxzone.com/collections/ars",
  "Liverpool": "https://viluxzone.com/collections/fcuk",
  "Manchester United": "https://viluxzone.com/collections/mun",
  "Manchester City": "https://viluxzone.com/collections/mnc-fc",
  "Chelsea": "https://viluxzone.com/collections/ukchel",
  "Tottenham Hotspur": "https://viluxzone.com/collections/tottenham-hotspur",
  "Aston Villa": "https://viluxzone.com/collections/ast",
  "West Ham United": "https://viluxzone.com/collections/west-ham-united",
  "Everton": "https://viluxzone.com/collections/everton",
  "Brighton": "https://viluxzone.com/collections/brighton-hove-albion-f-c",
  "Brentford": "https://viluxzone.com/collections/brentford-f-c",
  "Crystal Palace": "https://viluxzone.com/collections/pal",
  "Wolverhampton Wanderers": "https://viluxzone.com/collections/wolverhampton-wanderer-f-c",
  "Nottingham Forest": "https://viluxzone.com/collections/nottingham-forest-f-c",
  "Fulham": "https://viluxzone.com/collections/ffc",
  "Bournemouth": "https://viluxzone.com/collections/a-f-c-bournemouth",
  "Leeds United": "https://viluxzone.com/collections/leeds-united",
  "Hull City AFC": "https://viluxzone.com/collections/hullcityafc"
};

// =========================================================================
// 6. TIỆN ÍCH: TẠO MÃ BĂM ĐỒNG THỜI (EMAIL + TIÊU ĐỀ + NỘI DUNG) & PAUSE/RESUME
// =========================================================================
let isPaused = false;

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch { return {}; }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
}

// Bóc tách văn bản cốt lõi (bỏ thẻ html, bỏ link động cá nhân hóa) để đối chiếu chính xác nội dung thư
function getCleanBodyText(html) {
  return html
    .replace(/https?:\/\/[^\s"'<>]+/gi, "") // Bỏ url để không bị lệch do uid cá nhân
    .replace(/<[^>]*>/g, " ")               // Bỏ thẻ html
    .replace(/\s+/g, " ")                   // Gom khoảng trắng thừa
    .trim()
    .toLowerCase();
}

// Sinh mã định danh duy nhất khi thỏa mãn: Đúng Email ĐÓ + Đúng Tiêu đề ĐÓ + Đúng Nội dung ĐÓ
function generateCampaignFingerprint(email, emailSubject, htmlContent) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanSub = emailSubject.trim().toLowerCase();
  const cleanBody = getCleanBodyText(htmlContent);

  return crypto
    .createHash("sha256")
    .update(`${cleanEmail}___${cleanSub}___${cleanBody}`, "utf8")
    .digest("hex");
}

function buildTrackedUrl(clubName, recipientEmail) {
  const baseUrl = CLUB_COLLECTIONS[clubName] || "https://viluxzone.com/collections";
  const campaign = clubName.toLowerCase().replace(/\s+/g, "_") + "_fans";
  const encodedEmail = encodeURIComponent(recipientEmail);

  return `${baseUrl}?utm_source=email&utm_medium=retargeting&utm_campaign=${campaign}&uid=${encodedEmail}&utm_content=cta_collection`;
}

function getRandomDelaySec(minSec, maxSec) {
  return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec);
}

function initKeyControls() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("keypress", (str, key) => {
    if (key.ctrl && key.name === "c") {
      console.log("\n\nĐã nhận lệnh thoát chương trình.");
      process.exit();
    }
    if (key.name === "p" || (key.name === "space" && !isPaused)) {
      if (!isPaused) {
        isPaused = true;
        process.stdout.write("\n⏸️  [ĐÃ TẠM DỪNG] Nhấn 'r' hoặc phím Space để tiếp tục gửi...\n");
      }
    } else if (key.name === "r" || (key.name === "space" && isPaused)) {
      if (isPaused) {
        isPaused = false;
        process.stdout.write("\n▶️  [TIẾP TỤC] Hệ thống đang chạy lại bình thường...\n");
      }
    }
  });
}

async function countdown(seconds) {
  let remaining = seconds;
  while (remaining > 0) {
    if (isPaused) {
      await new Promise((res) => setTimeout(res, 500));
      continue;
    }
    process.stdout.write(`\r⏳ [ĐỢI] Chuẩn bị gửi email tiếp theo sau: ${remaining} giây... (Nhấn 'p' để tạm dừng) `);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!isPaused) remaining--;
  }
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

function askQuestion(query) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (ans) => {
      rl.close();
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      resolve(ans.trim().toLowerCase());
    });
  });
}

// =========================================================================
// 7. TIẾN HÀNH GỬI MAIL
// =========================================================================
async function main() {
  initKeyControls();

  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  const history = loadHistory();
  let skipAllDuplicates = false;

  console.log(`[BẮT ĐẦU] Đang chuẩn bị gửi cho đội: [${SELECTED_CLUB}]`);
  console.log(`[THIẾT LẬP] Tổng số email: ${arr.length} | Giãn cách: ${MIN_SECONDS}s - ${MAX_SECONDS}s/mail`);
  console.log(`[ĐIỀU KHIỂN] Nhấn 'p' / 'Space' = Pause | Nhấn 'r' / 'Space' = Resume | Ctrl+C = Thoát\n`);

  for (let i = 0; i < arr.length; i++) {
    while (isPaused) {
      await new Promise((res) => setTimeout(res, 500));
    }

    const recipient = arr[i].trim().toLowerCase();
    if (!recipient) continue;

    const personalizedUrl = buildTrackedUrl(SELECTED_CLUB, recipient);
    const emailHtml = getEmailContent(personalizedUrl, recipient);

    // Tạo mã kiểm tra thỏa mãn cả 3 điều kiện
    const fingerprint = generateCampaignFingerprint(recipient, subject, emailHtml);

    // Chỉ khi TRÙNG CẢ 3 (Email + Tiêu đề + Nội dung) mới hiện cảnh báo
    if (history[fingerprint] && !skipAllDuplicates) {
      console.log(`\n⚠️  [CẢNH BÁO TRÙNG LẶP HOÀN TOÀN: EMAIL + TIÊU ĐỀ + NỘI DUNG]`);
      console.log(`Email: ${recipient}`);
      console.log(`Tiêu đề: "${subject}"`);
      console.log(`Khách này ĐÃ TỪNG NHẬN bức thư có nội dung y hệt vào lúc: ${history[fingerprint].sentAt}`);

      const answer = await askQuestion(
        `👉 Bạn có muốn gửi tiếp thư này không? (y = Gửi lại / n = Bỏ qua / all = Gửi tất cả không hỏi lại): `
      );

      if (answer === "all") {
        skipAllDuplicates = true;
      } else if (answer !== "y" && answer !== "yes") {
        console.log(`⏭️  Đã bỏ qua: ${recipient}\n`);
        continue;
      }
    }

    try {
      await transporter.sendMail({
        from: `"Viluxzone Support" <${SMTP_USER}>`,
        to: recipient,
        subject: subject,
        html: emailHtml,
      });

      // Lưu lịch sử theo fingerprint
      history[fingerprint] = {
        email: recipient,
        club: SELECTED_CLUB,
        subject: subject,
        sentAt: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      };
      saveHistory(history);

      console.log(`✅ [${i + 1}/${arr.length}] Gửi thành công tới: ${recipient}`);
    } catch (err) {
      console.error(`❌ [${i + 1}/${arr.length}] Thất bại (${recipient}):`, err.message);
    }

    if (i + 1 < arr.length) {
      const waitSeconds = getRandomDelaySec(MIN_SECONDS, MAX_SECONDS);
      await countdown(waitSeconds);
    }
  }

  console.log("\n🎉 [HOÀN TẤT] Toàn bộ danh sách email đã được xử lý xong!");
  process.exit();
}

main().catch(console.error);