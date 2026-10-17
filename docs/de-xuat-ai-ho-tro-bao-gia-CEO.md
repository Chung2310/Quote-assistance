# Đề xuất dự án AI hỗ trợ báo giá cho CEO

Ngày: 13/10/2026  
Đối tượng: Ban điều hành  
Trạng thái: Đề xuất phạm vi khám phá và pilot

## Đề xuất điều hành

Xây dựng nền tảng giúp doanh nghiệp chuyển yêu cầu tự do của khách hàng thành báo giá nháp dựa trên danh mục và bảng giá đã được xác nhận. AI trích xuất nhu cầu và gợi ý mặt hàng phù hợp; backend lấy giá, áp dụng quy tắc thương mại và tính tổng. Tài khoản user của doanh nghiệp kiểm tra, duyệt rồi xuất báo giá.

Đề xuất bắt đầu với một nhóm doanh nghiệp hẹp, kiểm chứng quy trình với doanh nghiệp pilot, sau đó mới mở rộng. Cách làm này kiểm tra được nhu cầu thực tế và độ linh hoạt của mẫu báo giá trước khi đầu tư quy mô lớn.

## Cơ hội sản phẩm

Giả thuyết cần kiểm chứng là một số quy trình báo giá còn phụ thuộc vào bảng tính, kinh nghiệm nhân viên và tra cứu thủ công. Giá trị dự kiến gồm giảm thời gian tạo báo giá, chuẩn hóa cách trình bày, giảm sai sót khi tra giá và lưu lịch sử thay đổi.

Điểm khác biệt cần kiểm chứng là mẫu báo giá theo loại hình doanh nghiệp kết hợp với danh mục và bảng giá riêng của từng công ty.

## Trải nghiệm khách hàng và tài khoản doanh nghiệp

1. Quản trị nền tảng tạo mẫu theo loại hình doanh nghiệp.

2. Doanh nghiệp nhập danh mục, bảng giá và quy tắc thương mại.

3. User của doanh nghiệp nhập yêu cầu khách bằng văn bản.

4. AI trích xuất sản phẩm, số lượng, thuộc tính và thông tin còn thiếu; khi cần, AI đối chiếu cách diễn đạt với bảng giá.

5. Backend xác thực mặt hàng, lấy đơn giá và tính tổng theo quy tắc.

6. User của doanh nghiệp duyệt báo giá nháp và xuất file.

Khi yêu cầu không khớp mặt hàng nào, AI có thể đối chiếu bảng giá đã chuẩn hóa. Kết quả phải trỏ tới mã hàng có thật; user xác nhận nếu chưa rõ. Giá được lấy từ bảng giá và tính theo quy tắc của doanh nghiệp.

## Phạm vi pilot

Bắt đầu với một doanh nghiệp pilot, một loại hình và một luồng báo giá phổ biến. Trong sprint agent tối đa 5 ngày làm việc, bản pilot staging tập trung vào đăng ký tài khoản doanh nghiệp, nhập yêu cầu bằng văn bản, nhập một bảng giá CSV/XLSX đã chuẩn hóa, AI gợi ý mã hàng, backend tính giá theo quy tắc đơn giản đã chốt, user doanh nghiệp tự duyệt và xuất một mẫu PDF. Admin hệ thống quản lý các tài khoản doanh nghiệp; không phân vai nhân viên bên trong doanh nghiệp. Chưa bao gồm bộ dựng mẫu tổng quát hay kiểm chứng vận hành SaaS production.

Đọc mọi định dạng PDF/ảnh, bảng giá phức tạp nhiều bậc, nhiều cấp duyệt, tự động gửi báo giá, CRM/ERP, quản trị nhiều doanh nghiệp, bảo mật production và dự báo doanh thu nằm ngoài sprint một tuần; xem xét sau khi đánh giá pilot.

## Đo lường kết quả

