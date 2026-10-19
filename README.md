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
   ```

   Mật khẩu cần dài từ 7 đến 200 ký tự; ứng dụng tự băm bằng scrypt rồi lưu tài khoản admin trong `users`, độc lập với hồ sơ doanh nghiệp. Tài khoản admin duy nhất dùng để đăng nhập `/quan-tri` và quản lý các tài khoản doanh nghiệp. Doanh nghiệp tự đăng ký tài khoản user và dùng tài khoản đó để quản lý toàn bộ dữ liệu của mình. Nếu email seed đã thuộc một tài khoản doanh nghiệp, ứng dụng giữ nguyên tài khoản đó, tạo admin với email dạng `ten+system-admin@domain` (in ra terminal khi khởi động) và vẫn dùng mật khẩu seed. Sau lần khởi động đầu tiên thành công, có thể xóa `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD`; tài khoản admin đã được lưu trong MongoDB.

3. Cấu hình `PORT` (mặc định 3000) cho cả API và giao diện. Có thể đặt URI MongoDB trong `MONGODB_URI`; nếu URI không có tên database, ứng dụng dùng `MONGODB_DATABASE` hoặc `bao_gia_pilot`. Để kết nối MongoDB local không xác thực, để trống user và password. `SESSION_SECRET` cần là chuỗi ngẫu nhiên dài ít nhất 32 ký tự. Nếu muốn gọi AI, thêm khóa vào `OPENROUTER_API_KEY`; có thể chọn model qua `OPENROUTER_MODEL`.

4. Chạy ứng dụng:

   ```powershell
   yarn dev
   ```

   Mở giao diện và API tại `http://localhost:3013` theo giá trị mẫu trong `.env`. Express phục vụ API và Vite middleware trên cùng một cổng; không cần chạy proxy hoặc máy chủ frontend riêng. Nếu chưa đặt khóa OpenRouter, phân tích chỉ thử khớp chính xác mã/tên hàng; người dùng vẫn có thể chọn mặt hàng thủ công từ danh mục.

## Đường dẫn và SEO

Trang giới thiệu dùng `/`; đăng nhập dùng `/dang-nhap`, đăng ký dùng `/dang-ky`, không gian doanh nghiệp dùng `/ung-dung` và quản trị dùng `/quan-tri`. Các đường dẫn cũ `/login`, `/app` và `/admin` được chuyển hướng sang URL mới. Chỉ trang giới thiệu được đưa vào sitemap; các trang tài khoản và URL không tồn tại được đánh dấu không lập chỉ mục. Khi triển khai, đặt `PUBLIC_SITE_URL` thành origin HTTPS chính thức để canonical và sitemap luôn dùng đúng tên miền.

## Nhập bảng giá

Tài khoản doanh nghiệp tải `.csv`, `.xlsx` hoặc `.xls` lên tại mục **Bảng giá** (tối đa 5 MB mỗi file). Trước khi nhập, hệ thống hiển thị từng sheet, gợi ý dòng tiêu đề và cách ghép cột để người dùng kiểm tra. Mã hàng, tên, đơn vị, đơn giá, tiền tệ, mô tả và ngày hiệu lực được lưu vào trường chuẩn. Những cột khác được lưu thành thuộc tính riêng theo từng sản phẩm, nên mỗi doanh nghiệp có thể giữ các thông tin riêng như vật liệu, kích thước, thương hiệu, xuất xứ hoặc nhóm hàng. Người dùng có thể sửa các thuộc tính này trong danh sách sản phẩm; tìm kiếm cũng xét các thuộc tính đó.

Cách ghép cột được lưu theo doanh nghiệp và tự gợi ý cho file sau có cùng sheet và tiêu đề. Mã hàng đã có trong danh mục được cập nhật từ file vừa tải; nếu file không có mã, hệ thống tạo mã từ thông tin sản phẩm. Dòng thiếu tên hoặc đơn giá bị bỏ qua và số dòng được hiển thị sau khi nhập. Nếu một mã có nhiều tên hoặc giá khác nhau trong cùng file, hệ thống dừng nhập để tránh ghi giá sai. File gốc vẫn được lưu để xem lại.

