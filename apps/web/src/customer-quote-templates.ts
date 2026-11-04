import { api } from "./api";

export interface CustomerQuoteTemplate {
  id: string;
  name: string;
  originalFilename: string;
  extension: string;
}

export async function listCustomerQuoteTemplates() {
  const templates: CustomerQuoteTemplate[] = [];
  let cursor: string | null = null;
  let defaultTemplateId: string | null = null;
  do {
    const params = new URLSearchParams({ category: "quote" });
    if (cursor) params.set("cursor", cursor);
    const page: { templates: CustomerQuoteTemplate[]; defaultTemplateId: string | null; nextCursor: string | null } = await api(`/api/quote-templates?${params.toString()}`);
    templates.push(...page.templates.filter((entry) => ["docx", "xlsx", "pdf"].includes(entry.extension)));
    defaultTemplateId = page.defaultTemplateId;
    cursor = page.nextCursor;
  } while (cursor);
  return { templates, defaultTemplateId };
}
