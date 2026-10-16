# Giáo — AI hỗ trợ báo giá (pilot)

Ứng dụng pilot theo phạm vi trong [`docs/de-xuat-ai-ho-tro-bao-gia-CEO.md`](docs/de-xuat-ai-ho-tro-bao-gia-CEO.md): nhiều doanh nghiệp có dữ liệu được phân vùng theo hồ sơ doanh nghiệp trong MongoDB, nhập yêu cầu bằng văn bản, nhập bảng giá CSV/XLSX, gợi ý mặt hàng, tính giá phía máy chủ, duyệt và tải PDF. Đây là nền tảng thử nghiệm staging, chưa phải SaaS production.

## Công nghệ

- React + TypeScript + Vite cho giao diện trong `apps/web`.
- Express + TypeScript cho API trong `apps/api`; MongoDB lưu doanh nghiệp, tài khoản, danh mục, yêu cầu, báo giá và nhật ký.
- OpenRouter chỉ được gọi từ máy chủ. Khóa API không được gửi xuống trình duyệt.
- PDF dùng phông Roboto đi kèm `pdfmake` để hiển thị tiếng Việt.

## Cấu trúc workspace

- `apps/api`: API Express, xác thực, kết nối MongoDB và logic báo giá.
- `apps/web`: giao diện React/Vite; Vite middleware phục vụ giao diện trong môi trường phát triển, bản build tĩnh được Express phục vụ khi chạy production.
- `docs`: đặc tả kỹ thuật MVP và đề xuất sản phẩm.
- `.env`: cấu hình dùng chung; `PORT` là cổng duy nhất cho API và giao diện.

## Chạy trên máy phát triển

Yêu cầu Node.js 20.19+ và một MongoDB có thể truy cập từ máy chạy ứng dụng.

1. Cài dependencies và tạo cấu hình riêng:

   ```powershell
   yarn install
   Copy-Item .env.example .env
   ```

2. Cấu hình tài khoản admin đầu tiên trong `.env`:

   ```dotenv
   SEED_ADMIN_EMAIL=admin@congty.vn
   SEED_ADMIN_PASSWORD=mat-khau-dai-it-nhat-12-ky-tu
   SEED_ADMIN_NAME=Quản trị nền tảng
   SEED_ADMIN_COMPANY_NAME=Công ty ABC
   ```

   Mật khẩu cần dài từ 12 đến 200 ký tự; ứng dụng tự băm bằng scrypt rồi lưu tài khoản trong `users` và hồ sơ doanh nghiệp trong `companies`. Tài khoản seed có quyền quản trị nền tảng và dùng để đăng nhập `/admin`, nơi tạo từng doanh nghiệp cùng một tài khoản quản trị riêng. Mỗi doanh nghiệp có dữ liệu, cài đặt SMTP và Cloudinary riêng. Sau lần khởi động đầu tiên thành công, có thể xóa `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD`; quyền quản trị nền tảng đã được lưu trong MongoDB.

3. Cấu hình `PORT` (mặc định 3000) cho cả API và giao diện. Có thể đặt URI MongoDB trong `MONGODB_URI`; nếu URI không có tên database, ứng dụng dùng `MONGODB_DATABASE` hoặc `bao_gia_pilot`. Để kết nối MongoDB local không xác thực, để trống user và password. `SESSION_SECRET` cần là chuỗi ngẫu nhiên dài ít nhất 32 ký tự. Nếu muốn gọi AI, thêm khóa vào `OPENROUTER_API_KEY`; có thể chọn model qua `OPENROUTER_MODEL`.

4. Chạy ứng dụng:

   ```powershell
   yarn dev
   ```

   Mở giao diện và API tại `http://localhost:3013` theo giá trị mẫu trong `.env`. Express phục vụ API và Vite middleware trên cùng một cổng; không cần chạy proxy hoặc máy chủ frontend riêng. Nếu chưa đặt khóa OpenRouter, phân tích chỉ thử khớp chính xác mã/tên hàng; nhân viên vẫn có thể chọn mặt hàng thủ công từ danh mục.

