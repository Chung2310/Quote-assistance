import express from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { Binary, ObjectId, type Db, type Document, type Filter } from "mongodb";
import PdfPrinter from "pdfmake";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectDatabase, closeDatabase } from "./db.js";
import { login, logout, requireAuth, requireSystemAdmin, requireRole } from "./auth.js";
import { hashPassword } from "./password.js";
import { analyzeRequest, suggestUnmatchedExplicitRequestLines } from "./ai.js";
import { parseCustomerQuotePrompt, suggestCustomerQuote } from "./customer-quote-ai.js";
import { mergeBudgetPlanAfterClarification, recalculationInput, recomputeBudgetPlanTotals, suggestBudgetPlan, type SavedBudgetPlan } from "./budget-planner.js";
import { analyzePriceList, extractPriceListRows, type PriceList, type PriceListAnalysisRow } from "./price-list.js";
import { requestFileContent, type RequestFile } from "./request-file.js";
import { decryptCompanySecret, encryptCompanySecret } from "./secrets.js";
import { downloadCompanyFile, uploadCompanyFile } from "./cloudinary.js";
import { calculateQuote, recalculateSnapshot, roundMoney } from "./pricing.js";
import { estimateFromCustomerQuote } from "./quote-from-customer.js";
import { makeDocumentWord } from "./document-word.js";
import { contractTemplateMode, renderAcceptanceFile, renderContractFile } from "./contract-template.js";
import { adjustEstimateWithRequirements } from "./quote-estimate-adjustment.js";
import { extractCatalogProducts, previewCatalogImport, type PriceListColumnRole, type PriceListSheetMapping } from "./price-list-import.js";
import { cleanMissingInformation, extractQuoteTerms, isResolvedQuoteTermWarning, isShippingInformation, isSupplementalProductInformation, isTaxInformation } from "./quote-terms.js";
import { budgetPlanAsQuote, makeBudgetPlanExcel, makeQuoteExcel } from "./quote-excel.js";
import { attachWeb } from "./web.js";
import { currentTemplate, getOrCreateTemplateFillPlan, inspectTemplate, previewDocxHtml, renderAiMappedXlsxTemplate, renderTemplate, savedTemplate, templateDetails, templateFormats, type QuoteTemplate } from "./quote-template.js";
import type { AcceptanceRecord, CatalogItem, Company, CompanyFile, CompanyProfileDetails, ContactRequestStatus, Contract, PlanContactRequest, Quote, QuoteRequest, QuoteStatus, SessionUser, SubscriptionPlan, UserAccount } from "./types.js";

const app = express();
const require = createRequire(import.meta.url);
type PdfDocumentDefinition = Parameters<InstanceType<typeof PdfPrinter>["createPdfKitDocument"]>[0];
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sameProductLineName(first: string, second: string) {
  const tokens = (value: string): string[] => value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").match(/[a-z0-9]+/g) ?? [];
  const firstTokens = tokens(first);
  const secondTokens = tokens(second);
  const smaller = firstTokens.length <= secondTokens.length ? firstTokens : secondTokens;
  const larger = firstTokens.length <= secondTokens.length ? secondTokens : firstTokens;
  return firstTokens.join(" ") === secondTokens.join(" ")
    || (smaller.length >= 2 && smaller.every((token) => larger.includes(token)));
}

function quoteForResponse(quote: Quote): Quote {
  const terms = { validityDays: quote.validityDays, completionDate: quote.completionDate };
  const information = cleanMissingInformation(quote.informationNeeded ?? [], quote.lines?.length > 0)
    .filter((field) => !isResolvedQuoteTermWarning(field, terms));
  const taxRateConfirmed = quote.taxRateConfirmed ?? !information.some(isTaxInformation);
  const shippingFeeConfirmed = quote.shippingFeeConfirmed ?? (quote.shippingFee != null || !information.some(isShippingInformation));
  const informationNeeded = information.filter((field) =>
    !(taxRateConfirmed && isTaxInformation(field)) && !(shippingFeeConfirmed && isShippingInformation(field)),
  );
  if (!taxRateConfirmed && !informationNeeded.some(isTaxInformation)) informationNeeded.push("VAT: cần xác nhận thuế suất.");
  if (!shippingFeeConfirmed && !informationNeeded.some(isShippingInformation)) informationNeeded.push("Phí vận chuyển: cần xác nhận số tiền hoặc xác nhận miễn phí.");
  const unresolved = informationNeeded.some((field) => isSupplementalProductInformation(field)
    ? !quote.lines.some((line) => line.source === "supplemental" && line.supplementalFor === field && !line.priceUnavailable)
    : !quote.additionalInformation?.[field]?.trim())
    || !taxRateConfirmed || !shippingFeeConfirmed;
  const status = quote.status === "draft" || quote.status === "needs_info"
    ? unresolved ? "needs_info" : "draft"
    : quote.status;
  return {
    ...quote,
    informationNeeded,
    taxRateConfirmed,
    taxAmount: taxRateConfirmed ? quote.taxAmount : 0,
    shippingFee: quote.shippingFee ?? (shippingFeeConfirmed ? 0 : null),
    shippingFeeConfirmed,
    total: Math.round((quote.subtotal + (taxRateConfirmed ? quote.taxAmount : 0) + (shippingFeeConfirmed ? quote.shippingFee ?? 0 : 0) + Number.EPSILON) * 100) / 100,
    status,
  };
}

async function customerQuoteWithPrices(db: Db, quote: Quote): Promise<Quote> {
  if (quote.kind !== "customer" || quote.customerPricesCaptured || !quote.lines.some((line) => line.unitPrice === 0)) return quote;
  const ids = quote.lines.map((line) => asId(line.catalogItemId)).filter((id): id is ObjectId => id !== null);
  const skus = quote.lines.map((line) => line.sku).filter(Boolean);
  const products = ids.length || skus.length
    ? await db.collection<CatalogItem>("catalogItems").find({ companyId: quote.companyId, $or: [{ _id: { $in: ids } }, { sku: { $in: skus } }] }).toArray()
    : [];
  const byId = new Map(products.map((item) => [String(item._id), item]));
  const bySku = new Map(products.map((item) => [item.sku, item]));
  return {
    ...quote,
    lines: quote.lines.map((line) => {
      if (line.unitPrice !== 0) return line;
      const product = byId.get(line.catalogItemId) ?? bySku.get(line.sku);
      return product
        ? { ...line, unitPrice: product.price, priceFromCurrentCatalog: true }
        : { ...line, priceUnavailable: true };
    }),
  };
}

function quoteHasUnresolvedInformation(quote: Quote) {
  const normalized = quoteForResponse(quote);
  return normalized.informationNeeded.some((field) => isSupplementalProductInformation(field)
    ? !normalized.lines.some((line) => line.source === "supplemental" && line.supplementalFor === field && !line.priceUnavailable)
    : !normalized.additionalInformation?.[field]?.trim())
    || !normalized.taxRateConfirmed || !normalized.shippingFeeConfirmed;
}

async function quoteInputContext(db: Db, quote: Quote) {
  const requestId = asId(quote.requestId);
  const source = requestId
    ? await db.collection<QuoteRequest>("quoteRequests").findOne({ _id: requestId, companyId: quote.companyId }, { projection: { requestText: 1, requestFile: 1, createdBy: 1, items: 1, suggestedProducts: 1 } })
    : null;
  let attachedText = "";
  const requestFileId = source?.requestFile ? asId(source.requestFile.id) : null;
  if (requestFileId && source?.requestFile && !/\.pdf$/i.test(source.requestFile.originalFilename)) {
    const file = await db.collection<RequestFile>("requestFiles").findOne({ _id: requestFileId, companyId: quote.companyId, uploadedBy: source.createdBy });
    if (file) {
      try {
        attachedText = (await requestFileContent(file))
          .map((part) => typeof part.text === "string" ? part.text : "")
          .filter(Boolean).join("\n");
      } catch { /* Use the text and extracted product details already saved with the request. */ }
    }
  }
  return [
    quote.sourceRequirements ?? "",
    source?.requestText ?? "",
    attachedText,
    ...(source?.items ?? []).flatMap((item) => Object.entries(item.attributes ?? {}).flat()),
    ...(source?.suggestedProducts ?? []).flatMap((product) => [product.name, product.description]),
  ].filter(Boolean).join("\n");
}

interface CatalogImportRow {
  sku: string;
  name: string;
  description: string;
  attributes?: Record<string, string>;
  unit: string;
  price: number;
  currency: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

type CatalogRowResult = { ok: true; value: CatalogImportRow } | { ok: false; error: string };

interface PlatformSepaySettingsDocument extends Document {
  _id: string;
  sepaySettings?: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    paymentPrefix: string;
    webhookApiKeyEncrypted?: string;
  };
  updatedAt: Date;
}

interface EffectiveSepaySettings {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  paymentPrefix: string;
  webhookApiKey: string;
}

const SEPAY_SECRET_SALT = "bao-gia-platform-sepay";
const SEPAY_SECRET_INFO = "platform-sepay-settings-v1";

async function getSepaySettings(db: Db): Promise<EffectiveSepaySettings> {
  const stored = await db.collection<PlatformSepaySettingsDocument>("platformSettings").findOne({ _id: "sepay" });
  const configured = stored?.sepaySettings;
  return {
    bankCode: configured?.bankCode ?? config.sepay.bankCode,
    accountNumber: configured?.accountNumber ?? config.sepay.accountNumber,
    accountName: configured?.accountName ?? config.sepay.accountName,
    paymentPrefix: configured?.paymentPrefix ?? config.sepay.paymentPrefix,
    webhookApiKey: configured?.webhookApiKeyEncrypted
      ? decryptCompanySecret(configured.webhookApiKeyEncrypted, SEPAY_SECRET_SALT, SEPAY_SECRET_INFO)
      : config.sepay.webhookApiKey,
  };
}

function isSepayConfigured(settings: EffectiveSepaySettings) {
  return Boolean(settings.bankCode && /^[A-Za-z0-9]{1,19}$/.test(settings.accountNumber) && settings.webhookApiKey);
}

interface CatalogImportSettingsDocument extends Document {
  companyId: string;
  sheets: PriceListSheetMapping[];
  createdAt: Date;
  updatedAt: Date;
}

type SubscriptionPaymentStatus = "pending" | "paid" | "superseded";

interface SubscriptionPayment extends Document {
  code: string;
  companyId: string;
  createdBy: string;
  planCode: string;
  planName: string;
  amount: number;
  status: SubscriptionPaymentStatus;
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date;
  sepayTransactionId?: string;
  subscriptionStartsAt?: Date;
  subscriptionExpiresAt?: Date;
}

app.disable("x-powered-by");
app.use((request, response, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const matchedRoute = request.route?.path;
    const routePath = Array.isArray(matchedRoute) ? matchedRoute[0] : matchedRoute;
    const route = typeof routePath === "string" ? `${request.baseUrl}${routePath}` : "unmatched";
    const statusCode = response.statusCode;
    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    logger[level]("http.request", {
      requestId,
      method: request.method,
      route,
      statusCode,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(1)),
    });
  });
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

function userOf(request: express.Request) {
  return request.user as SessionUser;
}

function scoped<T extends Document & { companyId: string }>(db: Db, collection: string, user: SessionUser) {
  return db.collection<T>(collection).find({ companyId: user.companyId } as Filter<T>);
}

function asId(value: string | string[] | undefined) {
  if (typeof value !== "string") return undefined;
  return ObjectId.isValid(value) ? new ObjectId(value) : undefined;
}

function fail(response: express.Response, message: string, status = 400) {
  response.status(status).json({ error: message });
}

function validText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 250 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicPlan(plan: SubscriptionPlan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice,
    quoteLimit: plan.quoteLimit,
    aiLimit: plan.aiLimit === undefined ? plan.quoteLimit : plan.aiLimit,
    templateLimit: plan.templateLimit,
    active: plan.active,
    featured: plan.featured,
    displayOrder: plan.displayOrder,
  };
}

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function vietnamMonthPeriod(now = new Date()) {
  const vietnamNow = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS);
  const start = new Date(Date.UTC(vietnamNow.getUTCFullYear(), vietnamNow.getUTCMonth(), 1) - VIETNAM_UTC_OFFSET_MS);
  const end = new Date(Date.UTC(vietnamNow.getUTCFullYear(), vietnamNow.getUTCMonth() + 1, 1) - VIETNAM_UTC_OFFSET_MS);
  return { start, end };
}

function addCalendarMonth(value: Date) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function currentCompanyPlan(db: Db, companyId: string) {
  const companies = db.collection<Company>("companies");
  let company = await companies.findOne({ _id: new ObjectId(companyId) }, { projection: { planCode: 1, subscriptionExpiresAt: 1, billingPaymentCreatedAt: 1, aiUsage: 1 } });
  if (company?.planCode && company.planCode !== "free" && company.subscriptionExpiresAt && company.subscriptionExpiresAt <= new Date()) {
    await companies.updateOne(
      { _id: company._id, planCode: company.planCode, subscriptionExpiresAt: company.subscriptionExpiresAt },
      { $set: { planCode: "free", updatedAt: new Date() }, $unset: { subscriptionExpiresAt: "" } },
    );
    company = await companies.findOne({ _id: new ObjectId(companyId) }, { projection: { planCode: 1, subscriptionExpiresAt: 1, billingPaymentCreatedAt: 1, aiUsage: 1 } });
  }
  const plans = db.collection<SubscriptionPlan>("subscriptionPlans");
  const plan = await plans.findOne({ code: company?.planCode ?? "free" }) ?? await plans.findOne({ code: "free" });
  if (!plan) throw new Error("Không tìm thấy gói dịch vụ mặc định.");
  return { company, plan };
}

async function subscriptionUsage(db: Db, companyId: string) {
  const { company, plan } = await currentCompanyPlan(db, companyId);
  const { start, end } = vietnamMonthPeriod();
  const aiLimit = plan.aiLimit === undefined ? plan.quoteLimit : plan.aiLimit;
  const aiUsed = company?.aiUsage?.periodStart === start.toISOString() ? company.aiUsage.used : 0;
  const [quoteUsed, templateUsed] = await Promise.all([
    db.collection("auditLogs").countDocuments({ companyId, action: "quote_created", createdAt: { $gte: start, $lt: end } }),
    db.collection<QuoteTemplate>("quoteTemplates").countDocuments({ companyId, deletedAt: { $exists: false } }),
  ]);
  return {
    plan,
    subscriptionExpiresAt: company?.subscriptionExpiresAt ?? null,
    quotes: {
      used: quoteUsed,
      limit: plan.quoteLimit,
      remaining: plan.quoteLimit === null ? null : Math.max(0, plan.quoteLimit - quoteUsed),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    },
    ai: {
      used: aiUsed,
      limit: aiLimit,
      remaining: aiLimit === null ? null : Math.max(0, aiLimit - aiUsed),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    },
    templates: {
      used: templateUsed,
      limit: plan.templateLimit,
      remaining: plan.templateLimit === null ? null : Math.max(0, plan.templateLimit - templateUsed),
    },
  };
}

function quoteQuotaMessage(plan: SubscriptionPlan) {
  return `Gói ${plan.name} đã hết ${plan.quoteLimit} lượt tạo báo giá trong tháng này. Hạn mức sẽ được làm mới vào đầu tháng sau.`;
}

class AiQuotaExceededError extends Error {}

function aiQuotaMessage(plan: SubscriptionPlan) {
  const limit = plan.aiLimit === undefined ? plan.quoteLimit : plan.aiLimit;
  return `Gói ${plan.name} đã hết ${limit} lượt dùng AI trong tháng này. Hạn mức sẽ được làm mới vào đầu tháng sau.`;
}

async function withAiUsage<T>(db: Db, user: SessionUser, kind: string, work: () => Promise<T>): Promise<T> {
  const { plan } = await currentCompanyPlan(db, user.companyId);
  const limit = plan.aiLimit === undefined ? plan.quoteLimit : plan.aiLimit;
  const periodStart = vietnamMonthPeriod().start.toISOString();
  const usedInPeriod = { $cond: [{ $eq: ["$aiUsage.periodStart", periodStart] }, { $ifNull: ["$aiUsage.used", 0] }, 0] };
  const companies = db.collection<Company>("companies");
  const companyId = new ObjectId(user.companyId);
  const reservation = await companies.findOneAndUpdate(
    { _id: companyId, ...(limit === null ? {} : { $expr: { $lt: [usedInPeriod, limit] } }) },
    [{ $set: { aiUsage: { periodStart, used: { $add: [usedInPeriod, 1] } } } }],
    { returnDocument: "after", projection: { aiUsage: 1 } },
  );
  if (!reservation) throw new AiQuotaExceededError(aiQuotaMessage(plan));
  try {
    const value = await work();
    try {
      await writeAudit(db, user, "ai_usage", "company", user.companyId, { kind });
    } catch (auditError) {
      logger.error("ai_usage.audit_failed", { companyId: user.companyId, kind, error: auditError instanceof Error ? auditError.message : String(auditError) });
    }
    return value;
  } catch (error) {
    try {
      await companies.updateOne({ _id: companyId, "aiUsage.periodStart": periodStart, "aiUsage.used": { $gt: 0 } }, { $inc: { "aiUsage.used": -1 } });
    } catch (refundError) {
      logger.error("ai_usage.refund_failed", { companyId: user.companyId, kind, error: refundError instanceof Error ? refundError.message : String(refundError) });
    }
    throw error;
  }
}

function templateQuotaMessage(plan: SubscriptionPlan) {
  return `Gói ${plan.name} đã đạt giới hạn ${plan.templateLimit} mẫu tài liệu. Hãy liên hệ quản trị viên để nâng cấp gói.`;
}

async function enforceTemplateQuota(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const usage = await subscriptionUsage(await connectDatabase(), userOf(request).companyId);
    if (usage.templates.limit !== null && usage.templates.used >= usage.templates.limit) {
      return fail(response, templateQuotaMessage(usage.plan), 429);
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function enforceQuoteQuota(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const usage = await subscriptionUsage(await connectDatabase(), userOf(request).companyId);
    if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) {
      return fail(response, quoteQuotaMessage(usage.plan), 429);
    }
    next();
  } catch (error) {
    next(error);
  }
}

function parsePlanInput(body: Record<string, unknown>, code: string, existing?: SubscriptionPlan) {
  const name = typeof body.name === "string" ? body.name.trim() : existing?.name ?? "";
  const description = typeof body.description === "string" ? body.description.trim() : existing?.description ?? "";
  const monthlyPrice = body.monthlyPrice === null || body.monthlyPrice === ""
    ? null
    : typeof body.monthlyPrice === "number" ? body.monthlyPrice : Number(body.monthlyPrice);
  const quoteLimit = body.quoteLimit === null || body.quoteLimit === ""
    ? null
    : typeof body.quoteLimit === "number" ? body.quoteLimit : Number(body.quoteLimit);
  const aiLimit = body.aiLimit === undefined
    ? existing?.aiLimit === undefined ? existing?.quoteLimit ?? null : existing.aiLimit
    : body.aiLimit === null || body.aiLimit === "" ? null
    : typeof body.aiLimit === "number" ? body.aiLimit : Number(body.aiLimit);
  const templateLimit = body.templateLimit === null || body.templateLimit === ""
    ? null
    : typeof body.templateLimit === "number" ? body.templateLimit : Number(body.templateLimit);
  const active = typeof body.active === "boolean" ? body.active : existing?.active ?? true;
  const featured = typeof body.featured === "boolean" ? body.featured : existing?.featured ?? false;
  const displayOrder = typeof body.displayOrder === "number" ? body.displayOrder : Number(body.displayOrder ?? existing?.displayOrder ?? 0);
  if (!validText(name, 80)) return { error: "Tên gói phải có từ 1 đến 80 ký tự." };
  if (description.length > 300) return { error: "Mô tả gói tối đa 300 ký tự." };
  if (monthlyPrice !== null && (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 1_000_000_000)) return { error: "Giá tháng không hợp lệ." };
  if (quoteLimit !== null && (!Number.isInteger(quoteLimit) || quoteLimit < 1 || quoteLimit > 1_000_000)) return { error: "Hạn mức báo giá phải là số nguyên dương hoặc để trống." };
  if (aiLimit !== null && (!Number.isInteger(aiLimit) || aiLimit < 1 || aiLimit > 1_000_000)) return { error: "Hạn mức AI phải là số nguyên dương hoặc để trống." };
  if (templateLimit !== null && (!Number.isInteger(templateLimit) || templateLimit < 1 || templateLimit > 10_000)) return { error: "Hạn mức mẫu phải là số nguyên dương hoặc để trống." };
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10_000) return { error: "Thứ tự hiển thị không hợp lệ." };
  if (code === "free" && (monthlyPrice !== 0 || !active)) return { error: "Gói miễn phí phải có giá 0đ và luôn được kích hoạt." };
  if (code === "contact" && (monthlyPrice !== null || !active)) return { error: "Gói Liên hệ phải giữ giá thỏa thuận và luôn được kích hoạt." };
  return { value: { name, description, monthlyPrice, quoteLimit, aiLimit, templateLimit, active, featured, displayOrder } };
}

function publicUserAccount(account: UserAccount) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    companyId: account.companyId ?? "",
    active: account.active !== false,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCompanyProfile(body: Record<string, unknown>): { value?: CompanyProfileDetails & { name: string; normalizedName: string }; error?: string } {
  const name = typeof body.companyName === "string" ? body.companyName.trim().replace(/\s+/g, " ") : "";
  const taxId = typeof body.taxId === "string" ? body.taxId.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const businessEmail = typeof body.businessEmail === "string" ? body.businessEmail.trim().toLowerCase() : "";
  const representativeName = typeof body.representativeName === "string" ? body.representativeName.trim() : "";
  if (!validText(name, 200)) return { error: "Tên doanh nghiệp bắt buộc, tối đa 200 ký tự." };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{4,29}$/.test(taxId)) return { error: "Mã số thuế cần có từ 5 đến 30 chữ cái, chữ số, dấu chấm hoặc gạch nối." };
  if (!validText(address, 500)) return { error: "Địa chỉ doanh nghiệp bắt buộc, tối đa 500 ký tự." };
  if (!/^\+?[0-9\s().-]{7,30}$/.test(phone) || phone.replace(/\D/g, "").length < 7) return { error: "Số điện thoại doanh nghiệp không hợp lệ." };
  if (!validEmail(businessEmail)) return { error: "Email doanh nghiệp không hợp lệ." };
  if (!validText(representativeName, 200)) return { error: "Tên người đại diện bắt buộc, tối đa 200 ký tự." };
  return {
    value: {
      name,
      normalizedName: name.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("vi"),
      taxId,
      address,
      phone,
      businessEmail,
      representativeName,
    },
  };
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}

