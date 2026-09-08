require("dotenv").config();
const nodemailer = require("nodemailer");

const PASS = process.env.SMTP_PASS;
const arr = [
  "tranluongit98@gmail.com",
  // Thêm các email khác vào đây...
];

const subject = "Wear the black & white with pride ⚪⚫";

// Địa chỉ domain server tracking chạy file tracker_server.js
const TRACKER_BASE_URL = "https://your-tracker-domain.com"; 

function getEmailContent(recipientEmail) {
  // Link gốc trang sản phẩm kèm UTM cho Google Analytics
  const targetWebUrl = `https://viluxzone.com/collections/newcastle-united-f-c?utm_source=email&utm_medium=retargeting&utm_campaign=newcastle_fans`;

  // Link trung gian đi qua tracker_server.js
  const trackedClickUrl = `${TRACKER_BASE_URL}/track/click?email=${encodeURIComponent(
    recipientEmail
  )}&url=${encodeURIComponent(targetWebUrl)}`;

  const footerWebUrl = `${TRACKER_BASE_URL}/track/click?email=${encodeURIComponent(
    recipientEmail
  )}&url=${encodeURIComponent("https://viluxzone.com")}`;

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #222222; max-width: 600px; margin: 0 auto;">
    <p>Dear customer,</p>
    <p>I am Qiana, manager from Viluxzone Store.</p>
    
    <p>Supporting Newcastle United isn’t just about watching a match—it’s about the noise at St. James' Park, the loyalty, and that unmistakable black-and-white pride.</p>
    <p>As a fellow supporter of the Toon Army, here’s a special thank-you from Viluxzone:</p>
    
    <p><strong style="color: #000;">20% off</strong> your next piece of Newcastle gear.</p>
    <p><strong>Your Code:</strong> <span style="background-color: #f1f1f1; padding: 2px 6px; border-radius: 4px; font-weight: bold;">EPL20</span></p>
    
    <!-- Link nút bấm trỏ qua Tracker -->
    <p style="margin: 22px 0;">
      👉 <strong><a href="${trackedClickUrl}" target="_blank" rel="noopener noreferrer" style="color: #0b57d0; text-decoration: underline; font-size: 16px;">Explore the Newcastle United Collection</a></strong>
    </p>
    
    <p><em>Gear up before matchday. Code valid for the next 30 days.</em></p>
    
    <p style="margin-top: 18px;">
      Howay the Lads!<br>
      <strong>Qiana</strong> | Viluxzone Support
    </p>
    
    <hr style="border: none; border-top: 1px solid #eaeaea; margin: 24px 0;">
    
    <div style="font-size: 13px; color: #666666;">
      <div>Official website: <a href="${footerWebUrl}" target="_blank" rel="noopener noreferrer" style="color: #666666;">https://www.viluxzone.com</a></div>
      <div>Facebook Official: <a href="https://www.facebook.com/viluxzone.official" target="_blank" rel="noopener noreferrer" style="color: #666666;">https://www.facebook.com/viluxzone.official</a></div>
      <div style="margin-top: 6px;">2026 &copy; Viluxzone</div>
      <div style="text-align: left; margin-top: 10px;">
        <img src="https://img.thesitebase.net/files/10251165/2025/06/26/1750919312d1e0951694.jpeg?width=256&amp;height=0&amp;min_height=33" alt="Viluxzone" width="160" style="display: block; height: auto;" />
      </div>
    </div>
  </div>
  `;
}

async function main() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mail.privateemail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  for (let i = 0; i < arr.length; i++) {
    const recipient = arr[i];
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipient,
        subject: subject,
        html: getEmailContent(recipient),
      });

      console.log(`[${i + 1}/${arr.length}] Sent to: ${recipient}`);

      if (arr.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`Failed to send to ${recipient}:`, err.message);
    }
  }
}

main().catch(console.error);