Khi tạo báo giá, hệ thống chụp các thuộc tính sản phẩm vào từng dòng để dữ liệu không đổi nếu danh mục được cập nhật sau đó. Thông số sản phẩm và thuộc tính khách yêu cầu thêm được hiển thị riêng; file báo giá PDF và mẫu doanh nghiệp cũng nhận được các thông tin này.

## Luồng pilot

1. User của doanh nghiệp tải bảng giá lên; hệ thống tự tạo/cập nhật sản phẩm và đơn giá trong danh mục. User khai báo mẫu báo giá tại mục **Mẫu báo giá**.
2. Popup tạo báo giá chọn mẫu (chọn sẵn mẫu mặc định) và nhận yêu cầu bằng văn bản hoặc file. File hỗ trợ TXT, PDF, DOCX, CSV, XLS, XLSX, tối đa 10 MB. AI đối chiếu yêu cầu với danh mục sản phẩm đã nhập; user xác nhận thông tin khách hàng và mặt hàng sau khi phân tích.
3. Máy chủ đọc giá hiệu lực trong danh mục, chụp tên/mã/đơn vị/đơn giá và tính tạm tính, thuế, tổng tiền.
4. Tài khoản doanh nghiệp chỉnh số lượng, chuyển báo giá sang chờ duyệt, rồi duyệt hoặc trả lại với lý do.
5. Sau khi duyệt, tài khoản doanh nghiệp tải file đúng định dạng mẫu hoặc gửi file đó qua SMTP đã cấu hình. Báo giá cũ chưa gắn mẫu vẫn xuất PDF như trước.

## Mẫu báo giá theo doanh nghiệp

Mỗi doanh nghiệp có một mẫu mặc định, hỗ trợ `.docx`, `.xlsx` và `.pdf` (tối đa 10 MB). Trong menu **Mẫu báo giá**, bấm **Tạo mẫu** để nhập tên và chọn file trong popup. Mẫu được lưu trong MongoDB, không phụ thuộc Cloudinary. Tài khoản user của doanh nghiệp được thay mẫu và chỉ truy cập mẫu thuộc doanh nghiệp đó. Mỗi lần thay tạo một phiên bản mới. Yêu cầu đã bắt đầu và báo giá đã tạo giữ phiên bản mẫu ban đầu.

Doanh nghiệp tải mẫu đang dùng, không cần thêm placeholder, trường đặt tên sẵn hoặc khai báo số dòng sản phẩm. Upload chỉ kiểm tra định dạng và khả năng đọc file, không bắt mẫu có trường khách hàng/tổng tiền. Khi phân tích yêu cầu và tạo bản nháp, hệ thống gửi nội dung mẫu cho OpenRouter: Word/Excel dưới dạng XML giữ cấu trúc, định dạng và ô dữ liệu; PDF gửi nguyên file base64 cùng kích thước trang. Word/Excel giới hạn nội dung gửi AI ở 600.000 ký tự; mẫu lớn hơn vẫn lưu được nhưng bước AI sẽ báo không xử lý được trong một lần.

AI xác định vị trí thay dữ liệu và cách bố trí các dòng sản phẩm dựa trên mẫu và dữ liệu báo giá. Giá/số lượng/tổng tiền vẫn do máy chủ tính và điền qua tham chiếu nội bộ, không lấy giá minh họa trong mẫu. Cách điền được kiểm tra và lưu cùng báo giá; tải file/gửi email sử dụng cách điền đã lưu, không gọi AI lại. Khi sửa số lượng, file dùng giá trị mới; nếu thay số dòng thì hệ thống xác định lại cách điền. Mẫu cũ và báo giá đã tạo trước thay đổi này vẫn được hỗ trợ.

File đầu ra giữ định dạng gốc. Word/Excel áp dụng các thay đổi vào XML của file gốc; các phần logo, kiểu trình bày và tài nguyên khác được giữ trong file. PDF không cần AcroForm: AI chọn vùng để ghi dữ liệu lên trang nền, vùng dữ liệu minh họa cũ có thể được phủ nền trắng (không phải xóa/redact nội dung gốc). Nếu AI trả kết quả thiếu dữ liệu, sai cấu trúc, vị trí PDF chồng nhau hoặc không vừa trang thì hệ thống báo lỗi để thử lại, không trả nguyên mẫu như báo giá hoàn tất. Cần cấu hình `OPENROUTER_API_KEY` và model hỗ trợ structured outputs; xử lý PDF phụ thuộc khả năng đọc file/OCR của model/provider. Kiểm tra bố cục với mẫu thực tế trước khi gửi khách vì cách điền do AI xác định.