function currentCatalogFilter(companyId: string): Document {
  const today = new Date().toISOString().slice(0, 10);
  return {
    companyId,
    active: true,
    $and: [
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: today } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: today } }] },
    ],
  };
}

function mapCatalogRow(value: unknown, rowNumber: number, currency: string): CatalogRowResult {
  if (!isRecord(value)) return { ok: false, error: `Dòng ${rowNumber}: dữ liệu không hợp lệ.` };
  const sku = String(value.sku ?? "").trim().toLocaleUpperCase("vi");
  const name = String(value.name ?? "").trim();
  const unit = String(value.unit ?? "").trim();
  const rawPrice = typeof value.price === "number" ? value.price : Number(String(value.price ?? "").replace(/,/g, ""));
  const rowCurrency = String(value.currency ?? currency).trim().toUpperCase();
  const description = String(value.description ?? "").trim();
  const attributes: Record<string, string> = {};
  const normalizedAttributeKeys = new Set<string>();
  const effectiveFrom = String(value.effectiveFrom ?? "").trim();
  const effectiveTo = String(value.effectiveTo ?? "").trim();
  const isDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const problems: string[] = [];
  if (!sku || sku.length > 100) problems.push("mã hàng bắt buộc, tối đa 100 ký tự");
  if (!name || name.length > 250) problems.push("tên hàng bắt buộc, tối đa 250 ký tự");
  if (!unit || unit.length > 50) problems.push("đơn vị bắt buộc, tối đa 50 ký tự");
  if (!Number.isFinite(rawPrice) || rawPrice < 0 || rawPrice > 1_000_000_000_000) problems.push("đơn giá phải là số không âm hợp lệ");
  if (!/^[A-Z]{3}$/.test(rowCurrency)) problems.push("tiền tệ cần theo mã ISO 3 ký tự, ví dụ VND");
  if (effectiveFrom && !isDate(effectiveFrom)) problems.push("ngày hiệu lực từ cần là ngày hợp lệ theo định dạng YYYY-MM-DD");
  if (effectiveTo && !isDate(effectiveTo)) problems.push("ngày hiệu lực đến cần là ngày hợp lệ theo định dạng YYYY-MM-DD");
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) problems.push("ngày hiệu lực đến phải sau ngày bắt đầu");
  if (value.attributes !== undefined) {
    if (!isRecord(value.attributes) || Object.keys(value.attributes).length > 50) problems.push("thuộc tính bổ sung không hợp lệ (tối đa 50 trường)");
    else for (const [rawKey, rawValue] of Object.entries(value.attributes)) {
      const key = rawKey.trim();
      if (!key || key.length > 100 || typeof rawValue !== "string" || rawValue.length > 500) problems.push("tên thuộc tính tối đa 100 ký tự, giá trị tối đa 500 ký tự");
      else {
        const normalizedKey = key.toLocaleLowerCase("vi");
        if (normalizedAttributeKeys.has(normalizedKey)) problems.push("tên thuộc tính không được trùng nhau");
        normalizedAttributeKeys.add(normalizedKey);
        attributes[key] = rawValue.trim();
      }
    }
  }
  if (problems.length) return { ok: false, error: `Dòng ${rowNumber}: ${problems.join("; ")}.` };
  return {
    ok: true,
    value: {
      sku,
      name,
      description: description.slice(0, 2000),
      ...(value.attributes !== undefined ? { attributes } : {}),
      unit,
      price: rawPrice,
      currency: rowCurrency,
      effectiveFrom: effectiveFrom || undefined,
      effectiveTo: effectiveTo || undefined,
    },
  };
}

function parseCatalogImportMapping(encoded: string | undefined, rows: PriceListAnalysisRow[]): PriceListSheetMapping[] | undefined {
  if (!encoded) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(decodeURIComponent(encoded)); }
  catch { throw new Error("Cấu hình ghép cột không hợp lệ. Hãy xem trước file và chọn lại các cột."); }
  const allowedRoles = new Set<PriceListColumnRole>(["sku", "name", "unit", "price", "currency", "description", "effectiveFrom", "effectiveTo", "attribute", "ignore"]);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) throw new Error("Chọn từ 1 đến 20 sheet để nhập.");
  const mappings: PriceListSheetMapping[] = [];
  const mappedSheets = new Set<string>();
  for (const value of parsed) {
    if (!isRecord(value) || typeof value.sheet !== "string" || !value.sheet.trim() || value.sheet.length > 100 || !Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > 30 || !Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > 200) {
      throw new Error("Cấu hình sheet hoặc tiêu đề cột không hợp lệ.");
    }
    if (mappedSheets.has(value.sheet)) throw new Error(`Sheet ${value.sheet} chỉ được chọn một lần.`);
    mappedSheets.add(value.sheet);
    if (!value.roles.every((role) => typeof role === "string" && allowedRoles.has(role as PriceListColumnRole))) {
      throw new Error("Cách ghép cột không hợp lệ.");
    }
    const header = rows.find((row) => row.sheet === value.sheet && row.row === Number(value.headerRow));
    if (!header || header.cells.length !== value.roles.length) throw new Error(`Tiêu đề sheet ${value.sheet} không khớp với file đã xem trước. Hãy xem trước file và chọn lại cột.`);
    mappings.push({ sheet: value.sheet, headerRow: Number(value.headerRow), headers: header.cells, roles: value.roles as PriceListColumnRole[] });
  }
  return mappings;
}

async function writeAudit(db: Db, user: SessionUser, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await db.collection("auditLogs").insertOne({
    companyId: user.companyId,
    actorId: user.id,
    action,
    entityType,
    entityId,
    details,
    createdAt: new Date(),
  });
}

function uploadedFileDetails(file: CompanyFile) {
  return {
    _id: file._id?.toHexString(),
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    bytes: file.bytes,
    createdAt: file.createdAt,
  };
}

function quoteLineDetails(line: Quote["lines"][number]) {
  const description = line.description?.trim() ? [`Mô tả: ${line.description.trim()}`] : [];
  const catalogDetails = Object.entries(line.catalogAttributes ?? {}).map(([key, value]) => `${key}: ${value}`);
  const requestedDetails = Object.entries(line.attributes ?? {}).map(([key, value]) => `Yêu cầu ${key}: ${value}`);
  return [...description, ...catalogDetails, ...requestedDetails].join(" · ");
}

