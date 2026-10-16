# Dữ liệu demo

Lệnh seed tạo ba công ty hư cấu để thử luồng nhiều doanh nghiệp. Mỗi công ty có một tài khoản quản trị, sáu mặt hàng trong danh mục, một file bảng giá Excel, một mẫu báo giá Word và ba yêu cầu khách hàng. Một yêu cầu trong mỗi công ty đã có kết quả khớp mẫu để thử tạo báo giá nhanh; các yêu cầu còn lại chờ phân tích.

Toàn bộ tên, địa chỉ, mã số thuế, khách hàng và giá là dữ liệu tổng hợp chỉ dùng để thử nghiệm. Email dùng miền `.example.test`.

## Chạy seed

Trong bản local, cấu hình `.env` để trỏ đúng database thử nghiệm rồi chạy từ thư mục gốc:

```sh
yarn seed:demo
```

Sau khi bản mới đã được deploy lên VPS, có thể chạy seed trong container đang dùng cấu hình MongoDB của ứng dụng:

```sh
docker exec bao-gia node /app/apps/api/dist/seed-demo.js --apply
```

Lệnh chỉ ghi dữ liệu khi có `--apply`. Chạy lại không tạo thêm bản sao; mật khẩu của tài khoản đã tồn tại được giữ nguyên. Khi tạo tài khoản lần đầu, lệnh sinh mật khẩu ngẫu nhiên và in thông tin đăng nhập ra đầu ra lệnh. Hãy lưu các mật khẩu này để đăng nhập.

## Tài khoản demo

| Doanh nghiệp | Email đăng nhập |
| --- | --- |
| Công ty Demo Thiết bị Văn phòng Ánh Dương | `anhduong.demo@example.test` |
| Công ty Demo Điện lạnh Lam Sơn | `lamson.demo@example.test` |
| Công ty Demo Bao bì Sông Xanh | `songxanh.demo@example.test` |

Mật khẩu được sinh khi seed lần đầu, không lưu trong mã nguồn. Nếu đã seed trước đó mà mất mật khẩu, dùng chức năng quản trị nền tảng để đặt lại.