Kiểm thử xử lý mẫu: `node --import tsx --test apps/api/src/quote-template.test.ts`.

## Tài khoản doanh nghiệp

Khách truy cập có thể chọn “Đăng ký doanh nghiệp” ngay trên màn hình đăng nhập. Biểu mẫu yêu cầu thông tin doanh nghiệp, người đại diện, họ tên người dùng, email đăng nhập và mật khẩu. Mỗi doanh nghiệp có một tài khoản user gắn với hồ sơ doanh nghiệp đó; tài khoản đăng ký được đăng nhập ngay sau khi tạo và có thể quản lý, duyệt báo giá cùng các cài đặt của doanh nghiệp. Admin hệ thống cũng có thể tạo, cập nhật hồ sơ, khóa tài khoản hoặc đặt lại mật khẩu tại `/quan-tri`. Chỉ tài khoản admin hệ thống truy cập được `/quan-tri`.

## Gói dịch vụ và thanh toán SePay

Đăng ký thông thường bắt đầu ở gói Dùng thử. Khi khách chọn gói trả phí trên trang bảng giá, lựa chọn được giữ qua bước đăng ký; sau khi tạo tài khoản, ứng dụng tự mở QR thanh toán. Người dùng đang đăng nhập cũng có thể chọn hoặc gia hạn gói tại **Trang cá nhân → Chọn gói dịch vụ**. Gói chỉ đổi sau khi máy chủ nhận webhook SePay đã xác thực, đúng mã thanh toán và đủ số tiền. Mỗi giao dịch chỉ được áp dụng một lần; thời hạn là một tháng và được nối tiếp nếu gói hiện tại vẫn còn hiệu lực. Khi hết hạn, hệ thống tự chuyển doanh nghiệp về gói Dùng thử.

Cấu hình tài khoản nhận tiền tại **`/quan-tri` → Thanh toán**. Admin có thể nhập mã ngân hàng, số tài khoản, tên chủ tài khoản, tiền tố mã chuyển khoản và API Key webhook; API Key được mã hóa trước khi lưu. Các biến môi trường dưới đây vẫn được hỗ trợ làm cấu hình ban đầu/dự phòng khi chưa có giá trị lưu trong trang quản trị:

```dotenv
SEPAY_BANK_CODE=VCB
SEPAY_ACCOUNT_NUMBER=0123456789
SEPAY_ACCOUNT_NAME=TEN CHU TAI KHOAN
SEPAY_WEBHOOK_API_KEY=chuoi-bi-mat-tu-tao-va-cau-hinh-tren-sepay
SEPAY_PAYMENT_PREFIX=BG
```

Trong SePay, tạo webhook nhận **tiền vào** tại địa chỉ hiển thị trong trang **Thanh toán**, chọn xác thực **API Key** và nhập cùng khóa. Bật nhận diện mã thanh toán theo tiền tố đã cấu hình và hậu tố 10 ký tự chữ/số. QR chuyển khoản được tạo theo mã đơn, số tiền và nội dung riêng; ứng dụng không tự kích hoạt gói nếu thiếu webhook xác thực. Ngân hàng và số tài khoản dùng để nhận tiền phải thuộc tài khoản đã kết nối với webhook SePay. Không commit khóa webhook vào Git. Sau khi cấu hình, dùng tính năng gửi thử webhook của SePay rồi kiểm tra một giao dịch nhỏ trên môi trường staging trước khi nhận thanh toán thật.

## Gửi báo giá qua email

Tài khoản user của doanh nghiệp bấm biểu tượng người dùng ở thanh bên, mở trang cá nhân rồi vào phần cài đặt email và nhập thông tin SMTP riêng của doanh nghiệp: máy chủ, cổng, kiểu kết nối, tên đăng nhập, mật khẩu và địa chỉ người gửi. Mỗi bộ cấu hình được lưu riêng trong hồ sơ doanh nghiệp; mật khẩu được mã hóa AES-256-GCM trước khi lưu và không được trả về giao diện.

Với cổng 587, chọn STARTTLS (`secure=false`); với cổng 465, chọn TLS (`secure=true`). Có thể lưu cấu hình rồi dùng nút kiểm tra kết nối trước khi gửi báo giá. Tài khoản doanh nghiệp có thể gửi báo giá đã duyệt tới email khách hàng; SMTP sẽ dùng cấu hình của doanh nghiệp sở hữu báo giá.

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