function makePdf(quote: Quote) {
  const virtualFonts = require("pdfmake/build/vfs_fonts.js") as Record<string, string>;
  const loadFont = (fileName: string) => {
    const contents = virtualFonts[fileName];
    if (!contents) throw new Error(`PDF font is missing: ${fileName}`);
    return Buffer.from(contents, "base64");
  };
  const printer = new PdfPrinter({
    Roboto: {
      normal: loadFont("Roboto-Regular.ttf"),
      bold: loadFont("Roboto-Medium.ttf"),
      italics: loadFont("Roboto-Italic.ttf"),
      bolditalics: loadFont("Roboto-MediumItalic.ttf"),
    },
  });
  const definition: PdfDocumentDefinition = {
    pageSize: "A4",
    pageMargins: [48, 48, 48, 54],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#26343c" },
    content: [
      { text: "BÁO GIÁ", style: "title" },
      { text: `Số ${quote.quoteNumber}`, style: "subtitle", margin: [0, 4, 0, 24] },
      { text: "THÔNG TIN KHÁCH HÀNG", style: "section" },
      { columns: [{ width: "*", text: `Khách hàng: ${quote.customerName}` }, { width: "*", text: `Email: ${quote.customerEmail || "—"}`, alignment: "right" }], margin: [0, 5, 0, 22] },
      ...(quote.customerPhone ? [{ text: `Số điện thoại: ${quote.customerPhone}`, margin: [0, 0, 0, 12] as [number, number, number, number] }] : []),
      {
        table: {
          headerRows: 1,
          widths: [52, "*", 55, 42, 80, 85],
          body: [
            ["Mã hàng", "Tên sản phẩm", "SL", "ĐVT", "Đơn giá", "Thành tiền"],
            ...quote.lines.map((line) => [
              line.sku,
              `${line.name}${quoteLineDetails(line) ? `\n${quoteLineDetails(line)}` : ""}`,
              { text: String(line.quantity), alignment: "right" as const },
              { text: line.unit, alignment: "center" as const },
              { text: formatMoney(line.unitPrice, quote.currency), alignment: "right" as const },
              { text: formatMoney(line.lineTotal, quote.currency), alignment: "right" as const },
            ]),
          ],
        },
        layout: {
          fillColor: (rowIndex: number) => rowIndex === 0 ? "#eaf2ef" : null,
          hLineColor: () => "#dce4e1",
          vLineColor: () => "#dce4e1",
          paddingLeft: () => 7,
          paddingRight: () => 7,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
      },
      {
        columns: [
          { width: "*", text: "Giá được tính từ bảng giá đã xác nhận tại thời điểm tạo báo giá.", color: "#74817f", fontSize: 8, margin: [0, 16, 0, 0] },
          { width: 210, table: { widths: ["*", 95], body: [
            ["Tạm tính", { text: formatMoney(quote.subtotal, quote.currency), alignment: "right" }],
            ["Phí vận chuyển", { text: formatMoney(quote.shippingFee ?? 0, quote.currency), alignment: "right" }],
            [`Thuế (${(quote.taxRate * 100).toLocaleString("vi-VN")}%)`, { text: formatMoney(quote.taxAmount, quote.currency), alignment: "right" }],
            [{ text: "TỔNG CỘNG", bold: true }, { text: formatMoney(quote.total, quote.currency), bold: true, alignment: "right" }],
          ] }, layout: "noBorders", margin: [0, 12, 0, 0] },
        ],
      },
      ...[
        ...(quote.validityDays == null ? [] : [`Hiệu lực báo giá: ${quote.validityDays} ngày`]),
        ...(quote.completionDate ? [`Hạn hoàn thành: ${new Date(`${quote.completionDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" })}`] : []),
      ].map((text) => ({ text, margin: [0, 4, 0, 0] as [number, number, number, number] })),
      { text: `Ngày tạo: ${new Date(quote.createdAt).toLocaleDateString("vi-VN")}`, color: "#74817f", fontSize: 8, margin: [0, 36, 0, 0] },
    ],
    styles: {
      title: { fontSize: 26, bold: true, color: "#1e4d40", characterSpacing: 0.4 },
      subtitle: { fontSize: 10, color: "#74817f" },
      section: { fontSize: 9, bold: true, color: "#45635b", characterSpacing: 0.8 },
    },
  };
  const document = printer.createPdfKitDocument(definition);
  return document;
}

function makePdfBuffer(quote: Quote): Promise<Buffer> {
  const document = makePdf(quote);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.end();
  });
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("vi-VN").format(amount)} ${currency}`;
  }
}

app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

app.post("/api/auth/login", async (request, response) => {
  const key = request.ip ?? "unknown";
  const now = Date.now();
  const attempts = loginAttempts.get(key);
  if (attempts && attempts.resetAt > now && attempts.count >= 10) {
    response.status(429).json({ error: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau một phút." });
    return;
  }
  const email = request.body?.email;
  const password = request.body?.password;
  if (typeof email !== "string" || typeof password !== "string" || password.length > 200) {
    fail(response, "Vui lòng nhập email và mật khẩu.");
    return;
  }
  const result = await login(email, password, response);
  if (!result) {
    loginAttempts.set(key, { count: (attempts?.resetAt ?? 0) > now ? (attempts?.count ?? 0) + 1 : 1, resetAt: now + 60_000 });
    response.status(401).json({ error: "Email hoặc mật khẩu chưa đúng." });
    return;
  }
  loginAttempts.delete(key);
  response.json({ user: result });
});

app.post("/api/auth/register", async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin đăng ký không hợp lệ.");
  const body = request.body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  const profile = parseCompanyProfile(body);
  if (!validText(name, 200)) return fail(response, "Họ tên người dùng bắt buộc, tối đa 200 ký tự.");
  if (!validEmail(email)) return fail(response, "Email đăng nhập không hợp lệ.");
  if (typeof password !== "string" || password.length < 7 || password.length > 200) {
    return fail(response, "Mật khẩu cần dài từ 7 đến 200 ký tự.");
  }
  if (!profile.value) return fail(response, profile.error ?? "Thông tin doanh nghiệp chưa đầy đủ.");

  const db = await connectDatabase();
  const accounts = db.collection<UserAccount>("users");
  const companies = db.collection<Company>("companies");
  if (await accounts.findOne({ email }, { projection: { _id: 1 } })) return fail(response, "Email đăng nhập đã được dùng.", 409);
  if (await companies.findOne({ $or: [{ normalizedName: profile.value.normalizedName }, { taxId: profile.value.taxId }] }, { projection: { _id: 1 } })) {
    return fail(response, "Doanh nghiệp hoặc mã số thuế này đã được đăng ký.", 409);
  }

  const now = new Date();
  const company: Company = { ...profile.value, code: randomUUID(), planCode: "free", createdAt: now, updatedAt: now };
  let companyId: ObjectId;
  try {
    companyId = (await companies.insertOne(company)).insertedId;
  } catch (error) {
    if (isDuplicateKey(error)) return fail(response, "Tên doanh nghiệp này đã được đăng ký.", 409);
    throw error;
  }
  const account: UserAccount = {
    id: randomUUID(),
    email,
    name,
    role: "user",
    passwordHash: hashPassword(password),
    companyId: companyId.toHexString(),
    active: true,
    authVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await accounts.insertOne(account);
  } catch (error) {
    await companies.deleteOne({ _id: companyId });
    if (isDuplicateKey(error)) return fail(response, "Email đăng nhập đã được dùng.", 409);
    throw error;
  }
  await db.collection("auditLogs").insertOne({
    companyId: account.companyId,
    actorId: account.id,
    action: "business_self_registered",
    entityType: "company",
    entityId: account.companyId,
    createdAt: now,
  });
  const user = await login(email, password, response);
  if (!user) return fail(response, "Đã tạo tài khoản nhưng chưa thể đăng nhập. Hãy đăng nhập lại.", 500);
  response.status(201).json({ user });
});

app.post("/api/auth/logout", (_request, response) => {
  logout(response);
  response.status(204).end();
});

app.get("/api/plans", async (_request, response) => {
  const plans = await (await connectDatabase()).collection<SubscriptionPlan>("subscriptionPlans")
    .find({ active: true })
    .sort({ displayOrder: 1, monthlyPrice: 1 })
    .toArray();
  response.json({ plans: plans.map(publicPlan) });
});

app.post("/api/plan-contact-requests", async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin liên hệ không hợp lệ.");
  const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const companyName = typeof request.body.companyName === "string" ? request.body.companyName.trim() : "";
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const phone = typeof request.body.phone === "string" ? request.body.phone.trim() : "";
  const message = typeof request.body.message === "string" ? request.body.message.trim() : "";
  if (!validText(name, 200)) return fail(response, "Vui lòng nhập họ tên, tối đa 200 ký tự.");
  if (!validText(companyName, 200)) return fail(response, "Vui lòng nhập tên doanh nghiệp, tối đa 200 ký tự.");
  if (!validEmail(email)) return fail(response, "Email liên hệ không hợp lệ.");
  if (phone.length > 50) return fail(response, "Số điện thoại tối đa 50 ký tự.");
  if (!validText(message, 5_000)) return fail(response, "Vui lòng mô tả nhu cầu, tối đa 5.000 ký tự.");
  const now = new Date();
  const contactRequest: PlanContactRequest = { name, companyName, email, phone, message, status: "new", createdAt: now, updatedAt: now };
  const result = await (await connectDatabase()).collection<PlanContactRequest>("planContactRequests").insertOne(contactRequest);
  response.status(201).json({ request: { ...contactRequest, id: result.insertedId.toHexString() } });
});

app.post("/api/billing/sepay/webhook", async (request, response) => {
  const db = await connectDatabase();
  const sepaySettings = await getSepaySettings(db);
  const webhookKey = sepaySettings.webhookApiKey;
  if (!webhookKey) return response.status(503).json({ success: false });
  const expectedAuthorization = Buffer.from(`Apikey ${webhookKey}`);
  const receivedAuthorization = Buffer.from(request.get("authorization") ?? "");
  if (expectedAuthorization.length !== receivedAuthorization.length || !timingSafeEqual(expectedAuthorization, receivedAuthorization)) {
    logger.warn("billing.sepay_webhook_unauthorized", { requestId: response.locals.requestId });
    return response.status(401).json({ success: false });
  }
  if (!isRecord(request.body)) return response.status(400).json({ success: false });

  const transactionId = request.body.id === undefined || request.body.id === null ? "" : String(request.body.id).trim();
  const transferType = typeof request.body.transferType === "string" ? request.body.transferType.toLowerCase() : "";
  const transferAmount = Number(request.body.transferAmount);
  if (!transactionId || transactionId.length > 200) return response.status(400).json({ success: false });
  if (transferType !== "in" || !Number.isSafeInteger(transferAmount) || transferAmount <= 0) {
    return response.json({ success: true, ignored: true });
  }

  const codeField = typeof request.body.code === "string" ? request.body.code.toUpperCase() : "";
  const content = [request.body.content, request.body.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
  const paymentCodes = [...new Set([codeField, content].flatMap((value) =>
    Array.from(value.matchAll(/[A-Z]{2,5}[A-F0-9]{10}/g), ([code]) => code),
  ))];
  if (!paymentCodes.length) return response.json({ success: true, ignored: true });

  const payments = db.collection<SubscriptionPayment>("subscriptionPayments");
  let payment = await payments.findOne({ code: { $in: paymentCodes } });
  if (!payment || payment.status === "superseded") return response.json({ success: true, ignored: true });
  if (transferAmount < payment.amount) return response.json({ success: true, ignored: true });
  const paymentCode = payment.code;

  if (payment.status === "pending") {
    const paidAt = new Date();
    const companies = db.collection<Company>("companies");
    const company = await companies.findOne({ _id: new ObjectId(payment.companyId) }, { projection: { planCode: 1, subscriptionExpiresAt: 1 } });
    if (!company) return response.status(503).json({ success: false });
    const subscriptionStartsAt = company.subscriptionExpiresAt && company.subscriptionExpiresAt > paidAt ? company.subscriptionExpiresAt : paidAt;
    const subscriptionExpiresAt = addCalendarMonth(subscriptionStartsAt);
    try {
      await payments.updateOne(
        { _id: payment._id, status: "pending" },
        { $set: { status: "paid", paidAt, sepayTransactionId: transactionId, subscriptionStartsAt, subscriptionExpiresAt, updatedAt: paidAt } },
      );
    } catch (error) {
      if (isDuplicateKey(error)) return response.json({ success: true, ignored: true });
      throw error;
    }
    payment = await payments.findOne({ _id: payment._id });
  }

  if (payment?.status === "paid" && payment.sepayTransactionId === transactionId && payment.subscriptionExpiresAt && payment.subscriptionStartsAt) {
    await db.collection<Company>("companies").updateOne(
      {
        _id: new ObjectId(payment.companyId),
        $or: [
          { billingPaymentCreatedAt: { $exists: false } },
          { billingPaymentCreatedAt: { $lte: payment.createdAt } },
        ],
      },
      {
        $set: {
          planCode: payment.planCode,
          subscriptionExpiresAt: payment.subscriptionExpiresAt,
          billingPaymentCreatedAt: payment.createdAt,
          updatedAt: payment.paidAt ?? new Date(),
        },
      },
    );
    logger.info("billing.sepay_payment_applied", {
      transactionId,
      paymentCode,
      companyId: payment.companyId,
      planCode: payment.planCode,
      amount: payment.amount,
    });
  }
  return response.json({ success: true });
});

app.use("/api", requireAuth);
app.get("/api/auth/me", async (request, response) => {
  const user = userOf(request);
  if (user.role !== "user") return response.json({ user });
  const db = await connectDatabase();
  const { plan } = await currentCompanyPlan(db, user.companyId);
  response.json({ user: { ...user, plan: plan ? publicPlan(plan) : null } });
});

app.get("/api/usage", requireRole("user"), async (request, response) => {
  const usage = await subscriptionUsage(await connectDatabase(), userOf(request).companyId);
  response.json({ ...usage, subscriptionExpiresAt: usage.subscriptionExpiresAt?.toISOString() ?? null, plan: publicPlan(usage.plan) });
});

app.post("/api/billing/payments", requireRole("user"), async (request, response) => {
  if (!isRecord(request.body) || typeof request.body.planCode !== "string") return fail(response, "Vui lòng chọn gói cần đăng ký.");
  const db = await connectDatabase();
  const sepaySettings = await getSepaySettings(db);
  if (!isSepayConfigured(sepaySettings)) return fail(response, "Thanh toán SePay chưa được cấu hình đầy đủ. Vui lòng liên hệ quản trị viên.", 503);
  const plan = await db.collection<SubscriptionPlan>("subscriptionPlans").findOne({ code: request.body.planCode, active: true });
  if (!plan) return fail(response, "Gói dịch vụ không còn khả dụng.", 404);
  if (plan.monthlyPrice === null || plan.monthlyPrice <= 0 || !Number.isSafeInteger(plan.monthlyPrice)) {
    return fail(response, "Gói này chưa thể thanh toán trực tuyến. Vui lòng liên hệ tư vấn.");
  }

  const user = userOf(request);
  const payments = db.collection<SubscriptionPayment>("subscriptionPayments");
  const now = new Date();
  await payments.updateMany(
    { companyId: user.companyId, status: "pending" },
    { $set: { status: "superseded", updatedAt: now } },
  );
  const code = `${sepaySettings.paymentPrefix}${randomBytes(5).toString("hex").toUpperCase()}`;
  const payment: SubscriptionPayment = {
    code,
    companyId: user.companyId,
    createdBy: user.id,
    planCode: plan.code,
    planName: plan.name,
    amount: plan.monthlyPrice,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  let insertedId: ObjectId;
  try {
    insertedId = (await payments.insertOne(payment)).insertedId;
  } catch (error) {
    if (isDuplicateKey(error)) return fail(response, "Một yêu cầu thanh toán khác vừa được tạo. Vui lòng tải lại và kiểm tra trạng thái.", 409);
    throw error;
  }
  const qr = new URL("https://vietqr.app/img");
  qr.searchParams.set("acc", sepaySettings.accountNumber);
  qr.searchParams.set("bank", sepaySettings.bankCode);
  qr.searchParams.set("amount", String(payment.amount));
  qr.searchParams.set("des", payment.code);
  qr.searchParams.set("template", "compact");
  qr.searchParams.set("showinfo", "true");
  qr.searchParams.set("fullacc", "true");
  if (sepaySettings.accountName) qr.searchParams.set("holder", sepaySettings.accountName.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toUpperCase());
  qr.searchParams.set("store", "IGEN TRO LI BAO GIA");
  response.status(201).json({
    payment: {
      id: insertedId.toHexString(),
      code: payment.code,
      amount: payment.amount,
      planCode: payment.planCode,
      planName: payment.planName,
      status: payment.status,
      qrUrl: qr.toString(),
      bankCode: sepaySettings.bankCode,
      accountNumber: sepaySettings.accountNumber,
      accountName: sepaySettings.accountName,
      createdAt: payment.createdAt.toISOString(),
    },
  });
});

app.get("/api/billing/payments/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã thanh toán không hợp lệ.", 404);
  const payment = await (await connectDatabase()).collection<SubscriptionPayment>("subscriptionPayments").findOne(
    { _id: id, companyId: userOf(request).companyId },
    { projection: { code: 1, planCode: 1, planName: 1, amount: 1, status: 1, createdAt: 1, paidAt: 1 } },
  );
  if (!payment) return fail(response, "Không tìm thấy thanh toán.", 404);
  response.json({ payment: { id: payment._id!.toHexString(), code: payment.code, planCode: payment.planCode, planName: payment.planName, amount: payment.amount, status: payment.status, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null } });
});

app.get("/api/admin/plans", requireSystemAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const [plans, counts] = await Promise.all([
    db.collection<SubscriptionPlan>("subscriptionPlans").find({}).sort({ displayOrder: 1, monthlyPrice: 1 }).toArray(),
    db.collection<Company>("companies").aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: { $ifNull: ["$planCode", "free"] }, count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const countsByPlan = new Map(counts.map((entry) => [entry._id ?? "free", entry.count]));
  response.json({ plans: plans.map((plan) => ({ ...publicPlan(plan), assignedBusinesses: countsByPlan.get(plan.code) ?? 0 })) });
});

app.post("/api/admin/plans", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin gói dịch vụ không hợp lệ.");
  const db = await connectDatabase();
  const code = `custom-${randomUUID()}`;
  const parsed = parsePlanInput(request.body, code);
  if ("error" in parsed) return fail(response, parsed.error ?? "Thông tin gói dịch vụ không hợp lệ.");
  const now = new Date();
  const plan: SubscriptionPlan = { code, ...parsed.value, createdAt: now, updatedAt: now };
  await db.collection<SubscriptionPlan>("subscriptionPlans").insertOne(plan);
  await writeAudit(db, userOf(request), "subscription_plan_created", "subscriptionPlan", code, { name: plan.name });
  response.status(201).json({ plan: publicPlan(plan) });
});

app.patch("/api/admin/plans/:code", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin gói dịch vụ không hợp lệ.");
  const code = request.params.code;
  if (typeof code !== "string") return fail(response, "Mã gói không hợp lệ.");
  const db = await connectDatabase();
  const collection = db.collection<SubscriptionPlan>("subscriptionPlans");
  const existing = await collection.findOne({ code });
  if (!existing) return fail(response, "Không tìm thấy gói dịch vụ.", 404);
  const parsed = parsePlanInput(request.body, code, existing);
  if ("error" in parsed) return fail(response, parsed.error ?? "Thông tin gói dịch vụ không hợp lệ.");
  const updatedAt = new Date();
  await collection.updateOne({ code }, { $set: { ...parsed.value, updatedAt } });
  const updated = { ...existing, ...parsed.value, updatedAt };
  await writeAudit(db, userOf(request), "subscription_plan_updated", "subscriptionPlan", code, { name: updated.name, active: updated.active });
  response.json({ plan: publicPlan(updated) });
});

app.get("/api/admin/plan-contact-requests", requireSystemAdmin, async (_request, response) => {
  const requests = await (await connectDatabase()).collection<PlanContactRequest>("planContactRequests")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ requests: requests.map(({ _id, ...contactRequest }) => ({ ...contactRequest, id: _id?.toHexString() ?? "" })) });
});

app.patch("/api/admin/plan-contact-requests/:id", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin xử lý không hợp lệ.");
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã yêu cầu không hợp lệ.");
  const allowedFields = ["status", "adminNote"];
  if (Object.keys(request.body).length === 0 || Object.keys(request.body).some((key) => !allowedFields.includes(key))) {
    return fail(response, "Hãy chọn thông tin cần cập nhật.");
  }
  const updates: Partial<PlanContactRequest> = { updatedAt: new Date() };
  if (request.body.status !== undefined) {
    const validStatuses: ContactRequestStatus[] = ["new", "contacted", "closed"];
    if (typeof request.body.status !== "string" || !validStatuses.includes(request.body.status as ContactRequestStatus)) return fail(response, "Trạng thái xử lý không hợp lệ.");
    updates.status = request.body.status as ContactRequestStatus;
  }
  if (request.body.adminNote !== undefined) {
    if (typeof request.body.adminNote !== "string" || request.body.adminNote.trim().length > 2_000) return fail(response, "Ghi chú tối đa 2.000 ký tự.");
    updates.adminNote = request.body.adminNote.trim();
  }
  const db = await connectDatabase();
  const collection = db.collection<PlanContactRequest>("planContactRequests");
  const existing = await collection.findOne({ _id: id });
  if (!existing) return fail(response, "Không tìm thấy yêu cầu liên hệ.", 404);
  await collection.updateOne({ _id: id }, { $set: updates });
  const updated = { ...existing, ...updates };
  await writeAudit(db, userOf(request), "plan_contact_request_updated", "planContactRequest", id.toHexString(), {
    status: updated.status,
    noteUpdated: request.body.adminNote !== undefined,
  });
  response.json({ request: { ...updated, id: id.toHexString(), _id: undefined } });
});

app.get("/api/admin/businesses", requireSystemAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const accounts = await db.collection<UserAccount>("users")
    .find({ role: "user", companyId: { $type: "string" } })
    .sort({ createdAt: -1 })
    .toArray();
  const validAccounts = accounts.flatMap((account) => typeof account.companyId === "string" && ObjectId.isValid(account.companyId)
    ? [{ account, companyId: account.companyId }]
    : []);
  const companyIds = validAccounts.map(({ companyId }) => new ObjectId(companyId));
  const companies = await db.collection<Company>("companies").find({ _id: { $in: companyIds } }).toArray();
  const companiesById = new Map(companies.map((company) => [company._id?.toHexString(), company]));
  const plans = await db.collection<SubscriptionPlan>("subscriptionPlans").find({}).toArray();
  const plansByCode = new Map(plans.map((plan) => [plan.code, plan]));
  response.json({
    businesses: validAccounts.filter(({ companyId }) => companiesById.has(companyId)).map(({ account, companyId }) => {
      const company = companiesById.get(companyId);
      const planCode = company?.planCode ?? "free";
      const plan = plansByCode.get(planCode) ?? plansByCode.get("free");
      return {
        ...publicUserAccount(account),
        companyName: company?.name ?? "",
        taxId: company?.taxId ?? "",
        address: company?.address ?? "",
        phone: company?.phone ?? "",
        businessEmail: company?.businessEmail ?? "",
        representativeName: company?.representativeName ?? "",
        planCode: plan?.code ?? "free",
        planName: plan?.name ?? "Dùng thử",
      };
    }),
  });
});

app.post("/api/admin/businesses", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin doanh nghiệp không hợp lệ.");
  const body = request.body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  const profile = parseCompanyProfile(body);
  if (!validText(name, 200)) return fail(response, "Họ tên người dùng bắt buộc, tối đa 200 ký tự.");
  if (!validEmail(email)) return fail(response, "Email đăng nhập không hợp lệ.");
  if (typeof password !== "string" || password.length < 7 || password.length > 200) {
    return fail(response, "Mật khẩu ban đầu phải dài từ 7 đến 200 ký tự.");
  }
  if (!profile.value) return fail(response, profile.error ?? "Thông tin doanh nghiệp chưa đầy đủ.");

  const db = await connectDatabase();
  const accounts = db.collection<UserAccount>("users");
  const companies = db.collection<Company>("companies");
  const planCode = typeof body.planCode === "string" ? body.planCode : "free";
  const selectedPlan = await db.collection<SubscriptionPlan>("subscriptionPlans").findOne({ code: planCode, active: true });
  if (!selectedPlan) return fail(response, "Hãy chọn một gói đang hoạt động.");
  const existingAccount = await accounts.findOne({ email });
  const canAdoptLegacyAccount = Boolean(existingAccount)
    && existingAccount?.role !== "admin"
    && (!existingAccount?.id || typeof existingAccount.companyId !== "string" || !ObjectId.isValid(existingAccount.companyId) || typeof existingAccount.passwordHash !== "string");
  if (existingAccount && !canAdoptLegacyAccount) return fail(response, "Email đăng nhập đã được dùng.", 409);
  if (await companies.findOne({ normalizedName: profile.value.normalizedName }, { projection: { _id: 1 } })) {
    return fail(response, "Tên doanh nghiệp này đã tồn tại.", 409);
  }

  const now = new Date();
  const company: Company = { ...profile.value, code: randomUUID(), planCode, createdAt: now, updatedAt: now };
  let companyId: ObjectId;
  try {
    companyId = (await companies.insertOne(company)).insertedId;
  } catch (error) {
    if (isDuplicateKey(error)) return fail(response, "Tên doanh nghiệp này đã tồn tại.", 409);
    throw error;
  }
  const account: UserAccount = {
    id: randomUUID(),
    email,
    name,
    role: "user",
    passwordHash: hashPassword(password),
    companyId: companyId.toHexString(),
    active: true,
    authVersion: (existingAccount?.authVersion ?? 0) + 1,
    createdAt: existingAccount?.createdAt instanceof Date ? existingAccount.createdAt : now,
    updatedAt: now,
  };
  try {
    if (existingAccount) {
      await accounts.updateOne(
        { _id: existingAccount._id, email },
        { $set: account, $unset: { password: "", hashedPassword: "", tenantId: "" } },
      );
    } else {
      await accounts.insertOne(account);
    }
  } catch (error) {
    await companies.deleteOne({ _id: companyId });
    if (isDuplicateKey(error)) return fail(response, "Email đăng nhập đã được dùng.", 409);
    throw error;
  }
  const actor = userOf(request);
  await writeAudit(db, actor, existingAccount ? "legacy_account_converted_to_business" : "business_account_created", "company", companyId.toHexString(), { companyName: company.name });
  response.status(201).json({
    business: {
      ...publicUserAccount(account),
      companyName: profile.value.name,
      taxId: profile.value.taxId,
      address: profile.value.address,
      phone: profile.value.phone,
      businessEmail: profile.value.businessEmail,
      representativeName: profile.value.representativeName,
      planCode: selectedPlan.code,
      planName: selectedPlan.name,
    },
  });
});

app.patch("/api/admin/businesses/:id", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin doanh nghiệp không hợp lệ.");
  const body = request.body;
  const allowedFields = ["name", "email", "active", "companyName", "taxId", "address", "phone", "businessEmail", "representativeName", "planCode"];
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return fail(response, "Hãy chọn thông tin doanh nghiệp cần cập nhật.");
  }
  const targetId = request.params.id;
  if (typeof targetId !== "string") return fail(response, "Mã tài khoản không hợp lệ.");
  const db = await connectDatabase();
  const accounts = db.collection<UserAccount>("users");
  const target = await accounts.findOne({ id: targetId, role: "user" });
  if (!target || typeof target.companyId !== "string" || !ObjectId.isValid(target.companyId)) return fail(response, "Không tìm thấy doanh nghiệp.", 404);

  const profile = parseCompanyProfile(body);
  if (!profile.value) return fail(response, profile.error ?? "Thông tin doanh nghiệp chưa đầy đủ.");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validText(name, 200)) return fail(response, "Họ tên người dùng không hợp lệ.");
  if (!validEmail(email)) return fail(response, "Email đăng nhập không hợp lệ.");
  if (await accounts.findOne({ email, id: { $ne: targetId } }, { projection: { _id: 1 } })) {
    return fail(response, "Email đăng nhập đã được dùng.", 409);
  }
  const companyId = new ObjectId(target.companyId);
  const companies = db.collection<Company>("companies");
  const existingCompany = await companies.findOne({ _id: companyId });
  if (!existingCompany) return fail(response, "Không tìm thấy hồ sơ doanh nghiệp.", 404);
  if (await companies.findOne({ normalizedName: profile.value.normalizedName, _id: { $ne: companyId } }, { projection: { _id: 1 } })) {
    return fail(response, "Tên doanh nghiệp này đã tồn tại.", 409);
  }
  const planCode = typeof body.planCode === "string" ? body.planCode : existingCompany.planCode ?? "free";
  const selectedPlan = await db.collection<SubscriptionPlan>("subscriptionPlans").findOne({ code: planCode });
  if (!selectedPlan || (!selectedPlan.active && planCode !== (existingCompany.planCode ?? "free"))) {
    return fail(response, "Hãy chọn một gói đang hoạt động.");
  }

  const active = body.active;
  if (typeof active !== "boolean") return fail(response, "Trạng thái doanh nghiệp không hợp lệ.");
  const updates: Partial<Pick<UserAccount, "name" | "email" | "active" | "authVersion" | "updatedAt">> = {
    name,
    email,
    active,
    updatedAt: new Date(),
    ...((target.active !== false) !== active ? { authVersion: (target.authVersion ?? 0) + 1 } : {}),
  };
  await companies.updateOne({ _id: companyId }, {
    $set: { ...profile.value, planCode, updatedAt: new Date() },
    $unset: { subscriptionExpiresAt: "" },
  });
  await accounts.updateOne({ id: targetId, companyId: target.companyId }, { $set: updates });
  await writeAudit(db, userOf(request), "business_account_updated", "company", target.companyId, { fields: Object.keys(body), planCode });
  response.json({
    business: {
      ...publicUserAccount({ ...target, ...updates }),
      companyName: profile.value.name,
      taxId: profile.value.taxId,
      address: profile.value.address,
      phone: profile.value.phone,
      businessEmail: profile.value.businessEmail,
      representativeName: profile.value.representativeName,
      planCode: selectedPlan.code,
      planName: selectedPlan.name,
    },
  });
});

app.put("/api/admin/businesses/:id/password", requireSystemAdmin, async (request, response) => {
  const password = request.body?.password;
  if (typeof password !== "string" || password.length < 7 || password.length > 200) {
    return fail(response, "Mật khẩu mới phải dài từ 7 đến 200 ký tự.");
  }
  const targetId = request.params.id;
  if (typeof targetId !== "string") return fail(response, "Mã tài khoản không hợp lệ.");
  const db = await connectDatabase();
  const target = await db.collection<UserAccount>("users").findOneAndUpdate(
    { id: targetId, role: "user" },
    { $set: { passwordHash: hashPassword(password), updatedAt: new Date() }, $inc: { authVersion: 1 } },
    { returnDocument: "after", projection: { companyId: 1 } },
  );
  if (!target) return fail(response, "Không tìm thấy doanh nghiệp.", 404);
  if (typeof target.companyId !== "string") return fail(response, "Hồ sơ doanh nghiệp không hợp lệ.", 409);
  await writeAudit(db, userOf(request), "business_password_reset", "company", target.companyId);
  response.status(204).end();
});

app.get("/api/admin/settings/sepay", requireSystemAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const stored = await db.collection<PlatformSepaySettingsDocument>("platformSettings").findOne({ _id: "sepay" });
  const settings = await getSepaySettings(db);
  response.json({
    settings: {
      bankCode: settings.bankCode,
      accountNumber: settings.accountNumber,
      accountName: settings.accountName,
      paymentPrefix: settings.paymentPrefix,
      configured: isSepayConfigured(settings),
      webhookApiKeySet: Boolean(settings.webhookApiKey),
      webhookApiKeySource: stored?.sepaySettings?.webhookApiKeyEncrypted ? "admin" : config.sepay.webhookApiKey ? "environment" : "none",
    },
  });
});

app.put("/api/admin/settings/sepay", requireSystemAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin tài khoản ngân hàng không hợp lệ.");
  const body = request.body;
  const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  const paymentPrefix = typeof body.paymentPrefix === "string" ? body.paymentPrefix.trim().toUpperCase() : "";
  const webhookApiKey = typeof body.webhookApiKey === "string" ? body.webhookApiKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(bankCode)) return fail(response, "Mã ngân hàng SePay không hợp lệ.");
  if (!/^[A-Za-z0-9]{1,19}$/.test(accountNumber)) return fail(response, "Số tài khoản phải gồm 1 đến 19 chữ số hoặc chữ cái.");
  if (accountName.length > 100) return fail(response, "Tên chủ tài khoản tối đa 100 ký tự.");
  if (!/^[A-Z]{2,5}$/.test(paymentPrefix)) return fail(response, "Mã thanh toán phải gồm 2 đến 5 chữ cái.");
  if (typeof body.webhookApiKey !== "undefined" && typeof body.webhookApiKey !== "string") return fail(response, "API Key webhook không hợp lệ.");
  if (webhookApiKey.length > 1024) return fail(response, "API Key webhook quá dài.");

  const db = await connectDatabase();
  const collection = db.collection<PlatformSepaySettingsDocument>("platformSettings");
  const existing = await collection.findOne({ _id: "sepay" });
  const existingKey = existing?.sepaySettings?.webhookApiKeyEncrypted;
  const sepaySettings: NonNullable<PlatformSepaySettingsDocument["sepaySettings"]> = {
    bankCode,
    accountNumber,
    accountName,
    paymentPrefix,
    ...(webhookApiKey
      ? { webhookApiKeyEncrypted: encryptCompanySecret(webhookApiKey, SEPAY_SECRET_SALT, SEPAY_SECRET_INFO) }
      : existingKey ? { webhookApiKeyEncrypted: existingKey } : {}),
  };
  await collection.updateOne({ _id: "sepay" }, { $set: { sepaySettings, updatedAt: new Date() } }, { upsert: true });
  await writeAudit(db, userOf(request), "platform_sepay_settings_updated", "platformSettings", "sepay", {
    bankCode,
    accountNumberLast4: accountNumber.slice(-4),
    paymentPrefix,
    webhookApiKeyUpdated: Boolean(webhookApiKey),
  });
  const effective = await getSepaySettings(db);
  response.json({
    settings: {
      bankCode: effective.bankCode,
      accountNumber: effective.accountNumber,
      accountName: effective.accountName,
      paymentPrefix: effective.paymentPrefix,
      configured: isSepayConfigured(effective),
      webhookApiKeySet: Boolean(effective.webhookApiKey),
      webhookApiKeySource: sepaySettings.webhookApiKeyEncrypted ? "admin" : config.sepay.webhookApiKey ? "environment" : "none",
    },
  });
});

app.get("/api/quote-templates", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const category = (request.query.category === undefined ? "quote" : String(request.query.category)) as NonNullable<QuoteTemplate["category"]>;
  if (!["quote", "estimate", "contract", "acceptance"].includes(category)) return fail(response, "Loại mẫu không hợp lệ.");
  const cursor = request.query.cursor === undefined ? undefined : asId(String(request.query.cursor));
  if (request.query.cursor !== undefined && !cursor) return fail(response, "Trang danh sách mẫu không hợp lệ.");
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(user.companyId) }, { projection: { quoteTemplateId: 1 } });
  const templates = await db.collection<QuoteTemplate>("quoteTemplates")
    .find({ companyId: user.companyId, deletedAt: { $exists: false }, category: category === "quote" ? { $in: ["quote", null] } : category, ...(cursor ? { _id: { $lt: cursor } } : {}) }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } })
    .sort({ _id: -1 }).limit(13).toArray();
  const page = templates.slice(0, 12);
  response.json({ templates: page.map(templateDetails), defaultTemplateId: category === "quote" ? company?.quoteTemplateId ?? null : page[0]?._id?.toHexString() ?? null, nextCursor: templates.length > 12 ? page[11]._id!.toHexString() : null });
});

app.get("/api/quote-template", requireRole("user"), async (request, response) => {
  const template = await currentTemplate(await connectDatabase(), userOf(request).companyId);
  response.json({ template: template ? templateDetails(template) : null });
});

app.post("/api/quote-template", requireRole("user"), enforceTemplateQuota, express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
  const category = request.header("x-template-category") || "quote";
  if (!["quote", "estimate", "contract", "acceptance"].includes(category)) return fail(response, "Loại mẫu không hợp lệ.");
  if (!Buffer.isBuffer(request.body) || !request.body.length) return fail(response, "Hãy chọn file mẫu báo giá.");
  let name: string;
  try { name = decodeURIComponent(request.header("x-template-name") ?? "").trim(); }
  catch { return fail(response, "Tên mẫu không hợp lệ."); }
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) return fail(response, "Vui lòng nhập tên mẫu, tối đa 200 ký tự.");
  let originalFilename: string;
  try { originalFilename = decodeURIComponent(request.header("x-file-name") ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, "").trim(); }
  catch { return fail(response, "Tên file không hợp lệ."); }
  if (!originalFilename || originalFilename.length > 255) return fail(response, "Tên file không hợp lệ.");
  const extension = originalFilename.split(".").pop()!.toLowerCase();
  try { await inspectTemplate(request.body, extension); }
  catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được mẫu báo giá.", 422); }
  const db = await connectDatabase();
  const user = userOf(request);
  const companyId = new ObjectId(user.companyId);
  if (!await db.collection<Company>("companies").findOne({ _id: companyId })) return fail(response, "Không tìm thấy doanh nghiệp.", 404);
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.templates.limit !== null && usage.templates.used >= usage.templates.limit) return fail(response, templateQuotaMessage(usage.plan), 429);
  const template: QuoteTemplate = { companyId: user.companyId, category: category as QuoteTemplate["category"], name, originalFilename, extension, bytes: request.body.length, data: new Binary(request.body), createdAt: new Date(), uploadedBy: user.id };
  const result = await db.collection<QuoteTemplate>("quoteTemplates").insertOne(template);
  template._id = result.insertedId;
  if (category === "quote") await db.collection<Company>("companies").updateOne({ _id: companyId }, { $set: { quoteTemplateId: result.insertedId.toHexString(), updatedAt: new Date() } });
  await writeAudit(db, user, "quote_template_uploaded", "company", user.companyId, { templateId: result.insertedId.toHexString(), originalFilename, category });
  response.status(201).json({ template: templateDetails(template) });
});

app.delete("/api/quote-template/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã mẫu không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const templates = db.collection<QuoteTemplate>("quoteTemplates");
  const removed = await templates.findOneAndUpdate(
    { _id: id, companyId: user.companyId, deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date() } },
    { returnDocument: "before", projection: { name: 1, originalFilename: 1 } },
  );
  if (!removed) return fail(response, "Không tìm thấy mẫu báo giá.", 404);
  const replacement = await templates.find({ companyId: user.companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] } }, { projection: { _id: 1 } })
    .sort({ _id: -1 }).limit(1).next();
  await db.collection<Company>("companies").updateOne(
    { _id: new ObjectId(user.companyId), quoteTemplateId: id.toHexString() },
    replacement
      ? { $set: { quoteTemplateId: replacement._id!.toHexString(), updatedAt: new Date() } }
      : { $set: { updatedAt: new Date() }, $unset: { quoteTemplateId: "" } },
  );
  await writeAudit(db, user, "quote_template_deleted", "quoteTemplate", id.toHexString(), { name: removed.name || removed.originalFilename });
  response.json({ deleted: true });
});

app.get("/api/quote-template/:id/file", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã mẫu không hợp lệ.");
  const db = await connectDatabase();
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: id, companyId: userOf(request).companyId }, { projection: { fillPlanCache: 0, xlsxFillPlanCache: 0 } });
  if (!template) return fail(response, "Không tìm thấy mẫu.", 404);
  const bytes = Buffer.from(template.data.buffer);
  if (request.query.preview === "1" && template.extension === "docx") {
    response.type("html").setHeader("Content-Disposition", "inline").send(previewDocxHtml(bytes, template.originalFilename));
    return;
  }
  response.setHeader("Content-Type", templateFormats[template.extension]);
  response.setHeader("Content-Disposition", `${request.query.preview === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(template.originalFilename)}`);
  response.send(bytes);
});

app.get("/api/price-list/:id/file", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã bảng giá không hợp lệ.");
  const file = await (await connectDatabase()).collection<PriceList>("priceLists").findOne({ _id: id, companyId: userOf(request).companyId }, { projection: { analysisRows: 0 } });
  if (!file) return fail(response, "Không tìm thấy bảng giá.", 404);
  response.type(file.originalFilename.split(".").pop() === "csv" ? "text/csv" : "application/octet-stream")
    .setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`)
    .send(Buffer.from(file.data.buffer));
});

