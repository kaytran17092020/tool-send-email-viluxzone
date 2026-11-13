# Nodemail nội bộ

## Vercel

Trong bản online, mở **Cấu hình email Namecheap** ở đầu trang để nhập host, cổng, tài khoản và mật khẩu hộp thư. Mật khẩu được mã hóa AES-256-GCM bằng biến `SMTP_CONFIG_KEY` (32 byte ngẫu nhiên mã hóa base64), rồi lưu trong Blob private; API không trả mật khẩu về trình duyệt. Giữ khóa này ổn định khi redeploy. Nút **Kiểm tra kết nối** chỉ xác thực SMTP, không gửi thư.

Trên Vercel, cấu hình một Blob store **private** nối với project và giữ biến `BLOB_READ_WRITE_TOKEN`. Các biến SMTP giữ nguyên như `.env.example`; đặt `TRACKER_PUBLIC_URL` bằng domain HTTPS của app. Không upload `.env`, danh sách khách hàng hoặc lịch sử local lên GitHub.

App online lưu recipients, campaign, nội dung từng đội và lịch sử vào Blob private bằng ghi có kiểm tra ETag. Vercel Queues gọi `api/mail-worker.js` để gửi từng mail và hẹn lượt tiếp theo sau 1–2 phút. Không cần giữ tab hoặc máy tính bật. Khi kết quả gửi SMTP không xác định sau khi worker dừng đột ngột, chiến dịch được pause để kiểm tra thủ công thay vì tự gửi trùng.

Deployment Protection bảo vệ app quản trị. Nếu giữ bảo vệ trên toàn deployment, người nhận ngoài team cũng bị yêu cầu đăng nhập khi mở link tracking; cần cấu hình domain/tracking public cùng lớp xác thực quản trị phù hợp trước khi gửi chiến dịch thật. SMTP chưa được cấu hình sẽ hiển thị trong phần cài đặt và chặn tạo chiến dịch.

Giao diện nội bộ để nhập danh sách Excel đã phân nhóm, soạn email, gửi **Plain Text** qua SMTP và theo dõi đường đi của từng người nhận qua token riêng.

## Yêu cầu

- Node.js 20 trở lên
- Tài khoản SMTP gửi mail
- File danh sách khách hàng `.xlsx` hoặc `.csv` trên máy nội bộ

Repository không chứa `node_modules`, file `.env`, lịch sử gửi hoặc file danh sách khách hàng. Sau khi clone, cài dependency bằng `npm install` và đặt file Excel vào đường dẫn nội bộ của bạn.

## Chạy nhanh trên Windows

Nhấp đúp `Chay_Nodemail.bat`. Lần đầu ứng dụng sẽ cài thư viện cần thiết, tạo `.env` từ mẫu và mở file cấu hình để bạn điền mật khẩu SMTP cho `sale@viluxzone.com`. Lưu `.env`, đóng Notepad rồi nhấn Enter trong cửa sổ khởi chạy. Ứng dụng sẽ mở giao diện tại `http://127.0.0.1:3030`.

Các lần sau chỉ cần nhấp đúp `Chay_Nodemail.bat`. Server local chỉ nhận kết nối từ máy này. Cửa sổ terminal sẽ giữ log và có thể đóng để dừng app.

## Chạy thủ công

1. Chạy `npm install`.
2. Sao chép `.env.example` thành `.env`, rồi điền thông tin SMTP. Không ghi password vào JavaScript.
3. Với tracking thật, triển khai app lên một máy/domain có HTTPS public và đặt `TRACKER_PUBLIC_URL` bằng URL đó. Không dùng `localhost` trong email gửi ra ngoài.
4. Kiểm tra `DEFAULT_RECIPIENTS_FILE` trỏ tới file Excel nguồn. Nút **Dùng file nguồn đã cấu hình** sẽ nạp trực tiếp file này.
5. Chạy `npm start`, sau đó mở `http://127.0.0.1:3030`.

