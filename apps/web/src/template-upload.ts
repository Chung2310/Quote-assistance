export type UploadTemplateCategory = "quote" | "estimate" | "contract" | "acceptance" | "settlement";

export function templateFileError(file: { name: string; size: number }, _category: UploadTemplateCategory): string | null {
  if (!/\.(docx|xlsx|pdf)$/i.test(file.name)) return "Hãy chọn file Word (.docx), Excel (.xlsx) hoặc PDF.";
  if (!file.size || file.size > 10 * 1024 * 1024) return "File mẫu phải có dung lượng từ 1 byte đến tối đa 10 MB.";
  return null;
}