app.get("/api/files", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const files = await db.collection<CompanyFile>("companyFiles")
    .find({ companyId: user.companyId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  response.json({ files: files.map(uploadedFileDetails) });
});

app.get("/api/files/:id/preview", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã tệp không hợp lệ.");
  const user = userOf(request);
  const file = await (await connectDatabase()).collection<CompanyFile>("companyFiles").findOne({ _id: id, companyId: user.companyId });
  if (!file) return fail(response, "Không tìm thấy tệp.", 404);
  try {
    const bytes = await downloadCompanyFile(file.assetId, config.cloudinary);
    response.setHeader("Content-Type", file.mimeType).setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`).setHeader("X-Content-Type-Options", "nosniff").send(bytes);
  } catch (error) { return fail(response, error instanceof Error ? error.message : "Không thể tải tệp xem trước.", 502); }
});

app.post("/api/files", requireRole("user"), express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) return fail(response, "Hãy chọn tệp cần tải lên.");
  const encodedName = request.header("x-file-name") ?? "";
  let requestedName = "";
  try { requestedName = decodeURIComponent(encodedName); } catch { return fail(response, "Tên tệp không hợp lệ."); }
  const originalFilename = requestedName.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() ?? "";
  if (!originalFilename || originalFilename.length > 255) return fail(response, "Tên tệp không hợp lệ.");
  const extension = originalFilename.match(/\.[^.]+$/)?.[0].toLocaleLowerCase("en") ?? "";
  const mimeByExtension: Record<string, string> = {
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const allowedMimeType = mimeByExtension[extension];
  const requestedMimeType = request.header("x-file-type")?.split(";")[0].trim().toLocaleLowerCase("en") ?? "";
  if (!allowedMimeType || (requestedMimeType && requestedMimeType !== "application/octet-stream" && requestedMimeType !== allowedMimeType)) {
    return fail(response, "Định dạng tệp chưa được hỗ trợ. Hãy dùng ảnh PNG/JPG/WEBP/GIF, PDF, CSV hoặc Excel.");
  }
  if (request.body.length > 10 * 1024 * 1024) return fail(response, "Tệp không được vượt quá 10 MB.");

  const db = await connectDatabase();
  const user = userOf(request);
  if (!config.cloudinaryConfigured) return fail(response, "Cloudinary chưa được cấu hình trong file .env của máy chủ.", 409);
  let uploaded;
  try {
    uploaded = await uploadCompanyFile(request.body, originalFilename, allowedMimeType, user.companyId, config.cloudinary);
  } catch (error) {
    return fail(response, error instanceof Error ? error.message : "Không thể tải tệp lên Cloudinary.", 502);
  }
  const file: CompanyFile = {
    companyId: user.companyId,
    uploadedBy: user.id,
    originalFilename,
    mimeType: allowedMimeType,
    bytes: request.body.length,
    publicId: uploaded.publicId,
    assetId: uploaded.assetId,
    resourceType: uploaded.resourceType,
    createdAt: new Date(),
  };
  const result = await db.collection<CompanyFile>("companyFiles").insertOne(file);
  file._id = result.insertedId;
  await writeAudit(db, user, "company_file_uploaded", "file", file._id.toHexString(), {
    originalFilename,
    mimeType: allowedMimeType,
    bytes: file.bytes,
  });
  response.status(201).json({ file: uploadedFileDetails(file) });
});

app.get("/api/dashboard", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const [total, drafts, pending, approved, recent] = await Promise.all([
    quotes.countDocuments({ companyId: user.companyId, kind: { $ne: "customer" } }),
    quotes.countDocuments({ companyId: user.companyId, kind: { $ne: "customer" }, status: "draft" }),
    quotes.countDocuments({ companyId: user.companyId, kind: { $ne: "customer" }, status: "pending_review" }),
    quotes.countDocuments({ companyId: user.companyId, kind: { $ne: "customer" }, status: "approved" }),
    quotes.find({ companyId: user.companyId, kind: { $ne: "customer" } }).sort({ createdAt: -1, _id: -1 }).limit(3).toArray(),
  ]);
  response.json({ counts: { total, drafts, pending, approved }, recent });
});

app.get("/api/price-list", requireRole("user"), async (request, response) => {
  const files = await (await connectDatabase()).collection<PriceList>("priceLists").find({ companyId: userOf(request).companyId }, { projection: { data: 0, analysisRows: 0 } }).sort({ updatedAt: -1, _id: -1 }).toArray();
  response.json({ files });
});

app.post("/api/price-list/preview", requireRole("user"), express.raw({ type: "application/octet-stream", limit: "5mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) return fail(response, "Hãy chọn file bảng giá.");
  let originalFilename: string;
  try { originalFilename = decodeURIComponent(request.header("x-file-name") ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
  catch { return fail(response, "Tên file không hợp lệ."); }
  if (!originalFilename || originalFilename.length > 255 || !/\.(csv|xlsx|xls)$/i.test(originalFilename)) return fail(response, "Chọn file CSV, XLSX hoặc XLS.");
  const user = userOf(request);
  const file: PriceList = { companyId: user.companyId, originalFilename, bytes: request.body.length, data: new Binary(request.body), uploadedBy: user.id, updatedAt: new Date() };
  try {
    file.analysisRows = extractPriceListRows(file);
    const db = await connectDatabase();
    const saved = await db.collection<CatalogImportSettingsDocument>("catalogImportMappings").findOne({ companyId: user.companyId });
    response.json({ preview: previewCatalogImport(file, saved?.sheets ?? []) });
  } catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được bảng giá.", 422); }
});

app.post("/api/price-list", requireRole("user"), express.raw({ type: "application/octet-stream", limit: "5mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) return fail(response, "Hãy chọn file bảng giá.");
  let originalFilename: string;
  try { originalFilename = decodeURIComponent(request.header("x-file-name") ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
  catch { return fail(response, "Tên file không hợp lệ."); }
  if (!originalFilename || originalFilename.length > 255 || !/\.(csv|xlsx|xls)$/i.test(originalFilename)) return fail(response, "Chọn file CSV, XLSX hoặc XLS.");
  const rawMapping = request.header("x-catalog-import-mapping");
  let mappings: PriceListSheetMapping[] | undefined;
  const user = userOf(request);
  const file: PriceList = { companyId: user.companyId, originalFilename, bytes: request.body.length, data: new Binary(request.body), uploadedBy: user.id, updatedAt: new Date() };
  let imported: Awaited<ReturnType<typeof extractCatalogProducts>>;
  try {
    file.analysisRows = extractPriceListRows(file);
    mappings = parseCatalogImportMapping(rawMapping, file.analysisRows);
    imported = await extractCatalogProducts(file, mappings);
  }
  catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được bảng giá.", 422); }
  const db = await connectDatabase();
  const now = new Date();
  const catalogCollection = db.collection<CatalogItem>("catalogItems");
  const existingItems = await catalogCollection.find({ companyId: user.companyId, sku: { $in: imported.products.map((product) => product.sku) } })
    .project({ sku: 1, name: 1, price: 1, currency: 1 })
    .toArray();
  const existingBySku = new Map(existingItems.map((item) => [item.sku, item]));
  const priceChanges = imported.products.flatMap((product) => {
    const previous = existingBySku.get(product.sku);
    if (!previous || (previous.price === product.price && previous.currency === product.currency)) return [];
    return [{ sku: product.sku, before: { price: previous.price, currency: previous.currency }, after: { price: product.price, currency: product.currency } }];
  });
  const operations = imported.products.map((product) => {
    const catalogProduct = {
      sku: product.sku,
      name: product.name,
      description: product.description,
      unit: product.unit,
      price: product.price,
      currency: product.currency,
      ...(Object.keys(product.attributes).length ? { attributes: product.attributes } : {}),
      ...(product.effectiveFrom ? { effectiveFrom: product.effectiveFrom } : {}),
      ...(product.effectiveTo ? { effectiveTo: product.effectiveTo } : {}),
    };
    const unset: { effectiveFrom?: "" | 1 | true; effectiveTo?: "" | 1 | true } = {};
    if (!catalogProduct.effectiveFrom) unset.effectiveFrom = "";
    if (!catalogProduct.effectiveTo) unset.effectiveTo = "";
    return {
      updateOne: {
        filter: { companyId: user.companyId, sku: catalogProduct.sku },
        update: {
          $set: { ...catalogProduct, active: true, updatedAt: now },
          $setOnInsert: { companyId: user.companyId, createdAt: now },
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        upsert: true,
      },
    };
  });
  const catalogResult = await catalogCollection.bulkWrite(operations, { ordered: true });
  file.productCount = imported.products.length;
  file.skippedRows = imported.skippedRows;
  file.updatedAt = now;
  const saved = await db.collection<PriceList>("priceLists").insertOne(file);
  if (mappings) {
    const settings = db.collection<CatalogImportSettingsDocument>("catalogImportMappings");
    const previousMappings = await settings.findOne({ companyId: user.companyId });
    const normalizeHeader = (header: string) => header.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
    const sameTemplate = (left: PriceListSheetMapping, right: PriceListSheetMapping) => left.sheet === right.sheet
      && left.headers.length === right.headers.length
      && left.headers.every((header, index) => normalizeHeader(header) === normalizeHeader(right.headers[index] ?? ""));
    const mergedMappings = [...(previousMappings?.sheets ?? []).filter((saved) => !mappings!.some((mapping) => sameTemplate(saved, mapping))), ...mappings].slice(-50);
    await settings.updateOne(
      { companyId: user.companyId },
      { $set: { sheets: mergedMappings, updatedAt: now }, $setOnInsert: { companyId: user.companyId, createdAt: now } },
      { upsert: true },
    );
  }
  await writeAudit(db, user, "price_list_uploaded", "company", user.companyId, { originalFilename, productCount: imported.products.length, skippedRows: imported.skippedRows });
  await writeAudit(db, user, "catalog_imported", "catalog", user.companyId, { source: originalFilename, count: imported.products.length, inserted: catalogResult.upsertedCount, updated: catalogResult.matchedCount, priceChanges });
  response.status(201).json({
    file: { _id: saved.insertedId.toHexString(), originalFilename, bytes: file.bytes, updatedAt: file.updatedAt, productCount: file.productCount, skippedRows: file.skippedRows },
    imported: { productCount: imported.products.length, inserted: catalogResult.upsertedCount, updated: catalogResult.matchedCount, skippedRows: imported.skippedRows },
  });
});

app.get("/api/catalog", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const items = await scoped<CatalogItem>(db, "catalogItems", user).sort({ sku: 1 }).limit(2000).toArray();
  response.json({ items, currency: config.currency });
});

app.patch("/api/catalog/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã sản phẩm không hợp lệ.");
  if (request.body?.active !== undefined && typeof request.body.active !== "boolean") return fail(response, "Trạng thái sản phẩm không hợp lệ.");
  const mapped = mapCatalogRow(request.body, 1, config.currency);
  if (!mapped.ok) return fail(response, mapped.error.replace(/^Dòng 1: /, ""), 422);

  const db = await connectDatabase();
  const user = userOf(request);
  const catalog = db.collection<CatalogItem>("catalogItems");
  const existing = await catalog.findOne({ _id: id, companyId: user.companyId });
  if (!existing) return fail(response, "Không tìm thấy sản phẩm.", 404);

  const duplicate = await catalog.findOne({ _id: { $ne: id }, companyId: user.companyId, sku: mapped.value.sku });
  if (duplicate) return fail(response, "Mã hàng này đã được dùng cho sản phẩm khác.", 409);

  const now = new Date();
  const { effectiveFrom, effectiveTo, ...fields } = mapped.value;
  const setFields = {
    ...fields,
    attributes: mapped.value.attributes ?? existing.attributes ?? {},
    active: request.body.active === undefined ? existing.active : request.body.active,
    updatedAt: now,
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveTo ? { effectiveTo } : {}),
  };
  const unsetFields = {
    ...(!effectiveFrom ? { effectiveFrom: true as const } : {}),
    ...(!effectiveTo ? { effectiveTo: true as const } : {}),
  };
  await catalog.updateOne(
    { _id: id, companyId: user.companyId },
    { $set: setFields, ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}) },
  );
  const item = await catalog.findOne({ _id: id, companyId: user.companyId });
  await writeAudit(db, user, "catalog_item_updated", "catalogItem", id.toHexString(), {
    before: { sku: existing.sku, name: existing.name, description: existing.description, unit: existing.unit, price: existing.price, currency: existing.currency, attributes: existing.attributes ?? {}, active: existing.active, effectiveFrom: existing.effectiveFrom, effectiveTo: existing.effectiveTo },
    after: { sku: setFields.sku, name: setFields.name, description: setFields.description, unit: setFields.unit, price: setFields.price, currency: setFields.currency, attributes: setFields.attributes, active: setFields.active, effectiveFrom: setFields.effectiveFrom, effectiveTo: setFields.effectiveTo },
  });
  response.json({ item });
});

app.post("/api/catalog/import/preview", requireRole("user"), (request, response) => {
  const rows: unknown = request.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) {
    fail(response, "Tệp cần có từ 1 đến 2.000 dòng dữ liệu.");
    return;
  }
  const normalized: CatalogImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const result = mapCatalogRow(row, index + 2, config.currency);
    if (!result.ok) errors.push(result.error);
    else if (seen.has(result.value.sku.toLocaleLowerCase("vi"))) errors.push(`Dòng ${index + 2}: mã hàng bị lặp trong tệp.`);
    else {
      seen.add(result.value.sku.toLocaleLowerCase("vi"));
      normalized.push(result.value);
    }
  });
  response.json({ rows: normalized, errors, validCount: normalized.length, invalidCount: errors.length });
});

app.post("/api/catalog/import/confirm", requireRole("user"), async (request, response) => {
  if (request.body?.confirmed !== true || !Array.isArray(request.body?.rows)) {
    fail(response, "Cần xác nhận dữ liệu đã xem trước.");
    return;
  }
  const rows = request.body.rows as unknown[];
  if (rows.length === 0 || rows.length > 2000) {
    fail(response, "Tệp cần có từ 1 đến 2.000 dòng dữ liệu.");
    return;
  }
  const normalized: CatalogImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const result = mapCatalogRow(row, index + 2, config.currency);
    if (!result.ok) errors.push(result.error);
    else if (seen.has(result.value.sku.toLocaleLowerCase("vi"))) errors.push(`Dòng ${index + 2}: mã hàng bị lặp trong tệp.`);
    else {
      seen.add(result.value.sku.toLocaleLowerCase("vi"));
      normalized.push(result.value);
    }
  });
  if (errors.length) {
    response.status(422).json({ error: "Có lỗi trong dữ liệu nhập.", errors });
    return;
  }
  const db = await connectDatabase();
  const user = userOf(request);
  const now = new Date();
  const catalogCollection = db.collection<CatalogItem>("catalogItems");
  const previousItems = await catalogCollection.find({ companyId: user.companyId, sku: { $in: normalized.map((row) => row.sku) } })
    .project({ sku: 1, price: 1, currency: 1 })
    .toArray();
  const previousBySku = new Map(previousItems.map((item) => [item.sku, item]));
  const priceChanges = normalized.flatMap((row) => {
    const previous = previousBySku.get(String(row.sku));
    if (!previous || (previous.price === row.price && previous.currency === row.currency)) return [];
    return [{ sku: row.sku, before: { price: previous.price, currency: previous.currency }, after: { price: row.price, currency: row.currency } }];
  });
  const operations = normalized.map((row) => ({
    updateOne: {
      filter: { companyId: user.companyId, sku: row.sku },
      update: { $set: { ...row, active: true, updatedAt: now }, $setOnInsert: { companyId: user.companyId, createdAt: now } },
      upsert: true,
    },
  }));
  const result = await catalogCollection.bulkWrite(operations, { ordered: false });
  await writeAudit(db, user, "catalog_imported", "catalog", user.companyId, { count: normalized.length, priceChanges });
  response.json({ imported: normalized.length, inserted: result.upsertedCount, updated: result.modifiedCount });
});

app.post("/api/request-files", requireRole("user"), enforceQuoteQuota, express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) return fail(response, "Hãy chọn file yêu cầu.");
  let originalFilename: string;
  try { originalFilename = decodeURIComponent(request.header("x-file-name") ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
  catch { return fail(response, "Tên file không hợp lệ."); }
  if (!originalFilename || originalFilename.length > 255) return fail(response, "Tên file không hợp lệ.");
  const user = userOf(request);
  const file: RequestFile = { companyId: user.companyId, uploadedBy: user.id, originalFilename, bytes: request.body.length, data: new Binary(request.body), createdAt: new Date() };
  try { await requestFileContent(file); }
  catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được file yêu cầu.", 422); }
  const saved = await (await connectDatabase()).collection<RequestFile>("requestFiles").insertOne(file);
  response.status(201).json({ file: { id: saved.insertedId.toHexString(), originalFilename, bytes: file.bytes } });
});

app.get("/api/request-files/:id/preview", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã file yêu cầu không hợp lệ.");
  const user = userOf(request);
  const file = await (await connectDatabase()).collection<RequestFile>("requestFiles").findOne({ _id: id, companyId: user.companyId });
  if (!file) return fail(response, "Không tìm thấy file yêu cầu.", 404);
  const extension = file.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" };
  if (!mimeTypes[extension]) return fail(response, "Định dạng file này chưa hỗ trợ xem trước.", 415);
  if (extension === "docx") {
    response.type("html").setHeader("Content-Disposition", "inline").send(previewDocxHtml(Buffer.from(file.data.buffer), file.originalFilename));
    return;
  }
  response.setHeader("Content-Type", mimeTypes[extension]).setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`).setHeader("X-Content-Type-Options", "nosniff").send(Buffer.from(file.data.buffer));
});

