# Đặc tả MVP AI hỗ trợ báo giá cho team IT

Ngày: 13/10/2026  
Đối tượng: Team sản phẩm và kỹ thuật  
Trạng thái: Đề xuất yêu cầu ban đầu

## Mục tiêu

Xây dựng ứng dụng nhiều doanh nghiệp. Quản trị nền tảng tạo mẫu theo loại hình doanh nghiệp; mỗi doanh nghiệp quản lý danh mục và bảng giá riêng. Nhân viên nhập yêu cầu khách; AI trích xuất thông tin và hỗ trợ ghép sản phẩm; backend xác thực dữ liệu, áp dụng bảng giá và quy tắc tính để tạo báo giá nháp. Người có quyền duyệt trước khi gửi.

Giá, thuế, chiết khấu và tổng tiền được tính trong backend từ cấu hình đã xác nhận.

## Vai trò

| Vai trò | Quyền |
|---|---|
| Quản trị nền tảng | Tạo loại hình doanh nghiệp và phiên bản mẫu dùng chung. |
| Quản trị doanh nghiệp | Quản lý doanh nghiệp, người dùng, danh mục và bảng giá. |
| Nhân viên báo giá | Tạo yêu cầu, xem gợi ý, sửa bản nháp và gửi duyệt. |
| Quản trị doanh nghiệp | Tự duyệt hoặc trả lại báo giá để chỉnh sửa trong phạm vi doanh nghiệp. |

Backend giới hạn mọi truy vấn theo doanh nghiệp từ ngữ cảnh xác thực.

## Yêu cầu chức năng

### Mẫu báo giá

Mẫu cấu hình trường tiếp nhận yêu cầu, trường dòng hàng, bố cục báo giá và các chế độ tính giá được hỗ trợ. Mỗi trường có kiểu, nhãn, yêu cầu bắt buộc, quy tắc kiểm tra và mô tả. MVP có thể hỗ trợ giá cố định, theo đơn vị, theo bậc số lượng và phụ phí cấu hình.

Mỗi thay đổi mẫu tạo phiên bản mới. Báo giá cũ giữ phiên bản đã dùng. Quy tắc giá chỉ chọn từ các phép tính được hỗ trợ; không cho nhập mã thực thi tùy ý.

### Danh mục và bảng giá

Tối thiểu mỗi mặt hàng có mã, tên, mô tả, đơn vị, đơn giá, tiền tệ, trạng thái và thời hạn hiệu lực nếu có. Khi nhập tệp, hệ thống kiểm tra định dạng, chỉ ra lỗi theo dòng và yêu cầu người dùng xác nhận dữ liệu.

Nếu tìm kiếm thường không thấy mặt hàng, backend gửi yêu cầu cùng dữ liệu giá đã chuẩn hóa cho AI đối chiếu cách diễn đạt. Với bảng nhỏ có thể gửi toàn bộ; với bảng lớn chỉ gửi các dòng liên quan. Đầu ra phải trỏ đến mã hàng hiện hữu hoặc báo không tìm thấy.

### Phân tích yêu cầu

Nhân viên nhập nội dung yêu cầu và khách hàng. Backend gửi nội dung cần thiết cùng sản phẩm ứng viên cho OpenRouter. AI trả về cấu trúc tương đương:

    {
      "status": "matched",
      "items": [
        {
          "catalogItemId": "item-id-from-context",
          "quantity": 20,
          "unit": "bộ",
          "attributes": { "material": "gỗ" },
          "evidence": "Khách yêu cầu bàn gỗ"
        }
      ],
      "missingFields": ["kích thước", "địa điểm giao hàng"]
    }

status nhận matched, ambiguous hoặc not_found. Backend xác thực cấu trúc, mã mặt hàng, phạm vi doanh nghiệp, số lượng và trường bắt buộc. Khi chưa rõ, yêu cầu bổ sung hoặc chuyển nhân viên xử lý.

### Tính giá và trạng thái

Backend tra giá có hiệu lực và tính các dòng theo quy tắc cấu hình. Mỗi báo giá lưu ảnh chụp tên/mã hàng, số lượng, đơn vị, đơn giá, tiền tệ, thuế, chiết khấu, điều khoản, phiên bản mẫu và bảng giá. Sửa giá thủ công cần ghi người sửa, giá trước/sau và lý do.

Trạng thái đề xuất: draft, needs_info, pending_review, approved, sent, accepted, rejected, expired. Trong MVP, nhân viên thực hiện thao tác gửi sau khi báo giá được duyệt.

