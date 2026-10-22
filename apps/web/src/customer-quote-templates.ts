import { api } from "./api";

export interface CustomerExcelTemplate {
  id: string;
  name: string;
  originalFilename: string;
  extension: string;
}

export async function listCustomerExcelTemplates() {
  const templates: CustomerExcelTemplate[] = [];
  let cursor: string | null = null;
  let defaultTemplateId: string | null = null;
  do {
    const page: { templates: CustomerExcelTemplate[]; defaultTemplateId: string | null; nextCursor: string | null } = await api(`/api/quote-templates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    templates.push(...page.templates.filter((entry) => entry.extension === "xlsx"));
    defaultTemplateId = page.defaultTemplateId;
    cursor = page.nextCursor;
  } while (cursor);
  return { templates, defaultTemplateId };
}