app.post("/api/quote-requests", requireRole("user"), async (request, response) => {
  const { customerName = "", customerEmail = "", customerPhone = "", requestText = "", idempotencyKey } = request.body ?? {};
  const requestFileId = request.body?.requestFileId ? asId(String(request.body.requestFileId)) : undefined;
  const templateId = asId(String(request.body?.templateId ?? ""));
  const priceListId = asId(String(request.body?.priceListId ?? ""));
  if (!validText(idempotencyKey, 100) || typeof customerName !== "string" || customerName.length > 250 || typeof customerPhone !== "string" || customerPhone.length > 50 || typeof customerEmail !== "string" || customerEmail.length > 250 || typeof requestText !== "string" || requestText.length > 10_000 || (!requestText.trim() && !requestFileId) || (request.body?.requestFileId && !requestFileId) || !templateId || (request.body?.priceListId !== undefined && !priceListId)) {
    fail(response, "Hãy chọn mẫu báo giá và nhập yêu cầu khách hàng hoặc tải file yêu cầu (văn bản tối đa 10.000 ký tự).");
    return;
  }
  const db = await connectDatabase();
  const user = userOf(request);
  const requests = db.collection<QuoteRequest>("quoteRequests");
  const existing = await requests.findOne({ companyId: user.companyId, idempotencyKey });
  if (existing) {
    response.status(200).json({ request: existing });
    return;
  }
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) return fail(response, quoteQuotaMessage(usage.plan), 429);
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: templateId, companyId: user.companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] } }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } });
  const priceList = priceListId ? await db.collection<PriceList>("priceLists").findOne({ _id: priceListId, companyId: user.companyId }, { projection: { data: 0, analysisRows: 0 } }) : null;
  if (!template || (priceListId && !priceList)) return fail(response, "Mẫu báo giá hoặc bảng giá không thuộc doanh nghiệp hoặc không còn tồn tại.", 404);
  const requestFile = requestFileId ? await db.collection<RequestFile>("requestFiles").findOne({ _id: requestFileId, companyId: user.companyId, uploadedBy: user.id }, { projection: { data: 0 } }) : null;
  if (requestFileId && !requestFile) return fail(response, "Không tìm thấy file yêu cầu đã tải lên.", 404);
  const document: QuoteRequest = {
    companyId: user.companyId,
    template: { id: template._id!.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename },
    ...(priceList ? { priceListId: priceListId!.toHexString(), priceListFilename: priceList.originalFilename } : {}),
    ...(requestFile ? { requestFile: { id: requestFile._id.toHexString(), originalFilename: requestFile.originalFilename } } : {}),
    idempotencyKey,
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim(),
    customerPhone: customerPhone.trim(),
    requestText: requestText.trim(),
    status: "not_found",
    items: [],
    missingFields: [],
    createdBy: user.id,
    createdAt: new Date(),
  };
  try {
    const result = await requests.insertOne(document);
    response.status(201).json({ request: { ...document, _id: result.insertedId } });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const saved = await requests.findOne({ companyId: user.companyId, idempotencyKey });
      if (saved) {
        response.status(200).json({ request: saved });
        return;
      }
    }
    throw error;
  }
});

app.get("/api/quote-requests", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const items = await scoped<QuoteRequest>(db, "quoteRequests", user).sort({ createdAt: -1 }).limit(50).toArray();
  response.json({ requests: items });
});

app.post("/api/quote-requests/:id/analyze", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã yêu cầu không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const requests = db.collection<QuoteRequest>("quoteRequests");
  const quoteRequest = await requests.findOne({ _id: id, companyId: user.companyId });
  if (!quoteRequest) return fail(response, "Không tìm thấy yêu cầu.", 404);
  if (quoteRequest.analyzedAt) {
    const shippingRequested = isShippingInformation(quoteRequest.requestText);
    const shippingIds = new Set(shippingRequested
      ? (quoteRequest.candidates ?? []).filter((item) => isShippingInformation(`${item.name} ${item.description}`)).map((item) => String(item._id))
      : [],
    );
    const items = quoteRequest.items.filter((item) => !shippingIds.has(item.catalogItemId));
    const missingFields = quoteRequest.missingFields.map((field) => /(?:số chuyến|so chuyen|trip count)/i.test(field) ? "Xác nhận phí vận chuyển" : field);
    if (shippingRequested && !missingFields.some(isShippingInformation)) missingFields.push("Xác nhận phí vận chuyển");
    const suggestedProducts = (quoteRequest.suggestedProducts ?? []).filter((product) =>
      !shippingRequested || !isShippingInformation(product.name),
    );
    const inferredProducts = suggestUnmatchedExplicitRequestLines(quoteRequest.requestText, quoteRequest.candidates ?? [])
      .filter((product) => !isShippingInformation(product.name));
    for (const inferred of inferredProducts) {
      const alreadySuggested = suggestedProducts.some((product) => {
        return product.quantity === inferred.quantity && sameProductLineName(product.name, inferred.name);
      });
      if (!alreadySuggested && suggestedProducts.length < 30) suggestedProducts.push(inferred);
    }
    const boundSuggestions = suggestedProducts.slice(0, 30).map((product, index) => ({
      ...product,
      informationField: product.informationField || `Sản phẩm cần bổ sung giá #${index + 1}: ${product.name}`,
    }));
    const suggestionFields = new Set(boundSuggestions.map((product) => product.informationField));
    const otherMissingFields = missingFields.filter((field) =>
      !suggestionFields.has(field)
      && !(boundSuggestions.length && isSupplementalProductInformation(field))
      && !/^Cần rà soát kết quả ghép sản phẩm tự động\.?$/i.test(field),
    );
    const normalizedMissingFields = [...new Set([
      ...otherMissingFields.slice(0, Math.max(0, 30 - boundSuggestions.length)),
      ...boundSuggestions.map((product) => product.informationField!),
    ])];
    await requests.updateOne({ _id: id, companyId: user.companyId }, {
      $set: { suggestedProducts: boundSuggestions, missingFields: normalizedMissingFields },
    });
    const status = items.length
      ? quoteRequest.status === "ambiguous" || normalizedMissingFields.length || boundSuggestions.length ? "ambiguous" as const : "matched" as const
      : quoteRequest.status;
    response.json({ analysis: { status, items, missingFields: normalizedMissingFields, suggestedProducts: boundSuggestions, customerName: quoteRequest.customerName, customerEmail: quoteRequest.customerEmail }, candidates: quoteRequest.candidates ?? [] });
    return;
  }
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) return fail(response, quoteQuotaMessage(usage.plan), 429);
  const priceLists = quoteRequest.priceListId
    ? await db.collection<PriceList>("priceLists").find({ companyId: user.companyId, _id: new ObjectId(quoteRequest.priceListId) }).toArray()
    : [];
  if (quoteRequest.priceListId && !priceLists.length) return fail(response, "Không tìm thấy bảng giá đã chọn.", 404);
  const catalog = priceLists.length ? [] : await db.collection<CatalogItem>("catalogItems").find(currentCatalogFilter(user.companyId)).limit(5000).toArray();
  if (!priceLists.length && !catalog.length) return fail(response, "Chưa có sản phẩm trong danh mục. Hãy thêm bảng giá trước khi tạo báo giá.", 422);
  for (const priceList of priceLists) {
    if (!priceList.analysisRows) {
      try { priceList.analysisRows = extractPriceListRows(priceList); }
      catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được bảng giá.", 422); }
      await db.collection<PriceList>("priceLists").updateOne(
        { _id: priceList._id, companyId: user.companyId },
        { $set: { analysisRows: priceList.analysisRows } },
      );
    }
  }
  const requestFile = quoteRequest.requestFile ? await db.collection<RequestFile>("requestFiles").findOne({ _id: new ObjectId(quoteRequest.requestFile.id), companyId: user.companyId, uploadedBy: quoteRequest.createdBy }) : null;
  if (quoteRequest.requestFile && !requestFile) return fail(response, "Không tìm thấy file yêu cầu.", 404);
  const analysisRequestId = typeof response.locals.requestId === "string" ? response.locals.requestId : undefined;
  let result: Awaited<ReturnType<typeof analyzeRequest>> & { candidates?: CatalogItem[]; customerName?: string; customerEmail?: string };
  try {
    result = await withAiUsage(db, user, "quote_request_analyze", async () => {
      const fileContent = requestFile ? await requestFileContent(requestFile) : [];
      return priceLists.length
        ? analyzePriceList(quoteRequest.requestText, priceLists, [], fileContent, analysisRequestId)
        : analyzeRequest(quoteRequest.requestText, catalog, [], fileContent, analysisRequestId);
    });
  } catch (error) {
    if (error instanceof AiQuotaExceededError) return fail(response, error.message, 429);
    throw error;
  }
  const suggestedProducts = (result.suggestedProducts ?? []).slice(0, 30);
  if (suggestedProducts.length) {
    const boundProducts = suggestedProducts.map((product, index) => ({
      ...product,
      informationField: `Sản phẩm cần bổ sung giá #${index + 1}: ${product.name}`,
    }));
    const otherMissingFields = result.missingFields.filter((field) => !isSupplementalProductInformation(field));
    result.suggestedProducts = boundProducts;
    result.missingFields = [...new Set([...otherMissingFields.slice(0, Math.max(0, 30 - boundProducts.length)), ...boundProducts.map((product) => product.informationField!)])];
  }
  result.customerName = quoteRequest.customerName.trim() || result.customerName || "";
  result.customerEmail = quoteRequest.customerEmail.trim() || result.customerEmail || "";
  const candidates = result.candidates ?? catalog.filter((candidate) => result.items.some((item) => item.catalogItemId === String(candidate._id)));
  await requests.updateOne({ _id: id, companyId: user.companyId }, { $set: { ...result, candidates, ...(priceLists.length ? { priceListFilenames: priceLists.map((file) => file.originalFilename) } : {}), analyzedAt: new Date() } });
  await writeAudit(db, user, "request_analyzed", "quoteRequest", id.toHexString(), { status: result.status, itemCount: result.items.length });
  response.json({ analysis: result, candidates });
});

app.get("/api/quotes", requireRole("user"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const collection = db.collection<Quote>("quotes");
  const status = request.query.status;
  const filter: Document = { companyId: user.companyId };
  if (request.query.kind === "customer") filter.kind = "customer";
  else filter.kind = { $ne: "customer" };
  if (typeof status === "string" && ["draft", "needs_info", "pending_review", "approved", "rejected"].includes(status)) filter.status = status;
  if (request.query.page === undefined) {
    const quotes = await collection.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).toArray();
    response.json({ quotes: quotes.map(quoteForResponse) });
    return;
  }

  const requestedPage = Number(request.query.page);
  if (!Number.isInteger(requestedPage) || requestedPage < 1) return fail(response, "Trang báo giá không hợp lệ.");
  const pageSize = 9;
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : "";
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    filter.$or = [
      { quoteNumber: pattern },
      { customerName: pattern },
      { customerEmail: pattern },
      { customerPhone: pattern },
    ];
  }
  const sortBy = typeof request.query.sort === "string" ? request.query.sort : "newest";
  const sort: Record<string, 1 | -1> = sortBy === "oldest" ? { createdAt: 1, _id: 1 }
    : sortBy === "total_desc" ? { total: -1, _id: -1 }
    : sortBy === "total_asc" ? { total: 1, _id: -1 }
    : sortBy === "customer" ? { customerName: 1, _id: -1 }
    : { createdAt: -1, _id: -1 };
  const [total, statusRows] = await Promise.all([
    collection.countDocuments(filter),
    collection.aggregate<{ _id: QuoteStatus; count: number; revenue: number }>([
      { $match: { companyId: user.companyId, kind: filter.kind } },
      { $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$total", 0] } } } },
    ]).toArray(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const quotes = await collection.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray();
  const counts = Object.fromEntries(statusRows.map((row) => [row._id, row.count]));
  response.json({
    quotes: quotes.map(quoteForResponse),
    page,
    pageSize,
    total,
    totalPages,
    stats: {
      total: statusRows.reduce((sum, row) => sum + row.count, 0),
      drafts: counts.draft ?? 0,
      pending: counts.pending_review ?? 0,
      approved: counts.approved ?? 0,
      needsInfo: counts.needs_info ?? 0,
      rejected: counts.rejected ?? 0,
      approvedRevenue: statusRows.reduce((sum, row) => sum + row.revenue, 0),
    },
  });
});

app.post("/api/customer-quotes/suggest", requireRole("user"), async (request, response) => {
  const prompt = request.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 3000) return fail(response, "Hãy nhập yêu cầu báo giá, tối đa 3.000 ký tự.");
  const inputs = parseCustomerQuotePrompt(prompt);
  const db = await connectDatabase();
  const user = userOf(request);
  const catalog = await db.collection<CatalogItem>("catalogItems").find(currentCatalogFilter(user.companyId)).sort({ sku: 1 }).limit(1000).toArray();
  try { response.json(await withAiUsage(db, user, "customer_quote_suggest", () => suggestCustomerQuote(inputs, catalog))); }
  catch (error) { fail(response, error instanceof Error ? error.message : "Không thể đề xuất hạng mục.", error instanceof AiQuotaExceededError ? 429 : 422); }
});

app.get("/api/budget-plans", requireRole("user"), async (request, response) => {
  const plans = await (await connectDatabase()).collection<SavedBudgetPlan>("budgetPlans")
    .find({ companyId: userOf(request).companyId }).sort({ createdAt: -1, _id: -1 }).limit(30).toArray();
  response.json({ plans: plans.map(({ _id, input, result, createdAt }) => ({ id: String(_id), input, result: recomputeBudgetPlanTotals(result), createdAt })) });
});

app.patch("/api/budget-plans/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã phương án không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const plans = db.collection<SavedBudgetPlan>("budgetPlans");
  const plan = await plans.findOne({ _id: id, companyId: user.companyId });
  if (!plan) return fail(response, "Không tìm thấy phương án.", 404);
  const body = request.body ?? {};
  let result = structuredClone(plan.result);
  const validQuantity = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1_000_000;
  if (body.action === "quantity") {
    const line = result.lines.find((entry) => entry.catalogItemId === body.catalogItemId);
    if (!line || !validQuantity(body.quantity)) return fail(response, "Sản phẩm hoặc số lượng không hợp lệ.", 422);
    line.quantity = body.quantity;
    line.lineTotal = Math.round((line.unitPrice * body.quantity + Number.EPSILON) * 100) / 100;
    line.quantityBasis = "measured";
    line.quantityNote = "Số lượng do người dùng xác nhận";
  } else if (body.action === "answer" || body.action === "recalculate") {
    if (body.action === "answer" && (!validText(body.question, 500) || !result.questions.includes(body.question) || !validText(body.answer, 500))) return fail(response, "Câu hỏi hoặc câu trả lời không hợp lệ.", 422);
    const clarification = body.action === "answer" ? { question: String(body.question), answer: String(body.answer).trim() } : undefined;
    const catalog = await db.collection<CatalogItem>("catalogItems").find(currentCatalogFilter(user.companyId)).sort({ sku: 1 }).limit(1000).toArray();
    if (!catalog.length) return fail(response, "Bảng giá chưa có sản phẩm đang áp dụng.", 422);
    try {
      const updatedResult = await withAiUsage(db, user, body.action === "answer" ? "budget_plan_answer" : "budget_plan_recalculate", async () => {
        const proposed = await suggestBudgetPlan(recalculationInput(plan.input, result, clarification), catalog);
        const merged = mergeBudgetPlanAfterClarification(result, proposed, clarification);
        await plans.updateOne({ _id: id, companyId: user.companyId }, { $set: { result: merged } });
        await writeAudit(db, user, "budget_plan_updated", "budgetPlan", id.toHexString(), { action: body.action });
        return merged;
      });
      return response.json({ id: id.toHexString(), input: plan.input, result: updatedResult, createdAt: plan.createdAt });
    } catch (error) {
      return fail(response, error instanceof Error ? error.message : "Không thể tính lại phương án.", error instanceof AiQuotaExceededError ? 429 : 422);
    }
  } else if (body.action === "assumption") {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index >= result.assumptions.length || !validText(body.text, 250)) return fail(response, "Giả định không hợp lệ.", 422);
    const changed = result.assumptions[body.index] !== body.text.trim();
    result.assumptions[body.index] = body.text.trim();
    result.assumptionConfirmations = result.assumptions.map((_, index) => index === body.index || result.assumptionConfirmations?.[index] === true);
    if (changed) for (const line of result.lines) {
      if (line.quantityBasis !== "estimated") continue;
      line.quantity = null;
      line.lineTotal = null;
      line.quantityNote = "Giả định đã sửa; cần nhập lại số lượng";
    }
  } else if (body.action === "missing") {
    if (!validText(body.name, 250) || !result.missingProducts.includes(body.name) || (body.quantity !== null && body.quantity !== undefined && !validQuantity(body.quantity))) return fail(response, "Hạng mục hoặc số lượng không hợp lệ.", 422);
    const catalog = db.collection<CatalogItem>("catalogItems");
    let item: CatalogItem | null = null;
    if (body.catalogItemId) {
      const itemId = asId(body.catalogItemId);
      if (!itemId) return fail(response, "Sản phẩm thay thế không hợp lệ.", 422);
      item = await catalog.findOne({ _id: itemId, ...currentCatalogFilter(user.companyId) });
      if (!item) return fail(response, "Sản phẩm thay thế không còn trong bảng giá.", 422);
    } else if (isRecord(body.newProduct)) {
      const product = body.newProduct;
      if (!validText(product.sku, 80) || !validText(product.name, 250) || !validText(product.unit, 40)
        || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0 || product.price > 1_000_000_000_000)
        return fail(response, "Thông tin sản phẩm mới không hợp lệ.", 422);
      if (await catalog.findOne({ companyId: user.companyId, sku: product.sku.trim() })) return fail(response, "Mã SKU đã tồn tại; hãy chọn sản phẩm trong bảng giá.", 409);
      const now = new Date();
      item = { companyId: user.companyId, sku: product.sku.trim(), name: product.name.trim(), unit: product.unit.trim(), description: "Bổ sung từ phương án đề xuất", price: product.price, currency: config.currency, active: true, createdAt: now, updatedAt: now };
      try { item._id = (await catalog.insertOne(item)).insertedId; }
      catch (error) { if (isDuplicateKey(error)) return fail(response, "Mã SKU đã tồn tại.", 409); throw error; }
      await writeAudit(db, user, "catalog_item_created", "catalogItem", item._id.toHexString(), { source: "budget_plan", planId: id.toHexString(), sku: item.sku });
    } else return fail(response, "Hãy chọn sản phẩm hoặc thêm sản phẩm mới.", 422);
    if (!result.lines.some((line) => line.catalogItemId === String(item._id))) {
      result.lines.push({ catalogItemId: String(item._id), sku: item.sku, name: item.name, unit: item.unit, unitPrice: item.price, currency: item.currency, quantity: body.quantity ?? null, lineTotal: body.quantity ? Math.round((item.price * body.quantity + Number.EPSILON) * 100) / 100 : null, reason: `Bổ sung cho hạng mục: ${body.name}`, ...(body.quantity ? { quantityBasis: "measured" as const, quantityNote: "Số lượng do người dùng xác nhận" } : {}) });
    }
    result.missingProducts = result.missingProducts.filter((name) => name !== body.name);
    result.resolvedMissingProducts = [...new Set([...(result.resolvedMissingProducts ?? []), body.name])];
  } else return fail(response, "Thao tác không hợp lệ.", 422);
  const updatedResult = recomputeBudgetPlanTotals(result);
  await plans.updateOne({ _id: id, companyId: user.companyId }, { $set: { result: updatedResult } });
  await writeAudit(db, user, "budget_plan_updated", "budgetPlan", id.toHexString(), { action: body.action });
  response.json({ id: id.toHexString(), input: plan.input, result: updatedResult, createdAt: plan.createdAt });
});

app.get("/api/budget-plans/:id/export", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã phương án không hợp lệ.");
  const db = await connectDatabase();
  const plan = await db.collection<SavedBudgetPlan>("budgetPlans")
    .findOne({ _id: id, companyId: userOf(request).companyId });
  if (!plan) return fail(response, "Không tìm thấy phương án.", 404);
  const templateId = request.query.templateId === undefined || request.query.templateId === "none" ? null : asId(String(request.query.templateId));
  if (request.query.templateId !== undefined && request.query.templateId !== "none" && !templateId) return fail(response, "Mã mẫu Excel không hợp lệ.");
  let bytes: Buffer;
  if (templateId) {
    const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: templateId, companyId: plan.companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] } });
    if (!template) return fail(response, "Không tìm thấy mẫu Excel.", 404);
    if (template.extension !== "xlsx") return fail(response, "Hãy chọn mẫu Excel (.xlsx).", 422);
    try {
      const quote = budgetPlanAsQuote(plan);
      bytes = await renderAiMappedXlsxTemplate(template, quote, plan.input.description);
    } catch (error) {
      return fail(response, error instanceof Error ? error.message : "Không xuất được phương án theo mẫu Excel.", 422);
    }
  } else bytes = makeBudgetPlanExcel(plan);
  response.setHeader("Content-Type", templateFormats.xlsx);
  response.setHeader("Content-Disposition", `attachment; filename="phuong-an-${id.toHexString()}.xlsx"`);
  response.send(bytes);
});

app.post("/api/budget-plans/suggest", requireRole("user"), async (request, response) => {
  const { description, budget, area, floors } = request.body ?? {};
  if (typeof description !== "string" || !description.trim() || description.length > 3000
    || typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0 || budget > 1_000_000_000_000
    || (area !== undefined && (typeof area !== "number" || !Number.isFinite(area) || area <= 0 || area > 1_000_000))
    || (floors !== undefined && (!Number.isInteger(floors) || floors <= 0 || floors > 200))) {
    return fail(response, "Mô tả, ngân sách hoặc quy mô không hợp lệ.");
  }
  const db = await connectDatabase();
  const catalog = await db.collection<CatalogItem>("catalogItems")
    .find(currentCatalogFilter(userOf(request).companyId)).sort({ sku: 1 }).limit(1000).toArray();
  if (!catalog.length) return fail(response, "Bảng giá chưa có sản phẩm đang áp dụng.", 422);
  try {
    const user = userOf(request);
    const input = { description: description.trim(), budget, ...(area === undefined ? {} : { area }), ...(floors === undefined ? {} : { floors }) };
    const saved = await withAiUsage(db, user, "budget_plan_suggest", async () => {
      const result = recomputeBudgetPlanTotals(await suggestBudgetPlan(input, catalog));
      const createdAt = new Date();
      const plan: SavedBudgetPlan = { companyId: user.companyId, createdBy: user.id, input, result, createdAt };
      const inserted = await db.collection<SavedBudgetPlan>("budgetPlans").insertOne(plan);
      return { id: inserted.insertedId.toHexString(), input, result, createdAt };
    });
    response.status(201).json(saved);
  }
  catch (error) { fail(response, error instanceof Error ? error.message : "Không thể tạo phương án sơ bộ.", error instanceof AiQuotaExceededError ? 429 : 422); }
});

