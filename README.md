# Nodemail nội bộ

Giao diện nội bộ để nhập danh sách Excel đã phân nhóm, soạn email, gửi **Plain Text** qua SMTP và theo dõi đường đi của từng người nhận qua token riêng.

## Yêu cầu

- Node.js 20 trở lên
- Tài khoản SMTP gửi mail
- File danh sách khách hàng `.xlsx` hoặc `.csv` trên máy nội bộ

Repository không chứa `node_modules`, file `.env`, lịch sử gửi hoặc file danh sách khách hàng. Sau khi clone, cài dependency bằng `npm install` và đặt file Excel vào đường dẫn nội bộ của bạn.

## Chạy ứng dụng

1. Chạy `npm install`.
2. Sao chép `.env.example` thành `.env`, rồi điền thông tin SMTP. Không ghi password vào JavaScript.
3. Với tracking thật, triển khai app lên một máy/domain có HTTPS public và đặt `TRACKER_PUBLIC_URL` bằng URL đó. Không dùng `localhost` trong email gửi ra ngoài.
4. Kiểm tra `DEFAULT_RECIPIENTS_FILE` trỏ tới file Excel nguồn. Nút **Dùng file nguồn đã cấu hình** sẽ nạp trực tiếp file này.
5. Chạy `npm start`, sau đó mở `http://localhost:3030`.

## Nhập recipients

File `.xlsx` hoặc `.csv` có cột `Email`. App tự nhận diện cột nhóm từ `Team`, `Group`, `Segment`, `Club`, `Đội`, `Nhóm` hoặc `Category`; nếu không có, tên sheet trở thành nhóm. App lấy tên từ các cột `Name`, `Full Name`, `Customer`, `First Name` hoặc `Tên`; email trùng sẽ không được thêm lần nữa.

## Hàng đợi gửi và chống trùng

- Admin chọn các đội, nhập tiêu đề/nội dung rồi bấm **Xếp hàng gửi**.
- Mỗi mail được gửi với khoảng chờ ngẫu nhiên từ 1 đến 2 phút. Bấm **Pause gửi** để dừng ngay sau mail đang xử lý, hoặc **Tiếp tục gửi** để chạy lại.
- Hàng đợi, lịch sử gửi, email lỗi và email bị chặn đều được lưu trong `data/mail-data.json`; khi khởi động lại, chiến dịch đang chạy sẽ tiếp tục.
- Nội dung được nhận diện bằng tiêu đề + Text. Một địa chỉ đã nhận đúng nội dung đó trong ba ngày gần nhất sẽ bị chặn và hiển thị lý do. Email lặp trong cùng một lần chọn cũng bị chặn.
- Bật tùy chọn **Dear {{name}}** để tự thêm lời chào với tên lấy từ Excel; khách không có tên không bị thêm lời chào trống.

## Tracking và GA4

Mỗi URL trong nội dung Text được đổi sang đường dẫn `/r/{token}`. Khi khách bấm, Nodemail ghi event `click` và chuyển tiếp về website cùng các UTM: `utm_source=email`, `utm_medium=internal_nodemail`, `utm_campaign`, `utm_content={token}`, và `utm_term={group}`.

Measurement ID `G-029PNZ8EV2` chỉ cho GA4 biết dữ liệu tổng hợp nếu Google tag đã có trên website. Nó **không tự trả về** việc một email cụ thể đã thêm giỏ/checkout/mua hàng. Để dashboard Nodemail thấy từng khách, thêm lời gọi event hiển thị trong tab **Theo dõi khách hàng** vào các event ecommerce của website. Lời gọi đó lấy token từ `utm_content` và gửi `add_to_cart`, `begin_checkout` hoặc `purchase` về tracker.

Vì email Plain Text không có pixel mở mail, ứng dụng theo dõi click và các hành động sau click, không tuyên bố đo "open".
