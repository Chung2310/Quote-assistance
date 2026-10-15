# CI/CD

Workflow `.github/workflows/ci-cd.yml` build API và giao diện trên mọi pull request và lần push. Workflow cài dependencies đúng theo `yarn.lock`, sau đó chạy `yarn build`.

Sau khi build thành công, push lên nhánh mặc định hoặc tag phiên bản bắt đầu bằng `v` sẽ build và đẩy Docker image lên GitHub Container Registry (GHCR). Image được gắn tag theo tên nhánh/tag phiên bản và mã commit. Workflow dùng `GITHUB_TOKEN`, không cần tạo secret registry riêng. Package trên GHCR mặc định ở chế độ private, trừ khi đổi visibility trong GitHub.

## Cấu hình môi trường trên GitHub

`.env` không được commit hoặc đưa vào Docker image. Build và publish image không cần `.env`; ứng dụng nhận cấu hình lúc chạy qua environment của container. Trong GitHub, khai báo giá trị tại **Settings → Secrets and variables → Actions**:

- Dùng **Secrets** cho `MONGODB_URI`, `MONGODB_USER`, `MONGODB_PASSWORD`, `SESSION_SECRET`, `OPENROUTER_API_KEY`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` và `SEED_ADMIN_PASSWORD`.
- Dùng **Variables** cho các giá trị không nhạy cảm như `PORT`, `SESSION_COOKIE_SECURE`, `MONGODB_AUTH_SOURCE`, `OPENROUTER_MODEL`, `OPENROUTER_APP_NAME`, `CLOUDINARY_CLOUD_NAME`, `DEFAULT_TAX_RATE`, `CURRENCY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` và `SEED_ADMIN_COMPANY_NAME`.

GitHub Variables/Secrets không tự động đi theo image GHCR. Bước deploy cần chuyển các giá trị này thành environment variables của container trên máy chủ. Vì chưa có máy chủ/nền tảng đích trong cấu hình, workflow hiện chưa có bước deploy để lấy chúng.

## Chạy image đã phát hành

Cung cấp cấu hình production qua secrets/environment của nền tảng triển khai hoặc file env chỉ lưu trên máy chủ. Không đưa `.env` vào image hay commit lên Git. Tối thiểu cần `MONGODB_URI` và `SESSION_SECRET` riêng, đủ mạnh; đặt `SESSION_COOKIE_SECURE=true` khi chạy sau HTTPS. Bổ sung các biến khác trong `.env.example` nếu cần. MongoDB phải truy cập được từ container; `localhost` bên trong container là chính container đó.

Trên máy chủ có Docker, đăng nhập GHCR nếu package ở chế độ private rồi chạy:

```sh
docker pull ghcr.io/OWNER/REPOSITORY:develop
docker run -d \
  --name bao-gia \
  --restart unless-stopped \
  --env-file /path/to/production.env \
  -p 3013:3013 \
  ghcr.io/OWNER/REPOSITORY:develop
```

Thay `OWNER/REPOSITORY` bằng tên GitHub viết thường. Ví dụ dùng tag `develop` vì nhánh mặc định được yêu cầu là `develop`. Đặt ứng dụng sau HTTPS và chuyển lưu lượng tới cổng 3013.

Pipeline phát hành image sẵn sàng triển khai; nó chưa kết nối hoặc khởi động lại máy chủ cụ thể nào. Tự động triển khai lên máy chủ cần biết nền tảng, địa chỉ đích và thông tin xác thực. Có thể lưu các thông tin đó trong GitHub environment secrets rồi thêm bước deploy phù hợp sau job `publish-image`.
