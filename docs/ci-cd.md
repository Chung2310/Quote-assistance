# CI/CD và deploy VPS

Workflow build trên mỗi pull request/push. Push develop, nhánh mặc định hoặc tag v* sẽ publish image lên GHCR. Riêng develop tiếp tục deploy qua SSH. Chạy thủ công: **Actions → CI/CD → Run workflow → develop**.

## Cấu hình GitHub

Tại **Settings → Secrets and variables → Actions**, chỉ cần:

| Loại | Tên | Giá trị |
| --- | --- | --- |
| Secret | SSH_HOST | IPv4 hoặc hostname VPS, không có https:// |
| Secret | SSH_USER | Tài khoản SSH có quyền chạy Docker |
| Secret | SSH_KEY | Private key không có passphrase; public key tương ứng nằm trong authorized_keys trên VPS |
| Secret | SSH_PORT | Cổng SSH, ví dụ 22 |
| Variable | ENV_FILE | Toàn bộ nội dung file .env, không phải đường dẫn |

ENV_FILE chứa cấu hình ứng dụng, gồm MONGODB_URI và SESSION_SECRET ít nhất 32 ký tự. Các giá trị OPENROUTER_API_KEY, model, SMTP/storage hoặc cấu hình khác của ứng dụng cũng đặt trong file này theo .env.example. Không cần khai báo từng giá trị thành GitHub Secrets/Variables riêng.

Ví dụ cấu trúc ENV_FILE (thay bằng cấu hình thật):
```dotenv
PORT=3013
MONGODB_URI=mongodb://database-host:27017/bao_gia
SESSION_SECRET=replace-with-at-least-32-random-characters
SESSION_COOKIE_SECURE=true
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4.1-mini
```

Parser hỗ trợ dấu nháy, comment và xuống dòng CRLF của dotenv; không chạy nội dung như shell script. Giá trị nhiều dòng không được hỗ trợ bởi Docker env-file. Nội dung ENV_FILE không được in trong log, commit hoặc đưa vào image. NODE_ENV được đặt thành production; PORT lấy từ ENV_FILE, mặc định 3013.

GITHUB_TOKEN do GitHub tự cấp để publish/pull GHCR, không cần thêm secret này. Package GHCR cần cấp quyền truy cập cho repository.

## VPS

VPS Linux x86_64 cần Docker Engine, Bash, tar, flock. SSH_USER phải có quyền chạy Docker không cần nhập mật khẩu sudo.

SSH dùng accept-new: nhận host key ở lần kết nối đầu của job, sau đó kiểm tra cùng key trong các kết nối còn lại. Không yêu cầu secret known_hosts riêng.

Container tên bao-gia, restart policy unless-stopped. Image hiển thị theo tag nhánh từ GHCR, ví dụ `ghcr.io/<owner>/<repository>:develop`; bản deploy vẫn được pull theo digest. Cổng host bằng PORT trong ENV_FILE, bind 127.0.0.1. Cấu hình Nginx/Caddy trên VPS chuyển HTTPS tới 127.0.0.1:3013 (hoặc PORT bạn chọn). MongoDB phải truy cập được từ container; localhost trong URI là container ứng dụng, không phải VPS.

Nếu MongoDB chạy trong container trên cùng VPS, deploy tự tìm network từ hostname/alias trong MONGODB_URI. Nếu URI dùng localhost/127.0.0.1, deploy tìm container đang publish đúng cổng MongoDB rồi chuyển host/port sang địa chỉ nội bộ của container đó; user/password/database/query được giữ nguyên. Không sửa variable ENV_FILE trên GitHub. Nếu có nhiều container trùng cổng hoặc không tìm được container, deploy dừng và báo rõ. MongoDB chạy trực tiếp trên host không được tự chuyển theo cơ chế này.

Có thể thêm DOCKER_NETWORK=tên-network vào chính ENV_FILE để chỉ định network, không cần thêm GitHub Secret/Variable. Container thử và container chính đều dùng network này. Với Docker default bridge, kết nối dùng IP nội bộ; nếu MongoDB được tạo lại và đổi IP, cần deploy lại ứng dụng. Với network riêng, dùng DNS tên container.

## Deploy và kiểm tra lỗi

Deploy dùng digest image vừa build; các lượt chạy tuần tự:
1. Kiểm tra bốn SSH secrets và ENV_FILE, tạo file cấu hình tạm.
2. Truyền file qua SSH và pull image.
3. Chạy container thử không mở cổng; kiểm tra /api/health.
4. Giữ container cũ, chuyển sang container mới và kiểm tra health.
5. Thành công mới xóa container cũ. Nếu lỗi khi chuyển, thử khôi phục container cũ và đánh dấu job thất bại.

Có gián đoạn ngắn khi chuyển cổng; rollback container không hoàn tác dữ liệu MongoDB. File cấu hình và token tạm được dọn sau khi chạy. Khi hủy cưỡng bức hoặc mất kết nối, kiểm tra /tmp/bao-gia-deploy.* trên VPS.

```sh
docker ps -a --filter name=bao-gia
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' bao-gia
curl --fail http://127.0.0.1:3013/api/health
```

Nếu pipeline dừng, xem step **Deploy and verify container**. Lỗi thiếu cấu hình ghi đúng tên cần bổ sung. Không chia sẻ log có mật khẩu hoặc URI kết nối.

Health check dừng sớm nếu container đã exited/dead. Trước khi dọn container lỗi, deploy in tối đa 100 dòng startup log với các giá trị cấu hình và credentials đã che. Điều này giúp phân biệt lỗi MongoDB, tài khoản seed và thiếu module thay vì chỉ có exit code 1.