app.post("/api/customer-quotes", requireRole("user"), async (request, response) => {
  const user = userOf(request);
  const rawItems = request.body?.items;
  const rawMissingProducts = request.body?.missingProducts ?? [];
  const templateId = request.body?.templateId ? asId(String(request.body.templateId)) : null;
  const idempotencyKey = request.body?.idempotencyKey;
  const customerName = request.body?.customerName;
  const customerEmail = request.body?.customerEmail ?? "";
  const customerPhone = request.body?.customerPhone ?? "";
  if ((request.body?.templateId && !templateId) || !validText(idempotencyKey, 100) || !validText(customerName, 250) || typeof customerEmail !== "string" || customerEmail.length > 250 || (customerEmail && !validEmail(customerEmail)) || typeof customerPhone !== "string" || customerPhone.length > 50 || !Array.isArray(rawItems) || rawItems.length > 100 || !Array.isArray(rawMissingProducts) || rawMissingProducts.length > 30 || rawMissingProducts.some((name) => !validText(name, 120)) || (!rawItems.length && !rawMissingProducts.length)) return fail(response, "Khách hàng hoặc danh sách sản phẩm không hợp lệ.");
  const missingProducts = [...new Set((rawMissingProducts as string[]).map((name) => name.trim()))];
  const db = await connectDatabase();
  const quotes = db.collection<Quote>("quotes");
  const existing = await quotes.findOne({ companyId: user.companyId, idempotencyKey });
  if (existing) return response.json({ quote: quoteForResponse(existing) });
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) return fail(response, quoteQuotaMessage(usage.plan), 429);
  const template = templateId ? await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: templateId, companyId: user.companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] } }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } }) : null;
  if (templateId && !template) return fail(response, "Không tìm thấy mẫu báo giá.", 404);
  if (template && template.extension !== "xlsx") return fail(response, "Báo giá khách cần chọn mẫu Excel (.xlsx).", 422);
  const requested = [] as Array<{ catalogItemId: string; quantity: number; unit: string; attributes: Record<string, string> }>;
  for (const raw of rawItems) {
    if (!isRecord(raw) || typeof raw.catalogItemId !== "string" || !asId(raw.catalogItemId) || typeof raw.quantity !== "number" || typeof raw.unit !== "string") return fail(response, "Dòng hàng không hợp lệ.");
    requested.push({ catalogItemId: raw.catalogItemId, quantity: 1, unit: raw.unit, attributes: {} });
  }
  if (new Set(requested.map((item) => item.catalogItemId)).size !== requested.length) return fail(response, "Sản phẩm bị trùng trong báo giá.");
  const catalogIds = requested.map((item) => asId(item.catalogItemId)!);
  const catalog = await db.collection<CatalogItem>("catalogItems").find({ _id: { $in: catalogIds }, ...currentCatalogFilter(user.companyId) }).toArray();
  const catalogById = new Map(catalog.map((item) => [String(item._id), item]));
  if (catalogById.size !== requested.length) return fail(response, "Một số sản phẩm không còn trong bảng giá.");
  const totals = {
    lines: requested.map(({ catalogItemId }) => {
      const item = catalogById.get(catalogItemId)!;
      return {
        catalogItemId, source: "catalog" as const, sku: item.sku, name: item.name,
        description: item.description, quantity: 1, unit: item.unit, unitPrice: item.price,
        currency: item.currency, catalogAttributes: {}, attributes: {}, lineTotal: 0,
      };
    }),
    subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, currency: config.currency,
  };
  const year = new Date().getFullYear();
  const counter = await db.collection<{ _id: string; value: number }>("counters").findOneAndUpdate({ _id: `${user.companyId}:${year}` }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
  const now = new Date();
  const quote: Quote = {
    companyId: user.companyId, kind: "customer", customerPricesCaptured: true, idempotencyKey, missingProducts,
    ...(template ? { template: { id: template._id!.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename } } : {}),
    quoteNumber: `BG-${year}-${String(counter?.value ?? 1).padStart(5, "0")}`,
    requestId: "", customerName: customerName.trim(), customerEmail: customerEmail.trim(), customerPhone: customerPhone.trim(),
    ...totals, taxRateConfirmed: true, shippingFee: 0, shippingFeeConfirmed: true,
    informationNeeded: [], additionalInformation: {}, suggestedProducts: [], informationConfirmed: true,
    status: "draft", createdBy: user.id, createdAt: now, updatedAt: now,
  };
  const result = await quotes.insertOne(quote);
  await writeAudit(db, user, "customer_quote_created", "quote", result.insertedId.toHexString(), { quoteNumber: quote.quoteNumber, productCount: quote.lines.length });
  response.status(201).json({ quote: quoteForResponse({ ...quote, _id: result.insertedId }) });
});

app.post("/api/quotes/from-customer", requireRole("user"), async (request, response) => {
  const sourceId = asId(String(request.body?.sourceQuoteId ?? ""));
  const templateId = asId(String(request.body?.templateId ?? ""));
  const idempotencyKey = request.body?.idempotencyKey;
  const sourceRequirements = request.body?.sourceRequirements ?? "";
  if (!sourceId || !templateId || !validText(idempotencyKey, 100)) return fail(response, "Hãy chọn báo giá khách và mẫu dự toán hợp lệ.");
  if (typeof sourceRequirements !== "string" || sourceRequirements.length > 10_000) return fail(response, "Yêu cầu bổ sung không hợp lệ hoặc vượt quá 10.000 ký tự.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const existing = await quotes.findOne({ companyId: user.companyId, idempotencyKey });
  if (existing) return response.json({ quote: quoteForResponse(existing) });
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) return fail(response, quoteQuotaMessage(usage.plan), 429);
  const [source, template] = await Promise.all([
    quotes.findOne({ _id: sourceId, companyId: user.companyId, kind: "customer" }),
    db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: templateId, companyId: user.companyId, deletedAt: { $exists: false }, category: { $in: ["estimate", "quote", null] } }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } }),
  ]);
  if (!source) return fail(response, "Không tìm thấy báo giá khách đã chọn.", 404);
  if (!template) return fail(response, "Không tìm thấy mẫu dự toán đã chọn.", 404);
  if (!source.lines.length && !source.missingProducts?.length) return fail(response, "Báo giá khách chưa có sản phẩm để tạo dự toán.");
  if (source.lines.length + (source.missingProducts?.length ?? 0) > 100) return fail(response, "Dự toán hỗ trợ tối đa 100 sản phẩm.");
  const year = new Date().getFullYear();
  const counter = await db.collection<{ _id: string; value: number }>("counters").findOneAndUpdate(
    { _id: `${user.companyId}:${year}` }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" },
  );
  let estimate: Quote;
  try {
    estimate = estimateFromCustomerQuote(
      await customerQuoteWithPrices(db, source), sourceId.toHexString(),
      { id: templateId.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename },
      `BG-${year}-${String(counter?.value ?? 1).padStart(5, "0")}`, idempotencyKey, user.id, new Date(),
    );
    estimate.sourceRequirements = sourceRequirements.trim();
    if (estimate.sourceRequirements) estimate = await withAiUsage(db, user, "estimate_from_customer_adjust", () => adjustEstimateWithRequirements(estimate, estimate.sourceRequirements!));
  } catch (error) {
    return fail(response, error instanceof Error ? error.message : "Không thể tạo dự toán từ báo giá khách.", error instanceof AiQuotaExceededError ? 429 : 422);
  }
  const result = await quotes.insertOne(estimate);
  await writeAudit(db, user, "estimate_created_from_customer_quote", "quote", result.insertedId.toHexString(), { sourceQuoteId: sourceId.toHexString(), quoteNumber: estimate.quoteNumber, productCount: estimate.lines.length });
  response.status(201).json({ quote: quoteForResponse({ ...estimate, _id: result.insertedId }) });
});

app.post("/api/quotes", requireRole("user"), async (request, response) => {
  const requestId = asId(String(request.body?.requestId ?? ""));
  const requestedItems = request.body?.items;
  const idempotencyKey = request.body?.idempotencyKey;
  if (!requestId || !validText(idempotencyKey, 100) || !Array.isArray(requestedItems) || requestedItems.length > 100) {
    fail(response, "Yêu cầu hoặc dòng hàng không hợp lệ.");
    return;
  }
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const existing = await quotes.findOne({ companyId: user.companyId, idempotencyKey });
  if (existing) {
    response.status(200).json({ quote: existing });
    return;
  }
  const usage = await subscriptionUsage(db, user.companyId);
  if (usage.quotes.limit !== null && usage.quotes.used >= usage.quotes.limit) return fail(response, quoteQuotaMessage(usage.plan), 429);
  const source = await db.collection<QuoteRequest>("quoteRequests").findOne({ _id: requestId, companyId: user.companyId });
  if (!source || !source.analyzedAt) return fail(response, "Hãy phân tích yêu cầu trước khi tạo báo giá.");
  if (!source.template) return fail(response, "Yêu cầu chưa có mẫu báo giá. Vui lòng tạo yêu cầu mới để tự chọn mẫu doanh nghiệp.", 409);
  await savedTemplate(db, user.companyId, source.template);
  for (const item of requestedItems) {
    if (!isRecord(item) || typeof item.catalogItemId !== "string" || typeof item.quantity !== "number" || typeof item.unit !== "string") {
      return fail(response, "Dòng hàng không hợp lệ.");
    }
  }
  const catalogIds = [...new Set(requestedItems.map((item: { catalogItemId: string }) => asId(item.catalogItemId)).filter(Boolean))] as ObjectId[];
  const catalog = await db.collection<CatalogItem>("catalogItems").find({ _id: { $in: catalogIds }, ...currentCatalogFilter(user.companyId) }).toArray();
  let totals;
  try {
    const requestedAttributes = new Map(source.items.map((item) => [item.catalogItemId, item.attributes]));
    const trustedRequestedItems = requestedItems.map((item: { catalogItemId: string; quantity: number; unit: string }) => ({
      catalogItemId: item.catalogItemId,
      quantity: item.quantity,
      unit: item.unit,
      attributes: requestedAttributes.get(String(item.catalogItemId)) ?? {},
    }));
    if (!trustedRequestedItems.length) {
      totals = { lines: [], subtotal: 0, taxRate: config.taxRate, taxAmount: 0, total: 0, currency: config.currency };
    } else {
      const quoteCatalog = source.priceListId ? (source.candidates ?? []).map((item) => ({ ...item, description: "" })) : [...catalog, ...(source.candidates ?? [])];
      totals = calculateQuote(quoteCatalog, trustedRequestedItems);
    }
  } catch (error) {
    return fail(response, error instanceof Error ? error.message : "Không thể tính báo giá.");
  }
  const year = new Date().getFullYear();
  const counter = await db.collection<{ _id: string; value: number }>("counters").findOneAndUpdate(
    { _id: `${user.companyId}:${year}` },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const quoteNumber = `BG-${year}-${String(counter?.value ?? 1).padStart(5, "0")}`;
  const now = new Date();
  const informationConfirmed = request.body?.informationConfirmed === true;
  const customerName = request.body?.customerName ?? source.customerName;
  const customerEmail = request.body?.customerEmail ?? source.customerEmail;
  const customerPhone = request.body?.customerPhone ?? source.customerPhone ?? "";
  if (typeof customerPhone !== "string" || customerPhone.length > 50) return fail(response, "Số điện thoại không hợp lệ (tối đa 50 ký tự).");
  if (!validText(customerName, 250) || typeof customerEmail !== "string" || customerEmail.length > 250 || (customerEmail && !validEmail(customerEmail))) return fail(response, "Vui lòng xác nhận tên khách hàng và email hợp lệ (nếu có).");
  const quoteTerms = extractQuoteTerms(source.requestText);
  const informationNeeded = cleanMissingInformation(source.missingFields, totals.lines.length > 0)
    .filter((field) => !isResolvedQuoteTermWarning(field, quoteTerms));
  if (!totals.lines.length && !source.suggestedProducts?.length) informationNeeded.push("Chưa có sản phẩm trong báo giá.");
  const taxRateConfirmed = !informationNeeded.some(isTaxInformation);
  const shippingFeeConfirmed = !informationNeeded.some(isShippingInformation);
  const shippingFee = shippingFeeConfirmed ? 0 : null;
  const quote: Quote = {
    companyId: user.companyId,
    template: source.template,
    ...(source.priceListId ? { priceList: { id: source.priceListId, originalFilename: source.priceListFilename ?? "" } } : {}),
    ...(source.requestFile ? { requestFile: source.requestFile } : {}),
    idempotencyKey,
    quoteNumber,
    requestId: requestId.toHexString(),
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim(),
    customerPhone: customerPhone.trim(),
    ...totals,
    taxRateConfirmed,
    shippingFee,
    shippingFeeConfirmed,
    ...quoteTerms,
    taxAmount: taxRateConfirmed ? totals.taxAmount : 0,
    total: totals.subtotal + (taxRateConfirmed ? totals.taxAmount : 0) + (shippingFeeConfirmed ? shippingFee ?? 0 : 0),
    informationNeeded,
    additionalInformation: {},
    suggestedProducts: source.suggestedProducts ?? [],
    informationConfirmed,
    status: informationNeeded.length > 0 || !taxRateConfirmed || !shippingFeeConfirmed ? "needs_info" : "draft",
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await quotes.insertOne(quote);
    const saved = quoteForResponse({ ...quote, _id: result.insertedId });
    await writeAudit(db, user, "quote_created", "quote", result.insertedId.toHexString(), { quoteNumber, total: quote.total, informationConfirmed });
    response.status(201).json({ quote: saved });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const saved = await quotes.findOne({ companyId: user.companyId, idempotencyKey });
      if (saved) {
        response.status(200).json({ quote: saved });
        return;
      }
    }
    throw error;
  }
});

app.get("/api/quotes/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: userOf(request).companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  const sourceId = asId(quote.requestId);
  const source = sourceId ? await db.collection<QuoteRequest>("quoteRequests").findOne(
    { _id: sourceId, companyId: userOf(request).companyId },
    { projection: { requestText: 1, candidates: 1, suggestedProducts: 1 } },
  ) : null;
  let quoteResponse = quoteForResponse(await customerQuoteWithPrices(db, quote));
  if (source) {
    const suggestions = [...(quote.suggestedProducts ?? [])];
    for (const product of source.suggestedProducts ?? []) {
      if (!suggestions.some((existing) => existing.quantity === product.quantity && sameProductLineName(existing.name, product.name))) {
        suggestions.push(product);
      }
    }
    const inferred = source.candidates?.length
      ? suggestUnmatchedExplicitRequestLines(source.requestText, source.candidates).filter((product) => !isShippingInformation(product.name))
      : [];
    for (const product of inferred) {
      if (!suggestions.some((existing) => existing.quantity === product.quantity && sameProductLineName(existing.name, product.name))) {
        suggestions.push(product);
      }
    }
    const boundSuggestions = suggestions.slice(0, 30).map((product, index) => ({
      ...product,
      informationField: product.informationField || `Sản phẩm cần bổ sung giá #${index + 1}: ${product.name}`,
    }));
    const genericFallbackFields = new Set([
      "AI chưa phân tích hết yêu cầu; vui lòng rà soát các dòng đã ghép.",
      "AI chưa phân tích được yêu cầu; vui lòng ghép sản phẩm thủ công.",
      "Cần rà soát kết quả ghép sản phẩm tự động.",
    ]);
    const otherMissingFields = quoteResponse.informationNeeded.filter((field) =>
      !genericFallbackFields.has(field)
      && !(boundSuggestions.length && isSupplementalProductInformation(field)),
    );
    const informationNeeded = [...new Set([
      ...otherMissingFields.slice(0, Math.max(0, 30 - boundSuggestions.length)),
      ...boundSuggestions.map((product) => product.informationField!),
    ])];
    const repairedQuote = quoteForResponse({ ...quote, suggestedProducts: boundSuggestions, informationNeeded });
    if (JSON.stringify(quote.suggestedProducts ?? []) !== JSON.stringify(boundSuggestions)
      || JSON.stringify(quote.informationNeeded ?? []) !== JSON.stringify(informationNeeded)
      || quote.status !== repairedQuote.status) {
      await quotes.updateOne({ _id: id, companyId: quote.companyId }, {
        $set: { suggestedProducts: boundSuggestions, informationNeeded, status: repairedQuote.status },
      });
    }
    quoteResponse = repairedQuote;
  }
  response.json({ quote: { ...quoteResponse, requestText: quote.sourceRequirements || source?.requestText || "" } });
});

app.delete("/api/quotes/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (await db.collection<Contract>("contracts").findOne({ companyId: user.companyId, quoteId: id.toHexString() })) return fail(response, "Dự toán đã có hợp đồng; không thể xóa nguồn đối chiếu.", 409);
  const result = await quotes.deleteOne({ _id: id, companyId: user.companyId });
  if (!result.deletedCount) return fail(response, "Báo giá không còn tồn tại hoặc đã được xóa.", 404);
  await writeAudit(db, user, "quote_deleted", "quote", id.toHexString(), { quoteNumber: quote.quoteNumber, status: quote.status });
  response.json({ deleted: true });
});

