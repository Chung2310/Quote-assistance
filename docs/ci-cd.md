# CI/CD và deploy VPS

Workflow build trên mỗi pull request/push. Push nhánh develop, nhánh mặc định hoặc tag v* sẽ publish image lên GHCR. Riêng develop tiếp tục **Deploy develop to VPS** qua SSH. Có thể chạy thủ công tại **Actions → CI/CD → Run workflow → develop**.

Deploy dùng digest image vừa build. Các lượt deploy chạy tuần tự; thiếu cấu hình hoặc health check thất bại sẽ làm job báo lỗi.

## Thiết lập một lần

VPS Linux x86_64 cần Docker Engine, Bash, tar và flock. Tài khoản SSH phải có quyền chạy Docker không cần nhập mật khẩu sudo.

Tại **Settings → Secrets and variables → Actions → Secrets**, thêm:

| Secret | Nội dung |
| --- | --- |
| VPS_HOST | IPv4 hoặc hostname VPS, không có https:// |
| VPS_USER | Tài khoản SSH chạy Docker |
| VPS_SSH_KEY | Private key riêng cho deploy, không có passphrase; public key tương ứng nằm trong authorized_keys của tài khoản VPS |
| VPS_KNOWN_HOSTS | Dòng known_hosts của VPS đã xác minh từ nguồn tin cậy; cổng khác 22 dùng dạng [host]:port |
| MONGODB_URI | URI MongoDB có tên database và truy cập được từ container |
| SESSION_SECRET | Chuỗi bí mật ít nhất 32 ký tự |

Secrets tùy chọn: MONGODB_USER và MONGODB_PASSWORD (đi cùng nhau), OPENROUTER_API_KEY, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, SEED_ADMIN_PASSWORD.

GitHub tự cấp GITHUB_TOKEN để publish/pull GHCR. Package phải cho repository này quyền truy cập trong GHCR Actions access.

Tại tab **Variables**, có thể khai báo:

| Variable | Mặc định |
| --- | --- |
| VPS_SSH_PORT | 22 |
| VPS_CONTAINER_NAME | bao-gia |
| VPS_APP_PORT | 3013 trên VPS |
| VPS_BIND_ADDRESS | 127.0.0.1, dùng reverse proxy trên VPS |
| SESSION_COOKIE_SECURE | true, dùng HTTPS |
| MONGODB_AUTH_SOURCE | admin |
| OPENROUTER_MODEL | openai/gpt-4.1-mini |
| DEFAULT_TAX_RATE | 0 |
| CURRENCY | VND |

Các variable tùy chọn khác: CLOUDINARY_CLOUD_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_COMPANY_NAME. Tài khoản seed cần cả email và password hoặc để cả hai trống.

Container dùng PORT=3013 và NODE_ENV=production. Mặc định cấu hình Nginx/Caddy HTTPS chuyển tới 127.0.0.1:3013. Nếu cần truy cập trực tiếp bên ngoài VPS, đặt VPS_BIND_ADDRESS=0.0.0.0 và mở cổng tương ứng. Reverse proxy chạy trong container cần cấu hình kết nối host phù hợp. localhost trong MONGODB_URI là chính container ứng dụng, không phải VPS.

## Trình tự deploy

1. Kiểm tra cấu hình và tạo env file tạm từ GitHub Secrets/Variables.
2. Xác minh SSH host key, chuyển file qua SSH. Env không được commit hoặc đưa vào image.
3. Đăng nhập GHCR bằng token tạm, pull image theo digest.
4. Chạy container thử không mở cổng và kiểm tra /api/health.
5. Giữ container cũ, tạo container mới với restart policy unless-stopped và kiểm tra health lần nữa.
6. Thành công mới xóa container cũ. Nếu lỗi khi chuyển container, thử khôi phục container cũ và đánh dấu job thất bại.

Có gián đoạn ngắn khi chuyển cổng. Rollback container không hoàn tác dữ liệu MongoDB.

File cấu hình và token tạm được dọn sau khi chạy. Khi mất kết nối hoặc hủy job cưỡng bức, kiểm tra thư mục /tmp/bao-gia-deploy.* trên VPS. Không in Docker inspect đầy đủ vì chứa environment credentials. Kiểm tra trạng thái bằng:

```sh
docker ps -a --filter name=bao-gia
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' bao-gia
curl --fail http://127.0.0.1:3013/api/health
```

Nếu pipeline dừng ở Deploy, xem step **Deploy and verify container**. Lỗi thiếu secret ghi đúng tên cần bổ sung; lỗi SSH cần kiểm tra key, host key và firewall; lỗi health cần xem log ứng dụng trực tiếp trên VPS. Không chia sẻ log chứa mật khẩu/URI kết nối.