- Nội dung yêu cầu tự do được gửi tới OpenRouter khi bật AI. Mã, tên, mô tả và đơn vị của tối đa 40 sản phẩm ứng viên cũng được gửi để đối chiếu; email khách hàng và giá vốn không được gửi trong bước này. Nếu file bảng giá không có tiêu đề cột nhận diện được, các dòng dữ liệu gồm cả giá được gửi tới OpenRouter để trích xuất sản phẩm. File có tiêu đề cột nhận diện được xử lý tại máy chủ.
- Dùng dữ liệu đã ẩn thông tin nhạy cảm trong pilot và xác nhận chính sách nhà cung cấp trước khi dùng yêu cầu thật. Không bật log nội dung yêu cầu.
- Mỗi doanh nghiệp có hồ sơ trong collection `companies`; tài khoản đăng nhập lưu mã doanh nghiệp tham chiếu đến hồ sơ đó. Máy chủ lấy mã từ tài khoản đã xác thực và tự giới hạn truy vấn theo mã này; client không thể tự chọn doanh nghiệp trong API. Vẫn cần đánh giá bảo mật trước khi dùng production.
- Nhật ký ghi các lần nhập giá, phân tích, tạo/sửa/gửi/duyệt/trả lại báo giá và thay đổi cài đặt SMTP. Mật khẩu SMTP được mã hóa trước khi lưu trong MongoDB.
- PDF hiện là mẫu tối giản, chưa có logo, thông tin pháp nhân, điều khoản thương mại hay thời hạn hiệu lực do chưa có dữ liệu doanh nghiệp.
- Ngoài phạm vi: ảnh đầu vào, gửi email tự động, CRM/ERP, nhiều cấp duyệt, bảng giá nhiều bậc, dựng mẫu tổng quát, phân tích giá mặt hàng chưa có và vận hành SaaS production.

## Lưu trữ tệp và ảnh trên Cloudinary

User doanh nghiệp mở biểu tượng người dùng, vào trang cá nhân và nhập Cloud name, API key, API secret lấy từ Cloudinary. API secret được mã hóa AES-256-GCM trong hồ sơ doanh nghiệp; cấu hình và tệp được tách theo từng doanh nghiệp. Tệp tải lên dùng chế độ authenticated, được giới hạn 10 MB và hỗ trợ ảnh PNG/JPG/WEBP/GIF, PDF, CSV, XLS và XLSX. Danh sách trong trang cá nhân chỉ hiển thị tên, dung lượng và ngày tải lên.

File bảng giá được lưu trong MongoDB làm tài liệu nguồn sau khi sản phẩm và đơn giá đã được trích xuất thành công. Không cần cấu hình Cloudinary để tải bảng giá lên.

## API chính

- `POST /api/catalog/import/preview` và `POST /api/catalog/import/confirm`
- `POST /api/billing/payments`, `GET /api/billing/payments/:id`, `POST /api/billing/sepay/webhook`
- `GET /api/admin/settings/sepay`, `PUT /api/admin/settings/sepay` (chỉ admin hệ thống)
- `POST /api/quote-requests`, `POST /api/quote-requests/:id/analyze`
- `POST /api/quotes`, `PATCH /api/quotes/:id`, `POST /api/quotes/:id/submit-review`
- `POST /api/quotes/:id/approve`, `POST /api/quotes/:id/reject`, `GET /api/quotes/:id/pdf`, `POST /api/quotes/:id/email`
- `GET /api/settings/email`, `PUT /api/settings/email`, `POST /api/settings/email/test`, `DELETE /api/settings/email`
- `GET /api/settings/cloudinary`, `PUT /api/settings/cloudinary`, `DELETE /api/settings/cloudinary`, `GET /api/files`, `POST /api/files`

Các API dữ liệu yêu cầu phiên đăng nhập; mọi truy vấn được giới hạn theo tenant của phiên. Webhook SePay là ngoại lệ: endpoint công khai nhưng bắt buộc xác thực API Key. Hai API tạo yêu cầu và báo giá yêu cầu `idempotencyKey` để gửi lại cùng thao tác không tạo dữ liệu trùng.