## Nhập bảng giá

Tài khoản `admin` có thể nhập `.csv`, `.xlsx` hoặc `.xls` (trang dữ liệu đầu tiên, tối đa 2.000 dòng và 5 MB). Các cột bắt buộc: `sku`, `name`, `unit`, `price`. Cột tùy chọn: `description`, `currency`, `effectiveFrom`, `effectiveTo`.

Tên cột tiếng Việt cũng được nhận diện: `mã hàng`, `tên hàng`, `đơn vị tính`, `đơn giá`, `mô tả`, `tiền tệ`, `hiệu lực từ`, `hiệu lực đến`. Ngày hiệu lực dùng `YYYY-MM-DD`. Mã hàng được chuyển thành chữ hoa; mã trùng trong tệp làm dừng lượt nhập. Trùng với danh mục hiện tại sẽ cập nhật mặt hàng sau khi người dùng xác nhận bản xem trước.

## Luồng pilot

1. Admin nhập bảng giá và khai báo mẫu báo giá tại mục **Mẫu báo giá** trong menu.
2. Popup tạo báo giá có dropdown chọn mẫu (chọn sẵn mẫu mặc định), dropdown chọn bảng giá và ô nhập yêu cầu hoặc tải file yêu cầu. File hỗ trợ TXT, PDF, DOCX, CSV, XLS, XLSX, tối đa 10 MB. AI nhận mẫu và đúng bảng giá đã chọn cùng yêu cầu của khách; nhân viên xác nhận thông tin khách hàng và mặt hàng sau khi phân tích.
3. Máy chủ đọc giá hiệu lực, chụp tên/mã/đơn vị/đơn giá và tính tạm tính, thuế, tổng tiền.
4. Nhân viên chỉnh số lượng và gửi duyệt. Quản trị viên của doanh nghiệp có thể duyệt hoặc trả lại với lý do.
5. Sau khi được doanh nghiệp duyệt, nhân viên tải file đúng định dạng mẫu hoặc gửi file đó qua SMTP đã cấu hình. Báo giá cũ chưa gắn mẫu vẫn xuất PDF như trước.

## Mẫu báo giá theo doanh nghiệp

Mỗi doanh nghiệp có một mẫu mặc định, hỗ trợ `.docx`, `.xlsx` và `.pdf` (tối đa 10 MB). Trong menu **Mẫu báo giá**, bấm **Tạo mẫu** để nhập tên và chọn file trong popup. Mẫu được lưu trong MongoDB, không phụ thuộc Cloudinary. Chỉ admin doanh nghiệp được thay mẫu; người dùng chỉ truy cập mẫu thuộc doanh nghiệp của mình. Mỗi lần thay tạo một phiên bản mới. Yêu cầu đã bắt đầu và báo giá đã tạo giữ phiên bản mẫu ban đầu.

Doanh nghiệp tải mẫu đang dùng, không cần thêm placeholder, trường đặt tên sẵn hoặc khai báo số dòng sản phẩm. Upload chỉ kiểm tra định dạng và khả năng đọc file, không bắt mẫu có trường khách hàng/tổng tiền. Khi phân tích yêu cầu và tạo bản nháp, hệ thống gửi nội dung mẫu cho OpenRouter: Word/Excel dưới dạng XML giữ cấu trúc, định dạng và ô dữ liệu; PDF gửi nguyên file base64 cùng kích thước trang. Word/Excel giới hạn nội dung gửi AI ở 600.000 ký tự; mẫu lớn hơn vẫn lưu được nhưng bước AI sẽ báo không xử lý được trong một lần.

AI xác định vị trí thay dữ liệu và cách bố trí các dòng sản phẩm dựa trên mẫu và dữ liệu báo giá. Giá/số lượng/tổng tiền vẫn do máy chủ tính và điền qua tham chiếu nội bộ, không lấy giá minh họa trong mẫu. Cách điền được kiểm tra và lưu cùng báo giá; tải file/gửi email sử dụng cách điền đã lưu, không gọi AI lại. Khi sửa số lượng, file dùng giá trị mới; nếu thay số dòng thì hệ thống xác định lại cách điền. Mẫu cũ và báo giá đã tạo trước thay đổi này vẫn được hỗ trợ.