Ghi nhận quy trình hiện tại trước pilot để làm mốc so sánh. Theo dõi thời gian tạo báo giá nháp, tỷ lệ ghép đúng sản phẩm, tỷ lệ user sửa bản nháp, tỷ lệ phải hỏi thêm khách và mức độ sẵn sàng tiếp tục sử dụng/trả phí. Chốt ngưỡng thành công trước khi bắt đầu; hiện chưa có dữ liệu để đặt mục tiêu số.

## Mô hình kinh doanh cần kiểm chứng

Thử nghiệm gói thuê bao theo doanh nghiệp hoặc số người dùng, kèm giới hạn sử dụng AI. Trước khi chốt giá, cần kiểm tra mức sẵn sàng chi trả, chi phí mô hình, hỗ trợ nhập bảng giá và bảo trì mẫu theo ngành.

## Thời gian và chi phí triển khai dự kiến

Phương án agent-led giới hạn ở **5 ngày làm việc**. **Chi phí nhân sự: 0 đồng trong dự toán**; giả định tài khoản agent hiện có và không mua thêm gói. Kết quả là một pilot chạy trên môi trường staging theo phạm vi trên, không phải bản SaaS production hoàn chỉnh.

| Ngày | Công việc chính | Kết quả |
|---|---|---|
| 1 | Chốt luồng, quy tắc và tiêu chí; khởi tạo ứng dụng và môi trường. | Phạm vi đóng băng, dữ liệu mẫu được nạp. |
| 2 | Danh mục/bảng giá, nhập yêu cầu, phân quyền cơ bản. | Luồng nhập và tra cứu dữ liệu hoạt động. |
| 3 | Kết nối AI để trích xuất/ghép mã hàng; tính giá trong backend. | Báo giá nháp có mã hàng và phép tính kiểm tra được. |
| 4 | Màn hình duyệt, chỉnh sửa, mẫu PDF. | Hoàn chỉnh luồng báo giá pilot. |
| 5 | Đưa lên staging, walkthrough với đầu mối pilot, sửa lỗi ưu tiên và bàn giao. | Bản demo pilot và hướng dẫn chạy. |