## Kiến trúc

    React + TypeScript
            │ HTTPS
            ▼
    Backend API TypeScript
      ├── Xác thực và phân quyền theo doanh nghiệp
      ├── Mẫu, danh mục và bảng giá
      ├── Dịch vụ AI ─────► OpenRouter
      ├── Dịch vụ tính giá
      └── Xuất PDF
            │
            ▼
         MongoDB

OpenRouter chỉ được gọi từ backend; khóa API ở cấu hình máy chủ, không gửi xuống trình duyệt. Structured Outputs có thể ép định dạng JSON Schema trên endpoint hỗ trợ; backend luôn xác thực kết quả. [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

MongoDB hỗ trợ tài liệu linh hoạt; bật schema validation cho dữ liệu quan trọng và thiết kế tài liệu phù hợp để hạn chế giao dịch nhiều tài liệu. [MongoDB Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/), [MongoDB Transactions](https://www.mongodb.com/docs/manual/core/transactions/)

## Mô hình dữ liệu đề xuất

| Collection | Nội dung |
|---|---|
| tenants | Doanh nghiệp, loại hình và cấu hình. |
| users | Tài khoản, vai trò và quyền theo doanh nghiệp. |
| businessTypes | Loại hình và mẫu mặc định. |
| quoteTemplates | Phiên bản trường, quy tắc, bố cục. |
| catalogItems | Mã hàng, mô tả, thuộc tính, doanh nghiệp. |
| priceBooks | Phiên bản bảng giá, tiền tệ, thời hạn. |
| priceEntries | Mặt hàng, đơn giá, đơn vị, bậc giá. |
| quoteRequests | Nội dung gốc, khách hàng, kết quả phân tích. |
| quotes | Dòng hàng chụp, tổng tiền, phiên bản và trạng thái. |
| auditLogs | Thay đổi mẫu/giá và hành động duyệt. |

Index ban đầu gồm index theo doanh nghiệp cho màn danh sách và unique compound index cho cặp doanh nghiệp + SKU, doanh nghiệp + số báo giá. [MongoDB Unique Indexes](https://www.mongodb.com/docs/manual/core/index-unique/)

## Luồng tìm sản phẩm khi không thấy

1. Xác thực người dùng và doanh nghiệp.

2. Giữ nội dung gốc, chuẩn hóa yêu cầu.

3. Tìm mã hàng, từ khóa và thuộc tính trong danh mục của doanh nghiệp đó.

4. Khi kết quả chưa đủ tốt, gửi bảng đã chuẩn hóa hoặc nhóm dòng liên quan cho AI.

5. AI trả về mã hàng hiện có, ambiguous hoặc not_found.

6. Backend xác thực mã, lấy giá và tính toán; trường hợp chưa rõ chuyển nhân viên.

7. Lưu bản nháp, dữ liệu nguồn và phiên bản bảng giá/mẫu.

Chỉ gửi dữ liệu thuộc doanh nghiệp hiện tại và các trường cần thiết cho việc ghép hàng. Không gửi giá vốn hoặc thông tin nhà cung cấp nếu không cần.

## Bảo mật và quyền riêng tư

- Backend lấy doanh nghiệp từ phiên đăng nhập, không tin mã doanh nghiệp do trình duyệt gửi.

- Tách quyền quản trị nền tảng khỏi quyền doanh nghiệp.

- Ghi log việc thay đổi giá, duyệt và gửi báo giá.

- Không ghi khóa API hoặc toàn bộ nội dung yêu cầu vào log.

- Chọn mô hình/nhà cung cấp theo chính sách lưu trữ phù hợp. Zero Data Retention áp dụng ở nhà cung cấp suy luận, không kiểm soát log ứng dụng. [OpenRouter Zero Data Retention](https://openrouter.ai/blog/insights/zero-data-retention/)

## Giao diện và API

Màn hình: quản trị mẫu, nhập bảng giá, danh mục, danh sách yêu cầu, chi tiết báo giá, hàng chờ duyệt và cấu hình doanh nghiệp.

API dự kiến: POST /price-books/import, POST /quote-requests, POST /quote-requests/{id}/analyze, POST /quotes/{id}/recalculate, POST /quotes/{id}/approve và GET /quotes/{id}/pdf. Mọi endpoint kiểm tra quyền và phạm vi doanh nghiệp; thao tác thay đổi dữ liệu xử lý an toàn khi client gửi lại yêu cầu do lỗi mạng.

## Ngoài phạm vi MVP

Đọc mọi định dạng PDF/ảnh, tự động gửi báo giá, tích hợp CRM/ERP, định giá mặt hàng chưa có trong bảng, tự tối ưu giá và dự báo doanh thu.