File đầu ra giữ định dạng gốc. Word/Excel áp dụng các thay đổi vào XML của file gốc; các phần logo, kiểu trình bày và tài nguyên khác được giữ trong file. PDF không cần AcroForm: AI chọn vùng để ghi dữ liệu lên trang nền, vùng dữ liệu minh họa cũ có thể được phủ nền trắng (không phải xóa/redact nội dung gốc). Nếu AI trả kết quả thiếu dữ liệu, sai cấu trúc, vị trí PDF chồng nhau hoặc không vừa trang thì hệ thống báo lỗi để thử lại, không trả nguyên mẫu như báo giá hoàn tất. Cần cấu hình `OPENROUTER_API_KEY` và model hỗ trợ structured outputs; xử lý PDF phụ thuộc khả năng đọc file/OCR của model/provider. Kiểm tra bố cục với mẫu thực tế trước khi gửi khách vì cách điền do AI xác định.

Kiểm thử xử lý mẫu: `node --import tsx --test apps/api/src/quote-template.test.ts`.

## Tài khoản doanh nghiệp

Khách truy cập có thể chọn “Đăng ký doanh nghiệp” ngay trên màn hình đăng nhập. Biểu mẫu yêu cầu tên doanh nghiệp, mã số thuế, địa chỉ, điện thoại, email doanh nghiệp, người đại diện, họ tên người quản trị, email đăng nhập và mật khẩu. Tài khoản đăng ký đầu tiên có quyền quản trị doanh nghiệp và được đăng nhập ngay sau khi tạo. Quản trị nền tảng cũng có thể tạo, cập nhật hồ sơ, khóa tài khoản hoặc đặt lại mật khẩu tại `/admin`. Tài khoản doanh nghiệp không có quyền truy cập `/admin`; quản trị viên doanh nghiệp tự duyệt hoặc trả lại báo giá.

## Gửi báo giá qua email

Quản trị viên của từng doanh nghiệp bấm biểu tượng người dùng ở thanh bên, mở trang cá nhân rồi vào phần cài đặt email và nhập thông tin SMTP riêng của doanh nghiệp: máy chủ, cổng, kiểu kết nối, tên đăng nhập, mật khẩu và địa chỉ người gửi. Mỗi bộ cấu hình được lưu riêng trong hồ sơ doanh nghiệp; mật khẩu được mã hóa AES-256-GCM trước khi lưu và không được trả về giao diện.

Với cổng 587, chọn STARTTLS (`secure=false`); với cổng 465, chọn TLS (`secure=true`). Có thể lưu cấu hình rồi dùng nút kiểm tra kết nối trước khi gửi báo giá. Nhân viên có thể gửi PDF của báo giá đã duyệt tới email khách hàng; SMTP sẽ dùng cấu hình của doanh nghiệp sở hữu báo giá.

Khóa mã hóa mật khẩu SMTP được dẫn xuất từ `SESSION_SECRET`. Khi thay khóa phiên, hãy nhập lại mật khẩu SMTP của doanh nghiệp để mã hóa lại bằng khóa mới.

Trạng thái mẫu: `needs_info`, `draft`, `pending_review`, `approved`, `rejected`. Thuế lấy từ `DEFAULT_TAX_RATE` dưới dạng số thập phân (`0.08` là 8%); mặc định hiện tại là 0% cho tới khi đầu mối nghiệp vụ xác nhận mức áp dụng. Tính giá pilot hiện hỗ trợ đơn giá theo đơn vị và thuế; chưa có chiết khấu, phụ phí, bậc số lượng hay mẫu PDF theo thương hiệu.

## Triển khai staging

Workflow CI/CD và cách chạy Docker image: [`docs/ci-cd.md`](docs/ci-cd.md).

```powershell
yarn install
yarn build
yarn start
```