Theo cấu hình hiện có, **không tính thêm chi phí nhân sự, agent, VPS hoặc MongoDB**: agent đã có sẵn và MongoDB tự host trên VPS hiện hữu. Khoản cần dự toán duy nhất là **phí gọi API OpenRouter**, tính theo token/model, cộng phí nền tảng 5,5% của gói Standard khi nạp credit ([chính sách giá OpenRouter](https://openrouter.ai/pricing)). Đề xuất đặt hạn mức tổng **10 USD cho sprint một tuần**, gồm suy luận và phí nạp credit; mức dùng thực tế có thể thấp hơn. Thuế hoặc phí thanh toán, nếu có, tùy phương thức nạp.

### Ước tính riêng phí gọi OpenRouter

Phí API được tính theo token đầu vào/đầu ra và model. Lấy `openai/gpt-4.1-mini` làm mốc dự toán hiện tại: **0,40 USD/1 triệu token đầu vào** và **1,60 USD/1 triệu token đầu ra** ([bảng giá model trên OpenRouter](https://openrouter.ai/openai/gpt-4.1-mini/pricing)). Công thức: `(input_tokens × giá_input + output_tokens × giá_output) / 1.000.000`; gói Standard cộng phí nền tảng 5,5% khi nạp credit.

Ví dụ một lần phân tích báo giá gửi 5.000 token đầu vào (yêu cầu + các mặt hàng ứng viên đã lọc) và nhận 800 token đầu ra sẽ tốn khoảng **0,00328 USD**, tương đương khoảng **0,00346 USD** khi phân bổ thêm phí 5,5%. Theo giả định này, 100 lần gọi khoảng **0,35 USD**, 1.000 lần khoảng **3,46 USD**; hạn mức 10 USD đủ khoảng 2.800 lần gọi. Đây là ví dụ ước lượng: gửi cả danh mục lớn, đầu ra dài, gọi lại khi lỗi hoặc chọn model đắt hơn sẽ làm tăng phí. Cần ghi nhận usage thực tế từ API và đặt spend limit trước pilot.

Ước tính một tuần chỉ giữ được nếu đầu vào và quyền truy cập sẵn sàng trước ngày 1, bảng giá đã sạch và không phát sinh tích hợp. Thay đổi phạm vi trong tuần sẽ được đưa vào backlog sau pilot.

## Đầu vào cần có để bắt đầu sprint một tuần

1. **Chủ sở hữu nghiệp vụ:** một người chốt nhanh các câu hỏi về báo giá; ngành/doanh nghiệp pilot; một luồng báo giá và user doanh nghiệp tự duyệt; tiêu chí demo/đạt yêu cầu.

2. **Dữ liệu sẵn dùng:** một tệp CSV/XLSX sạch với mã hàng, tên, đơn vị, giá, tiền tệ và các biến thể cần thiết; một số yêu cầu thật đã ẩn thông tin nhạy cảm cùng báo giá đúng tương ứng. Báo trước số dòng/SKU và các lỗi dữ liệu đã biết.

3. **Quy tắc giá và đầu ra:** thuế/chiết khấu/phụ phí, làm tròn, thời hạn báo giá; một mẫu báo giá hiện tại; logo, thông tin pháp nhân và điều khoản bắt buộc trên PDF.

4. **Quyền truy cập:** tài khoản agent sẵn có; API key OpenRouter với hạn mức chi tiêu; tài khoản hosting/database hiện có hoặc quyết định dùng gói trả phí; người cấp quyền triển khai. Không gửi secret qua tài liệu chia sẻ hoặc đưa vào mã nguồn.

5. **Chính sách dữ liệu:** xác nhận nội dung yêu cầu nào được gửi tới nhà cung cấp AI, model được phép dùng, yêu cầu về khu vực lưu trữ và xóa dữ liệu. Dùng dữ liệu đã ẩn thông tin nhạy cảm cho demo.

Các mục mở rộng để hoàn thiện SaaS sau pilot gồm mô hình nhiều doanh nghiệp và cách ly dữ liệu, nhiều mẫu/phiên bản, bảng giá lớn hoặc nhiều bậc, quy trình duyệt nhiều cấp, SSO, CRM/ERP, yêu cầu bảo mật production, backup/khôi phục, SLA, bảo hành và quy trình nghiệm thu chính thức.

## Rủi ro và kiểm soát

- Giá không chính xác: lấy đơn giá và quy tắc từ dữ liệu doanh nghiệp đã xác nhận; lưu phiên bản áp dụng trong báo giá.

- Ghép nhầm sản phẩm: cho user xem mã hàng và căn cứ đối chiếu trước khi duyệt.

- Rò rỉ dữ liệu: phân tách theo doanh nghiệp, gửi tối thiểu dữ liệu cần thiết và rà soát chính sách của nhà cung cấp mô hình.

- Mở rộng quá sớm: kiểm chứng nhóm đầu tiên trước khi xây mẫu cho nhiều ngành.

OpenRouter hỗ trợ đầu ra JSON Schema trên các mô hình và endpoint tương thích; ứng dụng vẫn cần xác thực kết quả. Zero Data Retention áp dụng ở phía nhà cung cấp suy luận và không thay thế kiểm soát log của ứng dụng. [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Zero Data Retention](https://openrouter.ai/blog/insights/zero-data-retention/)

## Quyết định đề nghị

Phê duyệt sprint pilot agent-led trong 5 ngày làm việc; chỉ định chủ sở hữu nghiệp vụ và đầu mối kỹ thuật, chuẩn bị đủ dữ liệu/tài khoản trước ngày bắt đầu, đồng thời đặt hạn mức chi phí cho AI và hạ tầng. Sau walkthrough, quyết định có đầu tư các phần production và SaaS nhiều doanh nghiệp hay không.

## Kiến trúc dự kiến

React và TypeScript cho giao diện; backend TypeScript xử lý phân quyền, AI, tra cứu và tính giá; MongoDB lưu doanh nghiệp, mẫu, danh mục và báo giá; OpenRouter kết nối mô hình. [React với TypeScript](https://react.dev/learn/typescript)