app.get("/api/quotes/:id/request-file/preview", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  const sourceId = asId(quote.requestId);
  const source = sourceId ? await db.collection<QuoteRequest>("quoteRequests").findOne({ _id: sourceId, companyId: user.companyId }) : null;
  if (!source?.requestFile) return fail(response, "Yêu cầu này không có file đính kèm.", 404);
  const file = await db.collection<RequestFile>("requestFiles").findOne({ _id: new ObjectId(source.requestFile.id), companyId: user.companyId, uploadedBy: source.createdBy });
  if (!file) return fail(response, "Không tìm thấy file yêu cầu.", 404);
  const extension = file.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "docx") {
    response.type("html").setHeader("Content-Disposition", "inline").send(previewDocxHtml(Buffer.from(file.data.buffer), file.originalFilename));
    return;
  }
  const mimeTypes: Record<string, string> = { pdf: "application/pdf", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" };
  if (!mimeTypes[extension]) return fail(response, "Định dạng file này chưa hỗ trợ xem trước.", 415);
  response.setHeader("Content-Type", mimeTypes[extension]).setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`).setHeader("X-Content-Type-Options", "nosniff").send(Buffer.from(file.data.buffer));
});

app.patch("/api/quotes/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  const updates = request.body?.items;
  if (!id || !Array.isArray(updates) || updates.length > 100) return fail(response, "Danh sách dòng hàng không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "draft" && quote.status !== "needs_info" && quote.status !== "pending_review" && quote.status !== "rejected") return fail(response, "Chỉ có thể chỉnh sửa báo giá đang ở trạng thái nháp, chờ duyệt hoặc cần chỉnh sửa.", 409);
  const catalogLines = quote.lines.filter((line) => line.source !== "supplemental");
  const updateIds = updates.map((item: unknown) => isRecord(item) && typeof item.catalogItemId === "string" ? item.catalogItemId : "");
  if (updates.length !== catalogLines.length || new Set(updateIds).size !== updateIds.length || updates.some((item: unknown) => !isRecord(item) || typeof item.catalogItemId !== "string" || !catalogLines.some((line) => line.catalogItemId === item.catalogItemId))) {
    return fail(response, "Danh sách sản phẩm trong báo giá đã thay đổi. Vui lòng tải lại trang rồi thử lại.");
  }
  const body = isRecord(request.body) ? request.body : {};
  const currentQuote = quoteForResponse(quote);
  let additionalInformation = { ...(currentQuote.additionalInformation ?? {}) };
  if (Object.prototype.hasOwnProperty.call(body, "additionalInformation")) {
    if (!isRecord(body.additionalInformation) || Object.keys(body.additionalInformation).length > 30) return fail(response, "Thông tin bổ sung không hợp lệ (tối đa 30 mục).");
    const allowedFields = new Set([...currentQuote.informationNeeded, ...Object.keys(additionalInformation)]);
    additionalInformation = {};
    let totalAnswerLength = 0;
    for (const [field, value] of Object.entries(body.additionalInformation)) {
      if (!allowedFields.has(field) || typeof value !== "string" || value.length > 2000) return fail(response, "Mỗi câu trả lời phải ứng với mục còn thiếu và không vượt quá 2.000 ký tự.");
      const answer = value.trim();
      if (answer) {
        totalAnswerLength += field.length + answer.length;
        if (totalAnswerLength > 12000) return fail(response, "Tổng nội dung bổ sung không được vượt quá 12.000 ký tự.");
        additionalInformation[field] = answer;
      }
    }
  }
  const existingSupplementalLines = quote.lines.filter((line) => line.source === "supplemental");
  const rawSupplementalProducts = Object.prototype.hasOwnProperty.call(body, "supplementalProducts")
    ? body.supplementalProducts
    : existingSupplementalLines.map((line) => ({
      id: line.catalogItemId, informationField: line.supplementalFor, name: line.name, description: line.description ?? "",
      unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice,
    }));
  if (!Array.isArray(rawSupplementalProducts) || rawSupplementalProducts.length > 30) return fail(response, "Báo giá chỉ được bổ sung tối đa 30 dòng sản phẩm.");
  const existingSupplementalById = new Map(existingSupplementalLines.map((line) => [line.catalogItemId, line]));
  const usedSupplementalIds = new Set<string>();
  const supplementalLines: Quote["lines"] = [];
  for (const rawProduct of rawSupplementalProducts) {
    if (!isRecord(rawProduct)) return fail(response, "Dòng sản phẩm bổ sung không hợp lệ.");
    const name = typeof rawProduct.name === "string" ? rawProduct.name.trim() : "";
    if (rawProduct.description !== undefined && typeof rawProduct.description !== "string") return fail(response, "Quy cách sản phẩm bổ sung không hợp lệ.");
    const description = typeof rawProduct.description === "string" ? rawProduct.description.trim() : "";
    const unit = typeof rawProduct.unit === "string" ? rawProduct.unit.trim() : "";
    const quantity = rawProduct.quantity;
    const unitPrice = rawProduct.unitPrice;
    if (!validText(name, 250) || description.length > 2000 || !validText(unit, 50)) return fail(response, "Mỗi dòng bổ sung cần có tên sản phẩm và đơn vị tính hợp lệ.");
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return fail(response, "Số lượng sản phẩm bổ sung phải lớn hơn 0 và không vượt quá 1.000.000.");
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1e12) return fail(response, "Đơn giá sản phẩm bổ sung phải là số tiền không âm.");
    if (rawProduct.id !== undefined && typeof rawProduct.id !== "string") return fail(response, "Mã dòng sản phẩm bổ sung không hợp lệ.");
    const requestedId = typeof rawProduct.id === "string" ? rawProduct.id : "";
    const existingLine = requestedId ? existingSupplementalById.get(requestedId) : undefined;
    if (requestedId && !existingLine) return fail(response, "Không thể sửa dòng sản phẩm bổ sung không thuộc báo giá này.");
    const id = existingLine?.catalogItemId ?? `supplemental:${randomUUID()}`;
    if (usedSupplementalIds.has(id)) return fail(response, "Không thể lặp lại một dòng sản phẩm bổ sung.");
    usedSupplementalIds.add(id);
    if (rawProduct.informationField !== undefined && typeof rawProduct.informationField !== "string") return fail(response, "Mục thiếu thông tin không hợp lệ.");
    const informationField = typeof rawProduct.informationField === "string" ? rawProduct.informationField : existingLine?.supplementalFor;
    if (informationField && (!currentQuote.informationNeeded.includes(informationField) || !isSupplementalProductInformation(informationField))) {
      return fail(response, "Mục thông tin cần bổ sung không khớp với sản phẩm.");
    }
    supplementalLines.push({
      catalogItemId: id, source: "supplemental", ...(informationField ? { supplementalFor: informationField } : {}),
      sku: "", name, description, quantity, unit, unitPrice, currency: quote.currency, catalogAttributes: {}, attributes: {},
      lineTotal: roundMoney(quantity * unitPrice),
    });
  }
  const taxRate = Object.prototype.hasOwnProperty.call(body, "taxRate") ? Number(body.taxRate) : quote.taxRate;
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) return fail(response, "Thuế suất VAT phải từ 0 đến 100%.");
  if (Object.prototype.hasOwnProperty.call(body, "taxRateConfirmed") && typeof body.taxRateConfirmed !== "boolean") return fail(response, "Trạng thái xác nhận VAT không hợp lệ.");
  const taxRateConfirmed = Object.prototype.hasOwnProperty.call(body, "taxRateConfirmed") ? body.taxRateConfirmed === true : currentQuote.taxRateConfirmed === true;
  const rawShippingFee = Object.prototype.hasOwnProperty.call(body, "shippingFee") ? body.shippingFee : currentQuote.shippingFee;
  if (rawShippingFee !== null && rawShippingFee !== undefined && (typeof rawShippingFee !== "number" || !Number.isFinite(rawShippingFee) || rawShippingFee < 0 || rawShippingFee > 1e12)) return fail(response, "Phí vận chuyển phải là số tiền không âm.");
  if (Object.prototype.hasOwnProperty.call(body, "shippingFeeConfirmed") && typeof body.shippingFeeConfirmed !== "boolean") return fail(response, "Trạng thái xác nhận phí vận chuyển không hợp lệ.");
  const shippingFee = typeof rawShippingFee === "number" ? rawShippingFee : null;
  const shippingFeeConfirmed = Object.prototype.hasOwnProperty.call(body, "shippingFeeConfirmed")
    ? body.shippingFeeConfirmed === true && shippingFee !== null
    : currentQuote.shippingFeeConfirmed === true && shippingFee !== null;
  const validityDays = Object.prototype.hasOwnProperty.call(body, "validityDays") ? body.validityDays : quote.validityDays ?? null;
  if (validityDays !== null && (typeof validityDays !== "number" || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650)) return fail(response, "Thời hạn báo giá phải từ 1 đến 3.650 ngày.");
  const completionDate = Object.prototype.hasOwnProperty.call(body, "completionDate") ? body.completionDate : quote.completionDate ?? null;
  const parsedCompletionDate = typeof completionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(completionDate) ? new Date(`${completionDate}T00:00:00Z`) : null;
  if (completionDate !== null && (!parsedCompletionDate || Number.isNaN(parsedCompletionDate.getTime()) || parsedCompletionDate.toISOString().slice(0, 10) !== completionDate)) return fail(response, "Hạn hoàn thành không hợp lệ.");
  let totals;
  try {
    const recalculated = catalogLines.length
      ? recalculateSnapshot(catalogLines, updates.map((item: Record<string, unknown>) => ({
        catalogItemId: String(item.catalogItemId), quantity: Number(item.quantity),
      })), taxRateConfirmed ? taxRate : 0)
      : { lines: [], subtotal: 0, taxRate, taxAmount: 0, total: 0, currency: quote.currency };
    const lines = [...recalculated.lines, ...supplementalLines];
    const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const taxAmount = roundMoney(subtotal * (taxRateConfirmed ? taxRate : 0));
    totals = {
      ...recalculated,
      lines,
      subtotal,
      taxRate,
      taxRateConfirmed,
      taxAmount,
      shippingFee,
      shippingFeeConfirmed,
      total: roundMoney(subtotal + taxAmount + (shippingFeeConfirmed ? shippingFee ?? 0 : 0)),
    };
  } catch (error) {
    return fail(response, error instanceof Error ? error.message : "Không thể tính lại báo giá.");
  }
  const informationConfirmed = request.body?.informationConfirmed === true || quote.informationConfirmed;
  let informationNeeded = currentQuote.informationNeeded.filter((field) =>
    !(taxRateConfirmed && isTaxInformation(field)) && !(shippingFeeConfirmed && isShippingInformation(field)),
  );
  if (!taxRateConfirmed && !informationNeeded.some(isTaxInformation)) informationNeeded.push("VAT: cần xác nhận thuế suất.");
  if (!shippingFeeConfirmed && !informationNeeded.some(isShippingInformation)) informationNeeded.push("Phí vận chuyển: cần xác nhận số tiền hoặc xác nhận miễn phí.");
  const unresolved = informationNeeded.some((field) => isSupplementalProductInformation(field)
    ? !supplementalLines.some((line) => line.supplementalFor === field)
    : !additionalInformation[field]?.trim())
    || !taxRateConfirmed || !shippingFeeConfirmed;
  const nextStatus: QuoteStatus = unresolved ? "needs_info"
    : quote.status === "rejected" || quote.status === "needs_info" ? "draft" : quote.status;
  const customerName = request.body?.customerName ?? quote.customerName;
  const customerEmail = request.body?.customerEmail ?? quote.customerEmail;
  const customerPhone = request.body?.customerPhone ?? quote.customerPhone ?? "";
  if (typeof customerPhone !== "string" || customerPhone.length > 50) return fail(response, "Số điện thoại không hợp lệ (tối đa 50 ký tự).");
  if (!validText(customerName, 250) || typeof customerEmail !== "string" || customerEmail.length > 250 || (customerEmail.trim() && !validEmail(customerEmail.trim()))) return fail(response, "Vui lòng nhập tên khách hàng và email hợp lệ (nếu có).");
  const customer = { customerName: customerName.trim(), customerEmail: customerEmail.trim(), customerPhone: customerPhone.trim() };
  const hadAdditionalInformation = Object.values(currentQuote.additionalInformation ?? {}).some((answer) => answer.trim());
  const hasAdditionalInformation = Object.values(additionalInformation).some((answer) => answer.trim());
  const additionalInformationBindingChanged = hadAdditionalInformation !== hasAdditionalInformation;
  const updatedQuote = {
    ...quote, ...totals, ...customer, informationNeeded, additionalInformation, validityDays, completionDate,
    ...(additionalInformationBindingChanged ? { templateFillPlan: undefined, xlsxTemplateFillPlan: undefined } : {}),
  };
  const unsetFillPlans: Record<string, ""> = {};
  if (!updatedQuote.templateFillPlan) unsetFillPlans.templateFillPlan = "";
  if (!updatedQuote.xlsxTemplateFillPlan) unsetFillPlans.xlsxTemplateFillPlan = "";
  await quotes.updateOne({ _id: id, companyId: user.companyId }, {
    $set: { ...totals, ...customer, informationNeeded, additionalInformation, validityDays, completionDate, ...(updatedQuote.templateFillPlan ? { templateFillPlan: updatedQuote.templateFillPlan } : {}), ...(updatedQuote.xlsxTemplateFillPlan ? { xlsxTemplateFillPlan: updatedQuote.xlsxTemplateFillPlan } : {}), informationConfirmed, status: nextStatus, updatedAt: new Date() },
    ...(Object.keys(unsetFillPlans).length ? { $unset: unsetFillPlans } : {}),
  });
  await writeAudit(db, user, "quote_recalculated", "quote", id.toHexString(), { total: totals.total });
  const updated = await quotes.findOne({ _id: id, companyId: user.companyId });
  response.json({ quote: updated ? quoteForResponse(updated) : null });
});

app.post("/api/quotes/:id/submit-review", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "draft" || quoteHasUnresolvedInformation(quote)) return fail(response, quote.kind === "customer" ? "Danh sách sản phẩm chưa sẵn sàng để gửi duyệt." : "Hãy xử lý các khoản chưa có giá hoặc điều khoản còn thiếu trước khi gửi duyệt.", 409);
  await quotes.updateOne({ _id: id, companyId: user.companyId }, { $set: { status: "pending_review", updatedAt: new Date() } });
  await writeAudit(db, user, "quote_submitted", "quote", id.toHexString());
  response.json({ quote: await quotes.findOne({ _id: id, companyId: user.companyId }) });
});

app.post("/api/quotes/:id/approve", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const current = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!current) return fail(response, "Không tìm thấy báo giá.", 404);
  if (current.kind !== "customer" && quoteHasUnresolvedInformation(current)) return fail(response, "Hãy bổ sung đơn giá và thông tin còn thiếu trước khi duyệt dự toán.", 409);
  const approvableStatuses: QuoteStatus[] = ["draft", "needs_info", "pending_review"];
  const result = await quotes.findOneAndUpdate(
    {
      _id: id,
      companyId: user.companyId,
      $or: [
        { status: { $in: approvableStatuses } },
        { kind: "customer", status: "rejected" },
      ],
    },
    { $set: { status: "approved", approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) return fail(response, "Chỉ có thể duyệt báo giá nháp hoặc đang chờ duyệt.", 409);
  await writeAudit(db, user, "quote_approved", "quote", id.toHexString());
  response.json({ quote: result });
});

app.post("/api/quotes/:id/reject", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  const reason = request.body?.reason;
  if (!id || !validText(reason, 1000)) return fail(response, "Vui lòng nhập lý do trả lại (tối đa 1.000 ký tự).");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const result = await quotes.findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "pending_review" },
    { $set: { status: "rejected", rejectionReason: reason.trim(), updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) return fail(response, "Chỉ có thể trả lại báo giá đang chờ duyệt.", 409);
  await writeAudit(db, user, "quote_rejected", "quote", id.toHexString(), { reason: reason.trim() });
  response.json({ quote: result });
});

function validDocumentDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validDocumentTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validMoneyAmount(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function sendWord(response: express.Response, filename: string, bytes: Buffer) {
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(bytes);
}

app.get("/api/document-templates/:kind", requireRole("user"), (request, response) => {
  const kind = request.params.kind;
  if (kind !== "contract" && kind !== "acceptance") return fail(response, "Không tìm thấy mẫu chứng từ.", 404);
  sendWord(response, kind === "contract" ? "mau-hop-dong.docx" : "mau-nghiem-thu.docx", makeDocumentWord(kind));
});

async function usableContractTemplates(db: Db, companyId: string) {
  const saved = await db.collection<QuoteTemplate>("quoteTemplates")
    .find({ companyId, category: "contract", deletedAt: { $exists: false } }).sort({ _id: -1 }).limit(100).toArray();
  return saved.filter((template) => contractTemplateMode(template));
}

async function usableAcceptanceTemplates(db: Db, companyId: string) {
  const saved = await db.collection<QuoteTemplate>("quoteTemplates")
    .find({ companyId, category: "acceptance", deletedAt: { $exists: false } }).sort({ _id: -1 }).limit(100).toArray();
  return saved.filter((template) => contractTemplateMode(template));
}

app.get("/api/contract-templates", requireRole("user"), async (request, response) => {
  const templates = await usableContractTemplates(await connectDatabase(), userOf(request).companyId);
  response.json({ templates: templates.map((template) => ({ ...templateDetails(template), mode: contractTemplateMode(template) })) });
});

app.get("/api/acceptance-templates", requireRole("user"), async (request, response) => {
  const templates = await usableAcceptanceTemplates(await connectDatabase(), userOf(request).companyId);
  response.json({ templates: templates.map((template) => ({ ...templateDetails(template), mode: contractTemplateMode(template) })) });
});

app.get("/api/contracts", requireRole("user"), async (request, response) => {
  const user = userOf(request);
  const contracts = await (await connectDatabase()).collection<Contract>("contracts")
    .find({ companyId: user.companyId }).sort({ createdAt: -1 }).limit(200).toArray();
  response.json({ contracts });
});

app.get("/api/contracts/prefill", requireRole("user"), async (request, response) => {
  const user = userOf(request);
  const companyId = asId(user.companyId);
  const company = companyId ? await (await connectDatabase()).collection<Company>("companies").findOne({ _id: companyId }) : null;
  if (!company) return fail(response, "Không tìm thấy hồ sơ doanh nghiệp.", 404);
  response.json({ company: {
    name: company.name, address: company.address ?? "", taxId: company.taxId ?? "",
    representativeName: company.representativeName ?? "", phone: company.phone ?? "", email: company.businessEmail ?? "",
  } });
});

app.post("/api/contracts", requireRole("user"), async (request, response) => {
  const quoteId = asId(request.body?.quoteId);
  if (!quoteId) return fail(response, "Hãy chọn dự toán hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quote = await db.collection<Quote>("quotes").findOne({ _id: quoteId, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy dự toán.", 404);
  if (quote.kind === "customer" || quote.status !== "approved" || quoteHasUnresolvedInformation(quote)
    || !quote.lines.length || quote.lines.some((line) => line.priceUnavailable || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
    return fail(response, "Chỉ có thể tạo hợp đồng từ dự toán đã duyệt và đủ thông tin.", 409);
  }
  const existing = await db.collection<Contract>("contracts").findOne({ companyId: user.companyId, quoteId: quoteId.toHexString() });
  if (existing) return response.json({ contract: existing });
  const body = request.body ?? {};
  const requestedTemplateId = body.templateId ? asId(String(body.templateId)) : null;
  if (body.templateId && !requestedTemplateId) return fail(response, "Mẫu hợp đồng không hợp lệ.");
  const templates = db.collection<QuoteTemplate>("quoteTemplates");
  const selectedTemplate = requestedTemplateId
    ? await templates.findOne({ _id: requestedTemplateId, companyId: user.companyId, category: "contract", deletedAt: { $exists: false } })
    : (await usableContractTemplates(db, user.companyId))[0] ?? null;
  if (requestedTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu hợp đồng đã chọn.", 404);
  if (selectedTemplate && !contractTemplateMode(selectedTemplate)) return fail(response, "Mẫu hợp đồng cần là file Word hoặc PDF hợp lệ.", 422);
  const requiredFields = ["customerName", "customerAddress", "customerRepresentative", "companyName", "companyAddress", "companyRepresentative", "scope", "projectName", "projectAddress", "deliverables", "paymentTerms", "deliveryTerms", "signingPlace"] as const;
  for (const field of requiredFields) {
    if (!validText(body[field], ["scope", "deliverables", "paymentTerms", "deliveryTerms"].includes(field) ? 4000 : 250)) {
      return fail(response, `Vui lòng nhập ${field} hợp lệ.`);
    }
  }
  const optionalFields = ["customerEmail", "customerPhone", "customerTaxId", "companyTaxId", "companyPhone", "companyEmail"] as const;
  for (const field of optionalFields) {
    if (typeof body[field] !== "string" || body[field].length > 250) return fail(response, `Thông tin ${field} không hợp lệ.`);
  }
  if (body.customerEmail.trim() && !validEmail(body.customerEmail.trim())) return fail(response, "Email khách hàng không hợp lệ.");
  if (body.companyEmail.trim() && !validEmail(body.companyEmail.trim())) return fail(response, "Email doanh nghiệp không hợp lệ.");
  if (!validDocumentDate(body.signedDate)) return fail(response, "Hãy nhập ngày ký dự kiến hợp lệ.");
  if (!validMoneyAmount(body.depositAmount, quote.total)) return fail(response, "Tiền đặt cọc phải từ 0 đến tổng giá trị dự toán.");
  if (typeof body.bankDetails !== "string" || body.bankDetails.length > 1000 || typeof body.otherTerms !== "string" || body.otherTerms.length > 10000) {
    return fail(response, "Thông tin tài khoản hoặc điều khoản bổ sung quá dài.");
  }
  const id = new ObjectId();
  const now = new Date();
  const contract: Contract = {
    _id: id, companyId: user.companyId, quoteId: quoteId.toHexString(), quoteNumber: quote.quoteNumber,
    contractNumber: `HD-${id.toHexString().slice(-8).toUpperCase()}`, status: "draft",
    ...(selectedTemplate ? { template: { id: selectedTemplate._id!.toHexString(), name: selectedTemplate.name || selectedTemplate.originalFilename, originalFilename: selectedTemplate.originalFilename } } : {}),
    customerName: body.customerName.trim(), customerEmail: body.customerEmail.trim(), customerPhone: body.customerPhone.trim(),
    customerAddress: body.customerAddress.trim(), customerTaxId: body.customerTaxId.trim(), customerRepresentative: body.customerRepresentative.trim(),
    companyName: body.companyName.trim(), companyAddress: body.companyAddress.trim(), companyTaxId: body.companyTaxId.trim(),
    companyRepresentative: body.companyRepresentative.trim(), companyPhone: body.companyPhone.trim(), companyEmail: body.companyEmail.trim(),
    lines: quote.lines.map((line) => ({ ...line })),
    subtotal: quote.subtotal, taxRate: quote.taxRate, taxAmount: quote.taxAmount,
    shippingFee: quote.shippingFee ?? 0, total: quote.total, currency: quote.currency,
    scope: body.scope.trim(), projectName: body.projectName.trim(), projectAddress: body.projectAddress.trim(),
    deliverables: body.deliverables.trim(), depositAmount: body.depositAmount, bankDetails: body.bankDetails.trim(), otherTerms: body.otherTerms.trim(),
    paymentTerms: body.paymentTerms.trim(), deliveryTerms: body.deliveryTerms.trim(),
    signingPlace: body.signingPlace.trim(), signedDate: body.signedDate,
    createdBy: user.id, createdAt: now, updatedAt: now,
  };
  try {
    await db.collection<Contract>("contracts").insertOne(contract);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const concurrent = await db.collection<Contract>("contracts").findOne({ companyId: user.companyId, quoteId: quoteId.toHexString() });
      if (concurrent) return response.json({ contract: concurrent });
    }
    throw error;
  }
  await writeAudit(db, user, "contract_created", "contract", id.toHexString(), { quoteId: quoteId.toHexString() });
  response.status(201).json({ contract });
});

app.get("/api/contracts/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã hợp đồng không hợp lệ.");
  const user = userOf(request);
  const contract = await (await connectDatabase()).collection<Contract>("contracts").findOne({ _id: id, companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng.", 404);
  response.json({ contract });
});

app.get(["/api/contracts/:id/docx", "/api/contracts/:id/file"], requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã hợp đồng không hợp lệ.");
  const user = userOf(request);
  const db = await connectDatabase();
  const contract = await db.collection<Contract>("contracts").findOne({ _id: id, companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng.", 404);
  const templates = db.collection<QuoteTemplate>("quoteTemplates");
  const overrideTemplateId = request.query.templateId === undefined ? null : asId(String(request.query.templateId));
  if (request.query.templateId !== undefined && !overrideTemplateId) return fail(response, "Mã mẫu hợp đồng không hợp lệ.");
  const savedTemplateId = contract.template?.id ? asId(contract.template.id) : null;
  if (contract.template && !savedTemplateId) return fail(response, "Mẫu hợp đồng đã lưu không hợp lệ.", 422);
  const selectedTemplate = overrideTemplateId
    ? await templates.findOne({ _id: overrideTemplateId, companyId: user.companyId, category: "contract", deletedAt: { $exists: false } })
    : savedTemplateId
    ? await templates.findOne({ _id: savedTemplateId, companyId: user.companyId, category: "contract" })
    : (await usableContractTemplates(db, user.companyId))[0] ?? null;
  if (overrideTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu hợp đồng đã chọn.", 404);
  if (savedTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu đã dùng để tạo hợp đồng.", 404);
  try {
    const file = selectedTemplate
      ? await renderContractFile(db, selectedTemplate, contract, (work) => withAiUsage(db, user, "contract_template_map", work))
      : { bytes: makeDocumentWord("contract", contract), extension: "docx" as const };
    if (file.extension === "docx") return sendWord(response, `${contract.contractNumber}.docx`, file.bytes);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${contract.contractNumber}.pdf`)}`);
    return response.send(file.bytes);
  } catch (error) { return fail(response, error instanceof Error ? error.message : "Không xuất được hợp đồng theo mẫu đã chọn.", error instanceof AiQuotaExceededError ? 429 : 422); }
});

app.patch("/api/contracts/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã hợp đồng không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const current = await db.collection<Contract>("contracts").findOne({ _id: id, companyId: user.companyId, status: "draft" });
  if (!current) return fail(response, "Chỉ có thể sửa hợp đồng nháp.", 409);
  const fields = ["scope", "paymentTerms", "deliveryTerms", "projectName", "projectAddress", "deliverables", "signingPlace"] as const;
  const updates: Record<string, string> = {};
  for (const field of fields) {
    const value = request.body?.[field];
    if (!validText(value, ["scope", "paymentTerms", "deliveryTerms", "deliverables"].includes(field) ? 4000 : 250)) return fail(response, `Thông tin ${field} không hợp lệ.`);
    updates[field] = value.trim();
  }
  for (const [field, limit] of [["bankDetails", 1000], ["otherTerms", 10000]] as const) {
    const value = request.body?.[field];
    if (typeof value !== "string" || value.length > limit) return fail(response, `Thông tin ${field} không hợp lệ.`);
    updates[field] = value.trim();
  }
  if (!validMoneyAmount(request.body?.depositAmount, current.total) || !validDocumentDate(request.body?.signedDate)) return fail(response, "Tiền đặt cọc hoặc ngày ký dự kiến không hợp lệ.");
  const contract = await db.collection<Contract>("contracts").findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "draft" },
    { $set: { ...updates, depositAmount: request.body.depositAmount, signedDate: request.body.signedDate, updatedAt: new Date() } }, { returnDocument: "after" },
  );
  if (!contract) return fail(response, "Chỉ có thể sửa hợp đồng nháp.", 409);
  await writeAudit(db, user, "contract_updated", "contract", id.toHexString());
  response.json({ contract });
});

app.post("/api/contracts/:id/sign", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  const signedDate = request.body?.signedDate;
  if (!id || !validDocumentDate(signedDate)) return fail(response, "Hãy nhập ngày ký hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const draft = await db.collection<Contract>("contracts").findOne({ _id: id, companyId: user.companyId, status: "draft" });
  if (!draft) return fail(response, "Chỉ có thể xác nhận hợp đồng nháp.", 409);
  if (!draft.scope.trim() || !draft.paymentTerms.trim() || !draft.deliveryTerms.trim()) {
    return fail(response, "Hãy hoàn thiện phạm vi, thanh toán và tiến độ trước khi xác nhận ký.", 409);
  }
  if (!validText(draft.projectName, 250) || !validText(draft.projectAddress, 250)
    || !validText(draft.deliverables, 4000) || !validMoneyAmount(draft.depositAmount, draft.total)) {
    return fail(response, "Hãy bổ sung công trình, hồ sơ bàn giao và tiền đặt cọc trước khi xác nhận ký.", 409);
  }
  const contract = await db.collection<Contract>("contracts").findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "draft" },
    { $set: { status: "signed", signedDate, updatedAt: new Date() } }, { returnDocument: "after" },
  );
  if (!contract) return fail(response, "Chỉ có thể xác nhận hợp đồng nháp.", 409);
  await writeAudit(db, user, "contract_signed", "contract", id.toHexString(), { signedDate });
  response.json({ contract });
});

app.get("/api/acceptance-records", requireRole("user"), async (request, response) => {
  const user = userOf(request);
  const records = await (await connectDatabase()).collection<AcceptanceRecord>("acceptanceRecords")
    .find({ companyId: user.companyId }).sort({ createdAt: -1 }).limit(200).toArray();
  response.json({ records });
});

app.post("/api/acceptance-records", requireRole("user"), async (request, response) => {
  const contractId = asId(request.body?.contractId);
  if (!contractId) return fail(response, "Hãy chọn hợp đồng hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const contract = await db.collection<Contract>("contracts").findOne({ _id: contractId, companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng.", 404);
  if (contract.status !== "signed") return fail(response, "Hợp đồng cần được xác nhận đã ký trước khi nghiệm thu.", 409);
  const existing = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ companyId: user.companyId, contractId: contractId.toHexString() });
  if (existing) return response.json({ record: existing });
  const requestedTemplateId = request.body?.templateId ? asId(String(request.body.templateId)) : null;
  if (request.body?.templateId && !requestedTemplateId) return fail(response, "Mẫu nghiệm thu không hợp lệ.");
  const selectedTemplate = requestedTemplateId
    ? await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: requestedTemplateId, companyId: user.companyId, category: "acceptance", deletedAt: { $exists: false } })
    : (await usableAcceptanceTemplates(db, user.companyId))[0] ?? null;
  if (requestedTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu nghiệm thu đã chọn.", 404);
  if (selectedTemplate && !contractTemplateMode(selectedTemplate)) return fail(response, "Mẫu nghiệm thu cần là file Word hoặc PDF hợp lệ.", 422);
  const { acceptedDate, location, result, notes, lines } = request.body ?? {};
  if (!validDocumentDate(acceptedDate) || !validText(location, 250) || !validText(result, 2000)
    || typeof notes !== "string" || notes.length > 4000 || !validAcceptanceLines(lines, contract)) {
    return fail(response, "Vui lòng nhập đầy đủ ngày, địa điểm, kết quả và khối lượng nghiệm thu hợp lệ.");
  }
  if (contract.signedDate && acceptedDate < contract.signedDate) return fail(response, "Ngày nghiệm thu không thể trước ngày ký hợp đồng.");
  const detailError = acceptanceDetailsError(request.body, contract);
  if (detailError) return fail(response, detailError);
  const id = new ObjectId();
  const now = new Date();
  const record: AcceptanceRecord = {
    _id: id, companyId: user.companyId, contractId: contractId.toHexString(), contractNumber: contract.contractNumber,
    acceptanceNumber: `NT-${id.toHexString().slice(-8).toUpperCase()}`, status: "draft",
    ...(selectedTemplate ? { template: { id: selectedTemplate._id!.toHexString(), name: selectedTemplate.name || selectedTemplate.originalFilename, originalFilename: selectedTemplate.originalFilename } } : {}),
    acceptedDate, location: location.trim(), result: result.trim(), notes: notes.trim(), lines,
    startTime: request.body.startTime, endTime: request.body.endTime,
    handoverDetails: request.body.handoverDetails.trim(), qualityAssessment: request.body.qualityAssessment.trim(),
    settlementAmount: request.body.settlementAmount, amountPaid: request.body.amountPaid, paymentDueDays: request.body.paymentDueDays,
    createdBy: user.id, createdAt: now, updatedAt: now,
  };
  try {
    await db.collection<AcceptanceRecord>("acceptanceRecords").insertOne(record);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const concurrent = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ companyId: user.companyId, contractId: contractId.toHexString() });
      if (concurrent) return response.json({ record: concurrent });
    }
    throw error;
  }
  await writeAudit(db, user, "acceptance_created", "acceptanceRecord", id.toHexString(), { contractId: contractId.toHexString() });
  response.status(201).json({ record });
});

function validAcceptanceLines(lines: unknown, contract: Contract): lines is AcceptanceRecord["lines"] {
  return Array.isArray(lines) && lines.length === contract.lines.length && lines.some((line) => line?.acceptedQuantity > 0)
    && lines.every((line, index) => typeof line === "object" && line !== null && line.lineIndex === index
      && typeof line.acceptedQuantity === "number" && Number.isFinite(line.acceptedQuantity)
      && line.acceptedQuantity >= 0 && line.acceptedQuantity <= contract.lines[index]!.quantity);
}

function templateFilenameStem(filename: string) {
  return filename.replace(/\.[^/.]+$/, "").trim().toLocaleLowerCase("vi-VN");
}

function acceptanceDetailsError(body: Record<string, unknown>, contract: Contract): string | null {
  if (!validDocumentTime(body.startTime) || !validDocumentTime(body.endTime) || body.endTime <= body.startTime) return "Thời gian nghiệm thu không hợp lệ.";
  if (!validText(body.handoverDetails, 4000) || !validText(body.qualityAssessment, 2000)) return "Hãy nhập hồ sơ bàn giao và đánh giá chất lượng.";
  if (!validMoneyAmount(body.settlementAmount, contract.total) || !validMoneyAmount(body.amountPaid, body.settlementAmount)) return "Giá trị quyết toán hoặc số tiền đã thanh toán không hợp lệ.";
  if (body.paymentDueDays !== null && (!Number.isInteger(body.paymentDueDays) || (body.paymentDueDays as number) < 0 || (body.paymentDueDays as number) > 3650)) return "Thời hạn thanh toán không hợp lệ.";
  return null;
}

app.get("/api/acceptance-records/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã nghiệm thu không hợp lệ.");
  const user = userOf(request);
  const db = await connectDatabase();
  const record = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ _id: id, companyId: user.companyId });
  if (!record) return fail(response, "Không tìm thấy biên bản nghiệm thu.", 404);
  const contract = await db.collection<Contract>("contracts").findOne({ _id: asId(record.contractId), companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng liên kết.", 404);
  response.json({ record, contract });
});

app.get(["/api/acceptance-records/:id/docx", "/api/acceptance-records/:id/file"], requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã nghiệm thu không hợp lệ.");
  const user = userOf(request);
  const db = await connectDatabase();
  const record = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ _id: id, companyId: user.companyId });
  if (!record) return fail(response, "Không tìm thấy biên bản nghiệm thu.", 404);
  const contract = await db.collection<Contract>("contracts").findOne({ _id: asId(record.contractId), companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng liên kết.", 404);
  const overrideTemplateId = request.query.templateId === undefined ? null : asId(String(request.query.templateId));
  if (request.query.templateId !== undefined && !overrideTemplateId) return fail(response, "Mã mẫu nghiệm thu không hợp lệ.");
  const savedTemplateId = record.template?.id ? asId(record.template.id) : null;
  if (record.template && !savedTemplateId) return fail(response, "Mẫu nghiệm thu đã lưu không hợp lệ.", 422);
  const templateCollection = db.collection<QuoteTemplate>("quoteTemplates");
  const savedTemplate = savedTemplateId
    ? await templateCollection.findOne({ _id: savedTemplateId, companyId: user.companyId, category: "acceptance" })
    : null;
  let selectedTemplate = overrideTemplateId
    ? await templateCollection.findOne({ _id: overrideTemplateId, companyId: user.companyId, category: "acceptance", deletedAt: { $exists: false } })
    : savedTemplate ?? (await usableAcceptanceTemplates(db, user.companyId))[0] ?? null;
  if (!overrideTemplateId && savedTemplate?.extension === "pdf") {
    const sourceStem = templateFilenameStem(savedTemplate.originalFilename);
    const wordTemplates = await templateCollection.find({
      companyId: user.companyId, category: "acceptance", extension: "docx", deletedAt: { $exists: false },
    }).sort({ _id: -1 }).limit(24).toArray();
    selectedTemplate = wordTemplates.find((template) => templateFilenameStem(template.originalFilename) === sourceStem) ?? savedTemplate;
  }
  if (overrideTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu nghiệm thu đã chọn.", 404);
  if (savedTemplateId && !selectedTemplate) return fail(response, "Không tìm thấy mẫu đã dùng để tạo biên bản.", 404);
  try {
    const file = selectedTemplate
      ? await renderAcceptanceFile(db, selectedTemplate, contract, record, (work) => withAiUsage(db, user, "acceptance_template_map", work))
      : { bytes: makeDocumentWord("acceptance", contract, record) };
    return sendWord(response, `${record.acceptanceNumber}.docx`, file.bytes);
  } catch (error) {
    if (error instanceof Error && /HTTP\s*402/.test(error.message)) {
      logger.warn("acceptance.word_template_ai_fallback", { recordId: id.toHexString(), templateId: selectedTemplate?._id?.toHexString(), reason: "openrouter_http_402" });
      response.setHeader("X-Acceptance-Template-Status", "fallback-ai-402");
      return sendWord(response, `${record.acceptanceNumber}.docx`, makeDocumentWord("acceptance", contract, record));
    }
    return fail(response, error instanceof Error ? error.message : "Không xuất được biên bản theo mẫu đã chọn.", error instanceof AiQuotaExceededError ? 429 : 422);
  }
});

app.patch("/api/acceptance-records/:id", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  const acceptedDate = request.body?.acceptedDate;
  const location = request.body?.location;
  const result = request.body?.result;
  const notes = request.body?.notes;
  const lines = request.body?.lines;
  if (!id || !validDocumentDate(acceptedDate) || !validText(location, 250) || !validText(result, 2000)
    || typeof notes !== "string" || notes.length > 4000 || !Array.isArray(lines)) {
    return fail(response, "Thông tin nghiệm thu không hợp lệ.");
  }
  const db = await connectDatabase();
  const user = userOf(request);
  const current = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ _id: id, companyId: user.companyId });
  if (!current) return fail(response, "Không tìm thấy biên bản nghiệm thu.", 404);
  if (current.status !== "draft") return fail(response, "Biên bản đã hoàn tất, không thể sửa.", 409);
  const contract = await db.collection<Contract>("contracts").findOne({ _id: asId(current.contractId), companyId: user.companyId });
  if (!contract) return fail(response, "Không tìm thấy hợp đồng liên kết.", 404);
  if (contract.signedDate && acceptedDate < contract.signedDate) return fail(response, "Ngày nghiệm thu không thể trước ngày ký hợp đồng.");
  const detailError = acceptanceDetailsError(request.body, contract);
  if (detailError) return fail(response, detailError);
  if (!validAcceptanceLines(lines, contract)) {
    return fail(response, "Khối lượng nghiệm thu phải nằm trong khối lượng hợp đồng.");
  }
  const record = await db.collection<AcceptanceRecord>("acceptanceRecords").findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "draft" },
    { $set: { acceptedDate, location: location.trim(), result: result.trim(), notes: notes.trim(), lines,
      startTime: request.body.startTime, endTime: request.body.endTime,
      handoverDetails: request.body.handoverDetails.trim(), qualityAssessment: request.body.qualityAssessment.trim(),
      settlementAmount: request.body.settlementAmount, amountPaid: request.body.amountPaid, paymentDueDays: request.body.paymentDueDays,
      updatedAt: new Date() } }, { returnDocument: "after" },
  );
  if (!record) return fail(response, "Biên bản đã thay đổi, hãy tải lại.", 409);
  await writeAudit(db, user, "acceptance_updated", "acceptanceRecord", id.toHexString());
  response.json({ record });
});

app.post("/api/acceptance-records/:id/complete", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã nghiệm thu không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const current = await db.collection<AcceptanceRecord>("acceptanceRecords").findOne({ _id: id, companyId: user.companyId });
  if (!current) return fail(response, "Không tìm thấy biên bản nghiệm thu.", 404);
  const contract = await db.collection<Contract>("contracts").findOne({ _id: asId(current.contractId), companyId: user.companyId });
  if (!contract || contract.status !== "signed") return fail(response, "Hợp đồng liên kết chưa được xác nhận đã ký.", 409);
  if (contract.signedDate && current.acceptedDate < contract.signedDate) return fail(response, "Ngày nghiệm thu không thể trước ngày ký hợp đồng.", 409);
  const detailError = acceptanceDetailsError(current as unknown as Record<string, unknown>, contract);
  if (detailError) return fail(response, detailError, 409);
  if (!validAcceptanceLines(current.lines, contract)) return fail(response, "Khối lượng nghiệm thu không hợp lệ.", 409);
  if (!current.lines.some((line) => line.acceptedQuantity > 0)) return fail(response, "Cần ít nhất một hạng mục có khối lượng nghiệm thu.", 409);
  const record = await db.collection<AcceptanceRecord>("acceptanceRecords").findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "draft" },
    { $set: { status: "completed", updatedAt: new Date() } }, { returnDocument: "after" },
  );
  if (!record) return fail(response, "Biên bản đã hoàn tất hoặc đã thay đổi.", 409);
  await writeAudit(db, user, "acceptance_completed", "acceptanceRecord", id.toHexString());
  response.json({ record });
});

app.get("/api/quotes/:id/export", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const quotes = db.collection<Quote>("quotes");
  const storedQuote = await quotes.findOne({ _id: id, companyId: userOf(request).companyId });
  if (!storedQuote) return fail(response, "Không tìm thấy báo giá.", 404);
  const quote = quoteForResponse(await customerQuoteWithPrices(db, storedQuote));
  const preview = request.query.preview === "1";
  const draftExport = request.query.draft === "1";
  const excelExport = request.query.excel === "1";
  if (quote.status !== "approved" && !preview && !draftExport) return fail(response, "Chỉ có thể tải file chính thức sau khi báo giá được duyệt.", 409);
  if (quote.kind === "customer") {
    const plainExcel = request.query.templateId === "none";
    const selectedId = request.query.templateId === undefined || plainExcel ? null : asId(String(request.query.templateId));
    if (request.query.templateId !== undefined && !plainExcel && !selectedId) return fail(response, "Mã mẫu Excel không hợp lệ.");
    let selected = selectedId
      ? await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: selectedId, companyId: quote.companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] } })
      : !plainExcel && quote.template ? await savedTemplate(db, quote.companyId, quote.template) : null;
    if (selectedId && !selected) return fail(response, "Không tìm thấy mẫu Excel.", 404);
    if (selected && selected.extension !== "xlsx") {
      if (selectedId) return fail(response, "Hãy chọn mẫu Excel (.xlsx).", 422);
      selected = null;
    }
    try {
      const bytes = selected ? await renderAiMappedXlsxTemplate(selected, quote) : makeQuoteExcel(quote);
      response.setHeader("Content-Type", templateFormats.xlsx);
      response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}${quote.status === "approved" ? "" : "-nhap"}.xlsx"`);
      response.send(bytes);
    } catch (error) {
      return fail(response, error instanceof Error ? error.message : "Không xuất được báo giá khách theo mẫu Excel.", 422);
    }
    return;
  }
  if (excelExport && quote.status === "approved") {
    try {
      const selected = quote.template ? await savedTemplate(db, quote.companyId, quote.template) : null;
      const bytes = selected?.extension === "xlsx"
        ? await renderAiMappedXlsxTemplate(selected, quote, await quoteInputContext(db, quote))
        : makeQuoteExcel(quote);
      response.setHeader("Content-Type", templateFormats.xlsx);
      response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}.xlsx"`);
      response.send(bytes);
    } catch (error) {
      return fail(response, error instanceof Error ? error.message : "Không xuất được báo giá theo mẫu Excel.", 422);
    }
    return;
  }
  let templateWasXlsx = false;
  try {
    const template = quote.template ? await savedTemplate(db, quote.companyId, quote.template) : null;
    templateWasXlsx = template?.extension === "xlsx";
    if (draftExport && quote.status === "approved") {
      return fail(response, "Báo giá đã duyệt; hãy tải file chính thức.", 409);
    }
    if (draftExport && (template?.extension !== "xlsx" || quote.lines.length === 0)) {
      response.setHeader("Content-Type", templateFormats.xlsx);
      response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}-nhap.xlsx"`);
      response.send(makeQuoteExcel(quote));
      return;
    }
    const inputContext = await quoteInputContext(db, quote);
    let renderQuote = quote;
    if (template && template.extension !== "xlsx") {
      const plan = await getOrCreateTemplateFillPlan(db, template, quote);
      renderQuote = { ...quote, templateFillPlan: plan };
      const fillPlanKey = `${quote.lines.some((line) => Boolean(quoteLineDetails(line))) ? "v4d" : "v4"}_${quote.lines.length}_${Object.values(quote.additionalInformation ?? {}).some((answer) => answer.trim()) ? "i1" : "i0"}`;
      if (template.extension === "pdf" || quote.lines.length > 30 || !template.fillPlanCache?.[fillPlanKey]) {
        await quotes.updateOne({ _id: id, companyId: quote.companyId }, { $set: { templateFillPlan: plan } });
      }
    }
    const bytes = template?.extension === "xlsx" ? await renderAiMappedXlsxTemplate(template, quote, inputContext)
      : template ? await renderTemplate(template, renderQuote, inputContext) : await makePdfBuffer(quote);
    const extension = template?.extension ?? "pdf";
    if (preview && extension === "docx") {
      response.type("html").setHeader("Content-Disposition", "inline").send(previewDocxHtml(bytes, `${quote.quoteNumber}.docx`));
      return;
    }
    response.setHeader("Content-Type", templateFormats[extension]);
    const filename = `${quote.quoteNumber}${draftExport ? "-nhap" : ""}.${extension}`;
    response.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${filename}"`);
    response.send(bytes);
  } catch (error) {
    if (draftExport && !templateWasXlsx && !response.headersSent) {
      response.setHeader("Content-Type", templateFormats.xlsx);
      response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}-nhap.xlsx"`);
      response.send(makeQuoteExcel(quote));
      return;
    }
    return fail(response, error instanceof Error ? error.message : "Không xuất được báo giá theo mẫu.", 422);
  }
});