File `Viluxzone_EPL_Club_Email_Segments_V3.xlsx` trong thư mục dự án được cấu hình làm danh sách nguồn. Trong giao diện, nhấn **Dùng file Excel tổng** để nạp các email đã phân loại theo sheet/đội. App tạo một file danh sách riêng cho từng đội trong `data/team-files/` và lưu nội dung chiến dịch từng đội trong `data/team-content/`; hai thư mục này chỉ lưu trên máy và đã được `.gitignore` bảo vệ. Có thể tải CSV riêng của đội đang chọn ngay trên giao diện.

## Nhập recipients

File `.xlsx` hoặc `.csv` có cột `Email`. App tự nhận diện cột nhóm từ `Team`, `Group`, `Segment`, `Club`, `Đội`, `Nhóm` hoặc `Category`; nếu không có, tên sheet trở thành nhóm. Có thể chọn file riêng và gán thẳng cho một đội. App lấy tên từ `Name`, `Full Name`, `Customer Name`, `First Name` hoặc `Tên khách hàng`; không coi `First Purchase` là tên. Email trùng sẽ không được thêm lần nữa. Ngoài file nguồn, mục email thủ công nhận danh sách `.txt` hoặc dán mỗi địa chỉ một dòng.

## Hàng đợi gửi và chống trùng

- Mỗi lượt chọn một đội để dùng đúng tiêu đề, nội dung và link collection riêng. Nội dung chỉ được lưu khi bấm **Lưu nội dung riêng cho đội**. Link collection có thể chọn từ `CLUB_COLLECTIONS` hoặc dán link riêng; dùng biến `{{collection_url}}` trong nội dung để chèn tự động.
- Danh sách nhập tay có thể gửi riêng hoặc cùng email của một đội. Người chưa có trong workbook sẽ được thêm vào dữ liệu local sau khi tạo chiến dịch; tên trống được thay bằng “there” trong `{{name}}`.
- Bấm **Bắt đầu gửi** sẽ kiểm tra lịch sử trước. `sent_history.json` cũ chỉ lưu email/tiêu đề nên đối chiếu được hai trường này; các lần gửi mới lưu thêm dấu vân tay nội dung, để phát hiện trùng tiêu đề hoặc nội dung. Người dùng có thể xác nhận gửi lại hoặc bỏ qua người trùng.
- Thanh tiến độ cập nhật khoảng 2 giây/lần, nêu email đang gửi hoặc email gửi gần nhất; Pause/Resume giữ nguyên vị trí hàng đợi.
- Mỗi mail được gửi với khoảng chờ ngẫu nhiên từ 1 đến 2 phút. Bấm **Pause gửi** để dừng ngay sau mail đang xử lý, hoặc **Tiếp tục gửi** để chạy lại.
- Hàng đợi, lịch sử gửi, email lỗi và email bị chặn đều được lưu trong `data/mail-data.json`; khi khởi động lại, chiến dịch đang chạy sẽ tiếp tục.
- Nội dung được nhận diện bằng tiêu đề + Text trong app campaign history, cộng thêm kiểm tra `sent_history.json`. Email lặp trong cùng lượt bị gộp; email có lịch sử trùng bị hỏi trước, mặc định bỏ qua nếu người dùng không xác nhận gửi lại.
- Bật tùy chọn **Dear {{name}}** để tự thêm lời chào với tên lấy từ Excel; khách không có tên không bị thêm lời chào trống.

## Tracking và GA4

Mỗi URL trong nội dung Text được đổi sang đường dẫn `/r/{token}`. Khi khách bấm, Nodemail ghi event `click` và chuyển tiếp về website cùng các UTM: `utm_source=email`, `utm_medium=internal_nodemail`, `utm_campaign`, `utm_content={token}`, và `utm_term={group}`.

Measurement ID `G-029PNZ8EV2` chỉ cho GA4 biết dữ liệu tổng hợp nếu Google tag đã có trên website. Nó **không tự trả về** việc một email cụ thể đã thêm giỏ/checkout/mua hàng. Để dashboard Nodemail thấy từng khách, thêm lời gọi event hiển thị trong tab **Theo dõi khách hàng** vào các event ecommerce của website. Lời gọi đó lấy token từ `utm_content` và gửi `add_to_cart`, `begin_checkout` hoặc `purchase` về tracker.

Vì email Plain Text không có pixel mở mail, ứng dụng theo dõi click và các hành động sau click, không tuyên bố đo "open".
