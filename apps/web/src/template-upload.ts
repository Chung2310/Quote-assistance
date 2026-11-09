export type UploadTemplateCategory = "quote" | "estimate" | "contract" | "acceptance" | "settlement";

export function templateFileError(file: { name: string; size: number }, category: UploadTemplateCategory): string | null {
  if (category === "contract" && !/\.docx$/i.test(file.name)) return "Mẫu hợp đồng chỉ hỗ trợ file Word (.docx).";
  if (category === "settlement" && !/\.xlsx$/i.test(file.name)) return "Mẫu quyết toán chỉ hỗ trợ file Excel (.xlsx).";
  if (category === "acceptance" && !/\.(docx|xlsx)$/i.test(file.name)) return "Nhóm nghiệm thu và quyết toán chỉ nhận file Word (.docx) hoặc Excel (.xlsx).";
  if (!/\.(docx|xlsx|pdf)$/i.test(file.name)) return "Hãy chọn file Word (.docx), Excel (.xlsx) hoặc PDF.";
  if (!file.size || file.size > 10 * 1024 * 1024) return "File mẫu phải có dung lượng từ 1 byte đến tối đa 10 MB.";
  return null;
}