app.get("/api/quotes/:id/pdf", requireRole("user"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const storedQuote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: user.companyId });
  if (!storedQuote) return fail(response, "Không tìm thấy báo giá.", 404);
  const quote = quoteForResponse(storedQuote);
  if (quote.status !== "approved") return fail(response, "Chỉ có thể xuất PDF sau khi báo giá được duyệt.", 409);
  if (quote.kind === "customer") return fail(response, "Danh sách sản phẩm khách được xuất dưới dạng Excel.", 409);
  if (quoteHasUnresolvedInformation(quote)) return fail(response, "Không thể xuất báo giá khi còn khoản chưa có giá hoặc điều khoản chưa xác nhận.", 409);
  if (quote.template) return response.redirect(307, `/api/quotes/${quote._id}/export`);
  const pdf = makePdf(quote);
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}.pdf"`);
  pdf.pipe(response);
  pdf.end();
});

const server = createServer(app);
let closeWeb: () => Promise<void> = async () => {};
closeWeb = await attachWeb(app, server);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (!(isRecord(error) && error.type === "entity.too.large")) {
    logger.error("http.unhandled_error", {
      requestId: typeof response.locals.requestId === "string" ? response.locals.requestId : undefined,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    });
  }
  if (response.headersSent) return;
  if (isRecord(error) && error.type === "entity.too.large") {
    response.status(413).json({ error: "Tệp hoặc nội dung vượt dung lượng cho phép. Mẫu báo giá tối đa 10 MB." });
    return;
  }
  const message = error instanceof Error ? error.message : "Đã có lỗi xảy ra.";
  response.status(500).json({ error: message.includes("Dịch vụ AI") || message.includes("AI trả về") ? message : "Đã có lỗi xảy ra. Vui lòng thử lại." });
});

connectDatabase()
  .then(() => {
    logger.info("database.connected", { database: config.mongoDatabase });
    server.listen(config.port, "0.0.0.0", () => {
      logger.info("server.started", { host: "0.0.0.0", port: config.port, environment: config.nodeEnv });
    });
  })
  .catch((error: unknown) => {
    logger.error("database.connection_failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    void shutdown().finally(() => process.exit(1));
  });

async function shutdown() {
  logger.info("server.shutdown_started");
  await closeWeb();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
  logger.info("server.shutdown_completed");
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
