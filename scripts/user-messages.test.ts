import test from "node:test";
import assert from "node:assert/strict";
import { publicErrorMessage } from "../apps/api/src/public-errors.js";
import { userMessage } from "../apps/web/src/user-message.ts";
import { api, ApiError, createGeneratedExport, downloadGeneratedFile, getLatestGeneratedFile } from "../apps/web/src/api.ts";

for (const [name, format] of [["server",publicErrorMessage],["browser",userMessage]] as const) {
  test(`${name}: provider failures and saved diagnostics become readable messages`,()=>{
    const errors=[
      "OpenRouter could not edit the template: insufficient credits (HTTP 402).",
      "OpenRoute yêu cầu thêm credit cho model openai/gpt-6-luna.",
      "AI lỗi: http=200; bodyKeys=id,output; response=incomplete; shellCalls=7; stderr=Traceback; /workspace/home/input.xlsx",
      "Không lưu được file đã xuất lên Cloudinary: HTTP 503.",
      "Không đọc được XML namespace ns1 tại xl/worksheets/sheet2.xml.",
      "Dữ liệu JSON không hợp lệ: SyntaxError at parse (E:\\app\\index.js:22:10)",
      "MongoServerError: E11000 duplicate key error",
      "Lỗi phản hồi /api/export-jobs/123: requestId=secret-id",
    ];
    for(const error of errors){
      const message=format(error);
      assert.doesNotMatch(message,/openroute|cloudinary|gpt-|credit|JSON|XML|namespace|http|shellCalls|stderr|workspace|requestId|secret-id|Mongo|SyntaxError|E11000|index\.js/i);
      assert.match(message,/Vui lòng/);
    }
  });
  test(`${name}: validation, plan limits and product specifications retain useful details`,()=>{
    for(const message of [
      "Email hoặc mật khẩu chưa đúng.",
      "Bạn đã dùng hết 20 lượt AI của gói hiện tại. Hãy nâng cấp gói.",
      "Ống PPR D25: chưa có quy cách để đổi 73 m sang cây.",
      "Mẫu nghiệm thu chỉ hỗ trợ Word (.docx) hoặc Excel (.xlsx).",
      "Dự toán còn thiếu mức VAT và phí vận chuyển.",
      "Đã quá thời gian thanh toán 7 ngày. Hãy kiểm tra hạn thanh toán.",
    ])assert.equal(format(message),message);
  });
  test(`${name}: pending exports, timeouts and network failures have distinct recovery guidance`,()=>{
    assert.match(format("Tác vụ vẫn đang xử lý. Bạn có thể thử tải lại sau ít phút."),/vẫn đang xử lý/);
    assert.equal(format(new Error("The operation was aborted due to timeout")),"Xử lý lâu hơn dự kiến. Vui lòng thử lại sau.");
    assert.equal(format(new TypeError("Failed to fetch")),"Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
    assert.equal(format(undefined,"Chưa tạo được file."),"Chưa tạo được file.");
    assert.equal(format("OpenRouter did not return the edited file: FileNotFoundError; timeout_ms=120000"),"Chức năng AI tạm thời chưa sẵn sàng. Vui lòng thử lại sau.");
    assert.equal(format("Không đọc được XML: FileNotFoundError; /workspace/home/input.xlsx"),"Không thể hoàn tất yêu cầu lúc này. Vui lòng thử lại.");
    assert.equal(format("AI chưa ánh xạ được mẫu: binding line_1_name không hợp lệ."),"Chưa điền được mẫu tài liệu. Hãy kiểm tra mẫu đã chọn và thử lại.");
  });
}

test("request errors retain status codes for application behavior and hide provider details",async(t)=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({error:"OpenRouter HTTP 402: insufficient credits"},{status:429}));
  await assert.rejects(api("/test"),(error:unknown)=>{
    assert.ok(error instanceof ApiError);
    assert.equal(error.status,429);
    assert.equal(error.message,"Chức năng AI tạm thời chưa sẵn sàng. Vui lòng thử lại sau.");
    return true;
  });
});

test("network and download errors are translated before reaching inline error displays",async(t)=>{
  const mock=t.mock.method(globalThis,"fetch",async()=>{throw new TypeError("Failed to fetch");});
  await assert.rejects(api("/test"),/Vui lòng kiểm tra mạng/);
  mock.mock.mockImplementation(async()=>Response.json({error:"Không thể tải file từ Cloudinary để xem trước."},{status:502}));
  await assert.rejects(downloadGeneratedFile("file"),/Chưa tải được file đã lưu/);
});

test("old stored export errors are cleaned without modifying file names or user data",async(t)=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({file:{id:"file",filename:"OpenRouter trong tên file do khách đặt.xlsx"},job:{id:"job",status:"failed",error:"OpenRouter did not return the edited file. shellCalls=7"}}));
  const result=await getLatestGeneratedFile("source","customer_quote");
  assert.equal(result.file?.filename,"OpenRouter trong tên file do khách đặt.xlsx");
  assert.doesNotMatch(result.job?.error??"",/OpenRouter|shellCalls/);
  const data=await api<{file:{filename:string}}>("/catalog");
  assert.equal(data.file.filename,"OpenRouter trong tên file do khách đặt.xlsx");
});

test("background export polling does not show internal stored job errors",async(t)=>{
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{configurable:true,value:{setTimeout:(callback:()=>void)=>{queueMicrotask(callback);return 0;}}});
  t.after(()=>{if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");});
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>calls++===0?Response.json({jobId:"job"},{status:202}):Response.json({job:{status:"failed",error:"AI lỗi XML: bodyKeys=output; container_id=private"}}));
  await assert.rejects(createGeneratedExport("/export"),(error:Error)=>{
    assert.doesNotMatch(error.message,/XML|bodyKeys|container_id|private/);
    assert.match(error.message,/Vui lòng/);
    return true;
  });
  assert.equal(calls,2);
});