`yarn start` chạy API và phục vụ giao diện production trên cùng `PORT`. Bản frontend tĩnh được tạo trong `apps/web/dist`. Khi đặt sau HTTPS, cấu hình reverse proxy hoặc nền tảng hosting để chuyển toàn bộ lưu lượng tới tiến trình này và đặt `SESSION_COOKIE_SECURE=true`. Cần có MongoDB, tài khoản người dùng và khóa phiên riêng của staging trước khi khởi động. Giới hạn chi tiêu OpenRouter phải được cấu hình trên tài khoản OpenRouter; ứng dụng chưa tự đặt hạn mức USD.

## Quyền riêng tư và giới hạn

- Nội dung yêu cầu tự do được gửi tới OpenRouter khi bật AI. Mã, tên, mô tả và đơn vị của tối đa 40 sản phẩm ứng viên cũng được gửi để đối chiếu; giá, email khách hàng và giá vốn không được gửi.
- Dùng dữ liệu đã ẩn thông tin nhạy cảm trong pilot và xác nhận chính sách nhà cung cấp trước khi dùng yêu cầu thật. Không bật log nội dung yêu cầu.
- Mỗi doanh nghiệp có hồ sơ trong collection `companies`; tài khoản đăng nhập lưu mã doanh nghiệp tham chiếu đến hồ sơ đó. Máy chủ lấy mã từ tài khoản đã xác thực và tự giới hạn truy vấn theo mã này; client không thể tự chọn doanh nghiệp trong API. Vẫn cần đánh giá bảo mật trước khi dùng production.
- Nhật ký ghi các lần nhập giá, phân tích, tạo/sửa/gửi/duyệt/trả lại báo giá và thay đổi cài đặt SMTP. Mật khẩu SMTP được mã hóa trước khi lưu trong MongoDB.
- PDF hiện là mẫu tối giản, chưa có logo, thông tin pháp nhân, điều khoản thương mại hay thời hạn hiệu lực do chưa có dữ liệu doanh nghiệp.
- Ngoài phạm vi: ảnh đầu vào, gửi email tự động, CRM/ERP, nhiều cấp duyệt, bảng giá nhiều bậc, dựng mẫu tổng quát, phân tích giá mặt hàng chưa có và vận hành SaaS production.

## Lưu trữ tệp và ảnh trên Cloudinary

Quản trị viên mở biểu tượng người dùng, vào trang cá nhân và nhập Cloud name, API key, API secret lấy từ Cloudinary. API secret được mã hóa AES-256-GCM trong hồ sơ doanh nghiệp; cấu hình và tệp được tách theo từng doanh nghiệp. Tệp tải lên dùng chế độ authenticated, được giới hạn 10 MB và hỗ trợ ảnh PNG/JPG/WEBP/GIF, PDF, CSV, XLS và XLSX. Danh sách trong trang cá nhân chỉ hiển thị tên, dung lượng và ngày tải lên.

Khi nhập bảng giá hợp lệ, ứng dụng lưu tệp nguồn lên Cloudinary trước khi hiển thị bước xác nhận nhập. Tài khoản cần cấu hình Cloudinary trước khi tải tệp lên.

## API chính

- `POST /api/catalog/import/preview` và `POST /api/catalog/import/confirm`
- `POST /api/quote-requests`, `POST /api/quote-requests/:id/analyze`
- `POST /api/quotes`, `PATCH /api/quotes/:id`, `POST /api/quotes/:id/submit-review`
- `POST /api/quotes/:id/approve`, `POST /api/quotes/:id/reject`, `GET /api/quotes/:id/pdf`, `POST /api/quotes/:id/email`
- `GET /api/settings/email`, `PUT /api/settings/email`, `POST /api/settings/email/test`, `DELETE /api/settings/email`
- `GET /api/settings/cloudinary`, `PUT /api/settings/cloudinary`, `DELETE /api/settings/cloudinary`, `GET /api/files`, `POST /api/files`

Các API dữ liệu yêu cầu phiên đăng nhập; mọi truy vấn được giới hạn theo tenant của phiên. Hai API tạo yêu cầu và báo giá yêu cầu `idempotencyKey` để gửi lại cùng thao tác không tạo dữ liệu trùng.
