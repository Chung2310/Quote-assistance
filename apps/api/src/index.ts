import express from "express";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { Binary, ObjectId, type Db, type Document, type Filter } from "mongodb";
import PdfPrinter from "pdfmake";
import { config } from "./config.js";
import { connectDatabase, closeDatabase } from "./db.js";
import { login, logout, requireAuth, requirePlatformAdmin, requireRole } from "./auth.js";
import { hashPassword } from "./password.js";
import { analyzeRequest } from "./ai.js";
import { analyzePriceList, extractPriceListRows, type PriceList } from "./price-list.js";
import { requestFileContent, type RequestFile } from "./request-file.js";
import { createCompanySmtpTransport, encryptSmtpPassword } from "./mail.js";
import { downloadCompanyFile, uploadCompanyFile } from "./cloudinary.js";
import { calculateQuote, recalculateSnapshot } from "./pricing.js";
import { attachWeb } from "./web.js";
import { currentTemplate, getOrCreateTemplateFillPlan, inspectTemplate, previewDocxHtml, renderTemplate, savedTemplate, templateDetails, templateFormats, type QuoteTemplate } from "./quote-template.js";
import type { CatalogItem, Company, CompanyFile, CompanyProfileDetails, CompanySmtpSettings, Quote, QuoteRequest, QuoteStatus, SessionUser, UserAccount } from "./types.js";

const app = express();
const require = createRequire(import.meta.url);
type PdfDocumentDefinition = Parameters<InstanceType<typeof PdfPrinter>["createPdfKitDocument"]>[0];
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

interface CatalogImportRow {
  sku: string;
  name: string;
  description: string;
  unit: string;
  price: number;
  currency: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

type CatalogRowResult = { ok: true; value: CatalogImportRow } | { ok: false; error: string };

interface PlatformSmtpSettingsDocument extends Document {
  _id: string;
  smtpSettings?: CompanySmtpSettings;
  updatedAt: Date;
}

app.disable("x-powered-by");
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

function publicUserAccount(account: UserAccount) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    companyId: account.companyId,
    platformAdmin: account.platformAdmin === true,
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
  if (problems.length) return { ok: false, error: `Dòng ${rowNumber}: ${problems.join("; ")}.` };
  return {
    ok: true,
    value: {
      sku,
      name,
      description: description.slice(0, 2000),
      unit,
      price: rawPrice,
      currency: rowCurrency,
      effectiveFrom: effectiveFrom || undefined,
      effectiveTo: effectiveTo || undefined,
    },
  };
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

function publicSmtpSettings(settings?: CompanySmtpSettings) {
  return {
    configured: Boolean(settings?.host),
    host: settings?.host ?? "",
    port: settings?.port ?? 587,
    secure: settings?.secure ?? false,
    user: settings?.user ?? "",
    from: settings?.from ?? "",
    passwordSet: Boolean(settings?.passwordEncrypted),
  };
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
              `${line.name}${Object.keys(line.attributes).length ? `\n${Object.entries(line.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ")}` : ""}`,
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
            [`Thuế (${(quote.taxRate * 100).toLocaleString("vi-VN")}%)`, { text: formatMoney(quote.taxAmount, quote.currency), alignment: "right" }],
            [{ text: "TỔNG CỘNG", bold: true }, { text: formatMoney(quote.total, quote.currency), bold: true, alignment: "right" }],
          ] }, layout: "noBorders", margin: [0, 12, 0, 0] },
        ],
      },
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
  if (!validText(name, 200)) return fail(response, "Họ tên người quản trị bắt buộc, tối đa 200 ký tự.");
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
  const company: Company = { ...profile.value, code: randomUUID(), createdAt: now, updatedAt: now };
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
    role: "admin",
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

app.use("/api", requireAuth);
app.get("/api/auth/me", (request, response) => response.json({ user: userOf(request) }));

app.get("/api/admin/businesses", requirePlatformAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const accounts = await db.collection<UserAccount>("users")
    .find({ role: "admin", platformAdmin: { $ne: true }, companyId: { $type: "string" } })
    .sort({ createdAt: -1 })
    .toArray();
  const validAccounts = accounts.filter((account) => ObjectId.isValid(account.companyId));
  const companyIds = validAccounts.map((account) => new ObjectId(account.companyId));
  const companies = await db.collection<Company>("companies").find({ _id: { $in: companyIds } }).toArray();
  const companiesById = new Map(companies.map((company) => [company._id?.toHexString(), company]));
  response.json({
    businesses: validAccounts.filter((account) => companiesById.has(account.companyId)).map((account) => {
      const company = companiesById.get(account.companyId);
      return {
        ...publicUserAccount(account),
        companyName: company?.name ?? "",
        taxId: company?.taxId ?? "",
        address: company?.address ?? "",
        phone: company?.phone ?? "",
        businessEmail: company?.businessEmail ?? "",
        representativeName: company?.representativeName ?? "",
      };
    }),
  });
});

app.post("/api/admin/businesses", requirePlatformAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin doanh nghiệp không hợp lệ.");
  const body = request.body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  const profile = parseCompanyProfile(body);
  if (!validText(name, 200)) return fail(response, "Họ tên người quản trị bắt buộc, tối đa 200 ký tự.");
  if (!validEmail(email)) return fail(response, "Email đăng nhập không hợp lệ.");
  if (typeof password !== "string" || password.length < 7 || password.length > 200) {
    return fail(response, "Mật khẩu ban đầu phải dài từ 7 đến 200 ký tự.");
  }
  if (!profile.value) return fail(response, profile.error ?? "Thông tin doanh nghiệp chưa đầy đủ.");

  const db = await connectDatabase();
  const accounts = db.collection<UserAccount>("users");
  const companies = db.collection<Company>("companies");
  const existingAccount = await accounts.findOne({ email });
  const canAdoptLegacyAccount = Boolean(existingAccount)
    && existingAccount?.platformAdmin !== true
    && (!existingAccount?.id || !ObjectId.isValid(existingAccount.companyId) || typeof existingAccount.passwordHash !== "string");
  if (existingAccount && !canAdoptLegacyAccount) return fail(response, "Email đăng nhập đã được dùng.", 409);
  if (await companies.findOne({ normalizedName: profile.value.normalizedName }, { projection: { _id: 1 } })) {
    return fail(response, "Tên doanh nghiệp này đã tồn tại.", 409);
  }

  const now = new Date();
  const company: Company = { ...profile.value, code: randomUUID(), createdAt: now, updatedAt: now };
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
    role: "admin",
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
    },
  });
});

app.patch("/api/admin/businesses/:id", requirePlatformAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin doanh nghiệp không hợp lệ.");
  const body = request.body;
  const allowedFields = ["name", "email", "active", "companyName", "taxId", "address", "phone", "businessEmail", "representativeName"];
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return fail(response, "Hãy chọn thông tin doanh nghiệp cần cập nhật.");
  }
  const targetId = request.params.id;
  if (typeof targetId !== "string") return fail(response, "Mã tài khoản không hợp lệ.");
  const db = await connectDatabase();
  const accounts = db.collection<UserAccount>("users");
  const target = await accounts.findOne({ id: targetId, role: "admin", platformAdmin: { $ne: true } });
  if (!target || !ObjectId.isValid(target.companyId)) return fail(response, "Không tìm thấy doanh nghiệp.", 404);

  const profile = parseCompanyProfile(body);
  if (!profile.value) return fail(response, profile.error ?? "Thông tin doanh nghiệp chưa đầy đủ.");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validText(name, 200)) return fail(response, "Họ tên người quản trị không hợp lệ.");
  if (!validEmail(email)) return fail(response, "Email đăng nhập không hợp lệ.");
  if (await accounts.findOne({ email, id: { $ne: targetId } }, { projection: { _id: 1 } })) {
    return fail(response, "Email đăng nhập đã được dùng.", 409);
  }
  const companyId = new ObjectId(target.companyId);
  const companies = db.collection<Company>("companies");
  if (await companies.findOne({ normalizedName: profile.value.normalizedName, _id: { $ne: companyId } }, { projection: { _id: 1 } })) {
    return fail(response, "Tên doanh nghiệp này đã tồn tại.", 409);
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
  await companies.updateOne({ _id: companyId }, { $set: { ...profile.value, updatedAt: new Date() } });
  await accounts.updateOne({ id: targetId, companyId: target.companyId }, { $set: updates });
  await writeAudit(db, userOf(request), "business_account_updated", "company", target.companyId, { fields: Object.keys(body) });
  response.json({
    business: {
      ...publicUserAccount({ ...target, ...updates }),
      companyName: profile.value.name,
      taxId: profile.value.taxId,
      address: profile.value.address,
      phone: profile.value.phone,
      businessEmail: profile.value.businessEmail,
      representativeName: profile.value.representativeName,
    },
  });
});

app.put("/api/admin/businesses/:id/password", requirePlatformAdmin, async (request, response) => {
  const password = request.body?.password;
  if (typeof password !== "string" || password.length < 7 || password.length > 200) {
    return fail(response, "Mật khẩu mới phải dài từ 7 đến 200 ký tự.");
  }
  const targetId = request.params.id;
  if (typeof targetId !== "string") return fail(response, "Mã tài khoản không hợp lệ.");
  const db = await connectDatabase();
  const target = await db.collection<UserAccount>("users").findOneAndUpdate(
    { id: targetId, role: "admin", platformAdmin: { $ne: true } },
    { $set: { passwordHash: hashPassword(password), updatedAt: new Date() }, $inc: { authVersion: 1 } },
    { returnDocument: "after", projection: { companyId: 1 } },
  );
  if (!target) return fail(response, "Không tìm thấy doanh nghiệp.", 404);
  await writeAudit(db, userOf(request), "business_password_reset", "company", target.companyId);
  response.status(204).end();
});

app.get("/api/admin/settings/email", requirePlatformAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const settings = await db.collection<PlatformSmtpSettingsDocument>("platformSettings").findOne({ _id: "smtp" });
  response.json({ settings: publicSmtpSettings(settings?.smtpSettings) });
});

app.put("/api/admin/settings/email", requirePlatformAdmin, async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin SMTP không hợp lệ.");
  const body = request.body;
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const port = Number(body.port);
  const secure = body.secure;
  const smtpUser = typeof body.user === "string" ? body.user.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const fromAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!host || host.length > 253) return fail(response, "Hãy nhập tên máy chủ SMTP hợp lệ.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(response, "Cổng SMTP phải là số nguyên từ 1 đến 65535.");
  if (typeof secure !== "boolean") return fail(response, "Hãy chọn kiểu kết nối SMTP hợp lệ.");
  if (smtpUser.length > 320 || password.length > 1024) return fail(response, "Thông tin đăng nhập SMTP quá dài.");
  if (!from || from.length > 320 || !validEmail(fromAddress)) return fail(response, "Hãy nhập email người gửi hợp lệ.");
  if (!smtpUser && password) return fail(response, "Nhập tên đăng nhập SMTP để sử dụng mật khẩu.");

  const db = await connectDatabase();
  const settingsCollection = db.collection<PlatformSmtpSettingsDocument>("platformSettings");
  const existing = await settingsCollection.findOne({ _id: "smtp" });
  let passwordEncrypted: string | undefined;
  if (smtpUser) {
    if (password) passwordEncrypted = encryptSmtpPassword(password);
    else if (existing?.smtpSettings?.user === smtpUser && existing.smtpSettings.passwordEncrypted) {
      passwordEncrypted = existing.smtpSettings.passwordEncrypted;
    } else {
      return fail(response, "Hãy nhập mật khẩu SMTP cho tài khoản này.");
    }
  }
  const smtpSettings: CompanySmtpSettings = {
    host, port, secure, user: smtpUser, from,
    ...(passwordEncrypted ? { passwordEncrypted } : {}),
  };
  await settingsCollection.updateOne(
    { _id: "smtp" },
    { $set: { smtpSettings, updatedAt: new Date() } },
    { upsert: true },
  );
  await writeAudit(db, userOf(request), "platform_smtp_settings_updated", "platformSettings", "smtp", {
    host, port, secure, authenticated: Boolean(smtpUser), from,
  });
  response.json({ settings: publicSmtpSettings(smtpSettings) });
});

app.post("/api/admin/settings/email/test", requirePlatformAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const settings = await db.collection<PlatformSmtpSettingsDocument>("platformSettings").findOne({ _id: "smtp" });
  if (!settings?.smtpSettings) return fail(response, "Hãy lưu cấu hình SMTP trước khi kiểm tra.", 409);
  let transport: ReturnType<typeof createCompanySmtpTransport> | undefined;
  try {
    transport = createCompanySmtpTransport(settings.smtpSettings);
    await transport.verify();
    response.json({ connected: true });
  } catch {
    return fail(response, "Không kết nối được SMTP. Hãy kiểm tra máy chủ, cổng và thông tin đăng nhập.", 502);
  } finally {
    transport?.close();
  }
});

app.get("/api/admin/email/recipients", requirePlatformAdmin, async (_request, response) => {
  const db = await connectDatabase();
  const accounts = await db.collection<UserAccount>("users")
    .find({ platformAdmin: { $ne: true } })
    .project<{ email: string }>({ email: 1 })
    .toArray();
  const recipients = [...new Set(accounts.map((account) => account.email.trim().toLowerCase()).filter(validEmail))];
  response.json({ recipientCount: recipients.length });
});

app.post("/api/admin/email/broadcast", requirePlatformAdmin, async (request, response) => {
  const subject = request.body?.subject;
  const message = request.body?.message;
  if (!validText(subject, 200) || !validText(message, 10_000)) {
    return fail(response, "Hãy nhập tiêu đề (tối đa 200 ký tự) và nội dung email (tối đa 10.000 ký tự).");
  }
  const db = await connectDatabase();
  const settings = await db.collection<PlatformSmtpSettingsDocument>("platformSettings").findOne({ _id: "smtp" });
  if (!settings?.smtpSettings) return fail(response, "Quản trị viên chưa cấu hình SMTP gửi thông báo.", 409);
  const accounts = await db.collection<UserAccount>("users")
    .find({ platformAdmin: { $ne: true } })
    .project<{ email: string }>({ email: 1 })
    .toArray();
  const recipients = [...new Set(accounts.map((account) => account.email.trim().toLowerCase()).filter(validEmail))];
  if (!recipients.length) return fail(response, "Không có tài khoản người dùng nào có email hợp lệ.", 409);

  let transport: ReturnType<typeof createCompanySmtpTransport> | undefined;
  try {
    transport = createCompanySmtpTransport(settings.smtpSettings);
    await transport.sendMail({
      from: settings.smtpSettings.from,
      to: settings.smtpSettings.from,
      bcc: recipients,
      subject: subject.trim(),
      text: message.trim(),
    });
  } catch {
    return fail(response, "Gửi email thông báo không thành công. Hãy kiểm tra SMTP hoặc thử lại sau.", 502);
  } finally {
    transport?.close();
  }
  await writeAudit(db, userOf(request), "platform_email_broadcast_sent", "platform", "users", {
    recipientCount: recipients.length,
    subject: subject.trim(),
  });
  response.json({ sentCount: recipients.length });
});

app.get("/api/settings/email", requireRole("admin"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(user.companyId) });
  if (!company) return fail(response, "Không tìm thấy doanh nghiệp.", 404);
  response.json({ settings: publicSmtpSettings(company.smtpSettings) });
});

app.put("/api/settings/email", requireRole("admin"), async (request, response) => {
  if (!isRecord(request.body)) return fail(response, "Thông tin SMTP không hợp lệ.");
  const body = request.body;
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const port = Number(body.port);
  const secure = body.secure;
  const smtpUser = typeof body.user === "string" ? body.user.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const fromAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;

  if (!host || host.length > 253) return fail(response, "Hãy nhập tên máy chủ SMTP hợp lệ.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(response, "Cổng SMTP phải là số nguyên từ 1 đến 65535.");
  if (typeof secure !== "boolean") return fail(response, "Hãy chọn kiểu kết nối SMTP hợp lệ.");
  if (smtpUser.length > 320 || password.length > 1024) return fail(response, "Thông tin đăng nhập SMTP quá dài.");
  if (!from || from.length > 320 || !validEmail(fromAddress)) return fail(response, "Hãy nhập email người gửi hợp lệ.");
  if (!smtpUser && password) return fail(response, "Nhập tên đăng nhập SMTP để sử dụng mật khẩu.");

  const db = await connectDatabase();
  const user = userOf(request);
  const companies = db.collection<Company>("companies");
  const companyId = new ObjectId(user.companyId);
  const existingCompany = await companies.findOne({ _id: companyId }, { projection: { smtpSettings: 1 } });
  if (!existingCompany) return fail(response, "Không tìm thấy doanh nghiệp.", 404);
  const existingSettings = existingCompany.smtpSettings;
  let passwordEncrypted: string | undefined;
  if (smtpUser) {
    if (password) passwordEncrypted = encryptSmtpPassword(password);
    else if (existingSettings?.user === smtpUser && existingSettings.passwordEncrypted) {
      passwordEncrypted = existingSettings.passwordEncrypted;
    } else {
      return fail(response, "Hãy nhập mật khẩu SMTP cho tài khoản này.");
    }
  }

  const smtpSettings: CompanySmtpSettings = {
    host,
    port,
    secure,
    user: smtpUser,
    from,
    ...(passwordEncrypted ? { passwordEncrypted } : {}),
  };
  await companies.updateOne({ _id: companyId }, { $set: { smtpSettings, updatedAt: new Date() } });
  await writeAudit(db, user, "smtp_settings_updated", "company", user.companyId, {
    host,
    port,
    secure,
    authenticated: Boolean(smtpUser),
    from,
  });
  response.json({ settings: publicSmtpSettings(smtpSettings) });
});

app.delete("/api/settings/email", requireRole("admin"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  await db.collection<Company>("companies").updateOne(
    { _id: new ObjectId(user.companyId) },
    { $unset: { smtpSettings: "" }, $set: { updatedAt: new Date() } },
  );
  await writeAudit(db, user, "smtp_settings_deleted", "company", user.companyId);
  response.status(204).end();
});

app.post("/api/settings/email/test", requireRole("admin"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(user.companyId) });
  if (!company?.smtpSettings) return fail(response, "Hãy lưu cấu hình SMTP trước khi kiểm tra.", 409);

  let transport: ReturnType<typeof createCompanySmtpTransport> | undefined;
  try {
    transport = createCompanySmtpTransport(company.smtpSettings);
    await transport.verify();
    response.json({ connected: true });
  } catch {
    return fail(response, "Không kết nối được SMTP. Hãy kiểm tra máy chủ, cổng và thông tin đăng nhập.", 502);
  } finally {
    transport?.close();
  }
});

app.get("/api/quote-templates", requireRole("sales", "admin"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const cursor = request.query.cursor === undefined ? undefined : asId(String(request.query.cursor));
  if (request.query.cursor !== undefined && !cursor) return fail(response, "Trang danh sách mẫu không hợp lệ.");
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(user.companyId) }, { projection: { quoteTemplateId: 1 } });
  const templates = await db.collection<QuoteTemplate>("quoteTemplates")
    .find({ companyId: user.companyId, ...(cursor ? { _id: { $lt: cursor } } : {}) }, { projection: { data: 0, fillPlanCache: 0 } })
    .sort({ _id: -1 }).limit(13).toArray();
  const page = templates.slice(0, 12);
  response.json({ templates: page.map(templateDetails), defaultTemplateId: company?.quoteTemplateId ?? null, nextCursor: templates.length > 12 ? page[11]._id!.toHexString() : null });
});

app.get("/api/quote-template", async (request, response) => {
  const template = await currentTemplate(await connectDatabase(), userOf(request).companyId);
  response.json({ template: template ? templateDetails(template) : null });
});

app.post("/api/quote-template", requireRole("admin"), express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
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
  const template: QuoteTemplate = { companyId: user.companyId, name, originalFilename, extension, bytes: request.body.length, data: new Binary(request.body), createdAt: new Date(), uploadedBy: user.id };
  const result = await db.collection<QuoteTemplate>("quoteTemplates").insertOne(template);
  template._id = result.insertedId;
  await db.collection<Company>("companies").updateOne({ _id: companyId }, { $set: { quoteTemplateId: result.insertedId.toHexString(), updatedAt: new Date() } });
  await writeAudit(db, user, "quote_template_uploaded", "company", user.companyId, { templateId: result.insertedId.toHexString(), originalFilename });
  response.status(201).json({ template: templateDetails(template) });
});

app.get("/api/quote-template/:id/file", async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã mẫu không hợp lệ.");
  const db = await connectDatabase();
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: id, companyId: userOf(request).companyId }, { projection: { fillPlanCache: 0 } });
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

app.get("/api/price-list/:id/file", async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã bảng giá không hợp lệ.");
  const file = await (await connectDatabase()).collection<PriceList>("priceLists").findOne({ _id: id, companyId: userOf(request).companyId }, { projection: { analysisRows: 0 } });
  if (!file) return fail(response, "Không tìm thấy bảng giá.", 404);
  response.type(file.originalFilename.split(".").pop() === "csv" ? "text/csv" : "application/octet-stream")
    .setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`)
    .send(Buffer.from(file.data.buffer));
});

app.get("/api/files", requireRole("admin"), async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const files = await db.collection<CompanyFile>("companyFiles")
    .find({ companyId: user.companyId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  response.json({ files: files.map(uploadedFileDetails) });
});

app.get("/api/files/:id/preview", requireRole("admin"), async (request, response) => {
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

app.post("/api/files", requireRole("admin"), express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
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

app.get("/api/dashboard", async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const [total, drafts, pending, approved, recent] = await Promise.all([
    quotes.countDocuments({ companyId: user.companyId }),
    quotes.countDocuments({ companyId: user.companyId, status: "draft" }),
    quotes.countDocuments({ companyId: user.companyId, status: "pending_review" }),
    quotes.countDocuments({ companyId: user.companyId, status: "approved" }),
    quotes.find({ companyId: user.companyId }).sort({ createdAt: -1 }).limit(8).toArray(),
  ]);
  response.json({ counts: { total, drafts, pending, approved }, recent });
});

app.get("/api/price-list", async (request, response) => {
  const files = await (await connectDatabase()).collection<PriceList>("priceLists").find({ companyId: userOf(request).companyId }, { projection: { data: 0, analysisRows: 0 } }).sort({ updatedAt: -1, _id: -1 }).toArray();
  response.json({ files });
});

app.post("/api/price-list", requireRole("admin"), express.raw({ type: "application/octet-stream", limit: "5mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) return fail(response, "Hãy chọn file bảng giá.");
  let originalFilename: string;
  try { originalFilename = decodeURIComponent(request.header("x-file-name") ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
  catch { return fail(response, "Tên file không hợp lệ."); }
  if (!originalFilename || originalFilename.length > 255 || !/\.(csv|xlsx|xls)$/i.test(originalFilename)) return fail(response, "Chọn file CSV, XLSX hoặc XLS.");
  const user = userOf(request);
  const file: PriceList = { companyId: user.companyId, originalFilename, bytes: request.body.length, data: new Binary(request.body), uploadedBy: user.id, updatedAt: new Date() };
  try { file.analysisRows = extractPriceListRows(file); }
  catch (error) { return fail(response, error instanceof Error ? error.message : "Không đọc được bảng giá.", 422); }
  const db = await connectDatabase();
  const saved = await db.collection<PriceList>("priceLists").insertOne(file);
  await writeAudit(db, user, "price_list_uploaded", "company", user.companyId, { originalFilename });
  response.status(201).json({ file: { _id: saved.insertedId.toHexString(), originalFilename, bytes: file.bytes, updatedAt: file.updatedAt } });
});

app.get("/api/catalog", async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const items = await scoped<CatalogItem>(db, "catalogItems", user).sort({ sku: 1 }).limit(2000).toArray();
  response.json({ items, currency: config.currency });
});

app.post("/api/catalog/import/preview", requireRole("admin"), (request, response) => {
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

app.post("/api/catalog/import/confirm", requireRole("admin"), async (request, response) => {
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

app.post("/api/request-files", requireRole("sales", "admin"), express.raw({ type: "application/octet-stream", limit: "10mb" }), async (request, response) => {
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

app.get("/api/request-files/:id/preview", requireRole("sales", "admin"), async (request, response) => {
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

app.post("/api/quote-requests", requireRole("sales", "admin"), async (request, response) => {
  const { customerName = "", customerEmail = "", customerPhone = "", requestText = "", idempotencyKey } = request.body ?? {};
  const requestFileId = request.body?.requestFileId ? asId(String(request.body.requestFileId)) : undefined;
  const templateId = asId(String(request.body?.templateId ?? ""));
  const priceListId = asId(String(request.body?.priceListId ?? ""));
  if (!validText(idempotencyKey, 100) || typeof customerName !== "string" || customerName.length > 250 || typeof customerPhone !== "string" || customerPhone.length > 50 || typeof customerEmail !== "string" || customerEmail.length > 250 || typeof requestText !== "string" || requestText.length > 10_000 || (!requestText.trim() && !requestFileId) || (request.body?.requestFileId && !requestFileId) || !templateId || !priceListId) {
    fail(response, "Hãy chọn mẫu báo giá, bảng giá và nhập yêu cầu khách hàng hoặc tải file yêu cầu (văn bản tối đa 10.000 ký tự).");
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
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: templateId, companyId: user.companyId }, { projection: { data: 0, fillPlanCache: 0 } });
  const priceList = await db.collection<PriceList>("priceLists").findOne({ _id: priceListId, companyId: user.companyId }, { projection: { data: 0, analysisRows: 0 } });
  if (!template || !priceList) return fail(response, "Mẫu báo giá hoặc bảng giá không thuộc doanh nghiệp hoặc không còn tồn tại.", 404);
  const requestFile = requestFileId ? await db.collection<RequestFile>("requestFiles").findOne({ _id: requestFileId, companyId: user.companyId, uploadedBy: user.id }, { projection: { data: 0 } }) : null;
  if (requestFileId && !requestFile) return fail(response, "Không tìm thấy file yêu cầu đã tải lên.", 404);
  const document: QuoteRequest = {
    companyId: user.companyId,
    template: { id: template._id!.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename },
    priceListId: priceListId.toHexString(),
    priceListFilename: priceList.originalFilename,
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

app.get("/api/quote-requests", async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const items = await scoped<QuoteRequest>(db, "quoteRequests", user).sort({ createdAt: -1 }).limit(50).toArray();
  response.json({ requests: items });
});

app.post("/api/quote-requests/:id/analyze", requireRole("sales", "admin"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã yêu cầu không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const requests = db.collection<QuoteRequest>("quoteRequests");
  const quoteRequest = await requests.findOne({ _id: id, companyId: user.companyId });
  if (!quoteRequest) return fail(response, "Không tìm thấy yêu cầu.", 404);
  if (quoteRequest.analyzedAt) {
    response.json({ analysis: { status: quoteRequest.status, items: quoteRequest.items, missingFields: quoteRequest.missingFields, customerName: quoteRequest.customerName, customerEmail: quoteRequest.customerEmail }, candidates: quoteRequest.candidates ?? [] });
    return;
  }
  const priceLists = await db.collection<PriceList>("priceLists").find({ companyId: user.companyId, ...(quoteRequest.priceListId ? { _id: new ObjectId(quoteRequest.priceListId) } : {}) }).sort({ updatedAt: -1, _id: -1 }).toArray();
  if (quoteRequest.priceListId && !priceLists.length) return fail(response, "Không tìm thấy bảng giá đã chọn.", 404);
  const catalog = priceLists.length ? [] : await db.collection<CatalogItem>("catalogItems").find(currentCatalogFilter(user.companyId)).limit(5000).toArray();
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
  const result: Awaited<ReturnType<typeof analyzeRequest>> & { candidates?: CatalogItem[]; customerName?: string; customerEmail?: string } = priceLists.length
    ? await analyzePriceList(quoteRequest.requestText, priceLists, [], requestFile ? await requestFileContent(requestFile) : [])
    : await analyzeRequest(quoteRequest.requestText, catalog);
  result.customerName = quoteRequest.customerName.trim() || result.customerName || "";
  result.customerEmail = quoteRequest.customerEmail.trim() || result.customerEmail || "";
  const candidates = result.candidates ?? catalog.filter((candidate) => result.items.some((item) => item.catalogItemId === String(candidate._id)));
  await requests.updateOne({ _id: id, companyId: user.companyId }, { $set: { ...result, candidates, ...(priceLists.length ? { priceListFilenames: priceLists.map((file) => file.originalFilename) } : {}), analyzedAt: new Date() } });
  await writeAudit(db, user, "request_analyzed", "quoteRequest", id.toHexString(), { status: result.status, itemCount: result.items.length });
  response.json({ analysis: result, candidates });
});

app.get("/api/quotes", async (request, response) => {
  const db = await connectDatabase();
  const user = userOf(request);
  const status = request.query.status;
  const filter: Document = { companyId: user.companyId };
  if (typeof status === "string" && ["draft", "needs_info", "pending_review", "approved", "rejected"].includes(status)) filter.status = status;
  const quotes = await db.collection<Quote>("quotes").find(filter).sort({ createdAt: -1 }).limit(100).toArray();
  response.json({ quotes });
});

app.post("/api/quotes", requireRole("sales", "admin"), async (request, response) => {
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
  const source = await db.collection<QuoteRequest>("quoteRequests").findOne({ _id: requestId, companyId: user.companyId });
  if (!source || !source.analyzedAt) return fail(response, "Hãy phân tích yêu cầu trước khi tạo báo giá.");
  if (!source.template) return fail(response, "Yêu cầu chưa có mẫu báo giá. Vui lòng tạo yêu cầu mới để tự chọn mẫu doanh nghiệp.", 409);
  const template = await savedTemplate(db, user.companyId, source.template);
  for (const item of requestedItems) {
    if (!isRecord(item) || typeof item.catalogItemId !== "string") {
      return fail(response, "Dòng hàng không hợp lệ.");
    }
  }
  const catalogIds = [...new Set(requestedItems.map((item: { catalogItemId: string }) => asId(item.catalogItemId)).filter(Boolean))] as ObjectId[];
  const catalog = await db.collection<CatalogItem>("catalogItems").find({ _id: { $in: catalogIds }, ...currentCatalogFilter(user.companyId) }).toArray();
  let totals;
  try {
    totals = calculateQuote(source.priceListId ? (source.candidates ?? []) : [...catalog, ...(source.candidates ?? [])], requestedItems);
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
    informationNeeded: source.missingFields,
    informationConfirmed,
    status: source.missingFields.length > 0 && !informationConfirmed ? "needs_info" : "draft",
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const plan = await getOrCreateTemplateFillPlan(db, template, quote);
    if (template.extension === "pdf" || quote.lines.length > 30 || !template.fillPlanCache?.[String(quote.lines.length)]) quote.templateFillPlan = plan;
  }
  catch (error) { return fail(response, error instanceof Error ? error.message : "AI chưa điền được mẫu báo giá. Hãy thử lại.", 422); }
  try {
    const result = await quotes.insertOne(quote);
    const saved = { ...quote, _id: result.insertedId };
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

app.get("/api/quotes/:id", async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const quote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: userOf(request).companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  response.json({ quote });
});

app.get("/api/quotes/:id/request-file/preview", requireRole("sales", "admin"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: user.companyId });
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

app.patch("/api/quotes/:id", requireRole("sales", "admin"), async (request, response) => {
  const id = asId(request.params.id);
  const updates = request.body?.items;
  if (!id || !Array.isArray(updates) || updates.length === 0 || updates.length > 100) return fail(response, "Danh sách dòng hàng không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "draft" && quote.status !== "needs_info" && quote.status !== "rejected") return fail(response, "Chỉ có thể chỉnh sửa báo giá đang ở trạng thái nháp hoặc cần chỉnh sửa.", 409);
  if (updates.some((item: unknown) => !isRecord(item) || typeof item.catalogItemId !== "string" || !quote.lines.some((line) => line.catalogItemId === item.catalogItemId))) {
    return fail(response, "Không thể thêm mặt hàng ngoài danh sách đã phân tích.");
  }
  let totals;
  try {
    totals = recalculateSnapshot(quote.lines, updates.map((item: Record<string, unknown>) => ({
      catalogItemId: String(item.catalogItemId), quantity: Number(item.quantity),
    })), quote.taxRate);
  } catch (error) {
    return fail(response, error instanceof Error ? error.message : "Không thể tính lại báo giá.");
  }
  const informationConfirmed = request.body?.informationConfirmed === true || quote.informationConfirmed;
  const nextStatus: QuoteStatus = quote.status === "rejected" || (quote.status === "needs_info" && informationConfirmed) ? "draft" : quote.status;
  const customerName = request.body?.customerName ?? quote.customerName;
  const customerEmail = request.body?.customerEmail ?? quote.customerEmail;
  const customerPhone = request.body?.customerPhone ?? quote.customerPhone ?? "";
  if (typeof customerPhone !== "string" || customerPhone.length > 50) return fail(response, "Số điện thoại không hợp lệ (tối đa 50 ký tự).");
  if (!validText(customerName, 250) || typeof customerEmail !== "string" || customerEmail.length > 250 || (customerEmail.trim() && !validEmail(customerEmail.trim()))) return fail(response, "Vui lòng nhập tên khách hàng và email hợp lệ (nếu có).");
  const customer = { customerName: customerName.trim(), customerEmail: customerEmail.trim(), customerPhone: customerPhone.trim() };
  const updatedQuote = { ...quote, ...totals, ...customer };
  if (quote.template) {
    try {
      const template = await savedTemplate(db, user.companyId, quote.template);
      if (totals.lines.length !== quote.lines.length) {
        const plan = await getOrCreateTemplateFillPlan(db, template, updatedQuote);
        if (template.extension === "pdf" || totals.lines.length > 30 || !template.fillPlanCache?.[String(totals.lines.length)]) updatedQuote.templateFillPlan = plan;
        else updatedQuote.templateFillPlan = undefined;
      } else if (!quote.templateFillPlan && !template.fillPlanCache?.[String(totals.lines.length)]) {
        const plan = await getOrCreateTemplateFillPlan(db, template, updatedQuote);
        if (template.extension === "pdf" || totals.lines.length > 30 || !template.fillPlanCache?.[String(totals.lines.length)]) updatedQuote.templateFillPlan = plan;
      }
      await renderTemplate(template, updatedQuote);
    } catch (error) { return fail(response, error instanceof Error ? error.message : "Không cập nhật được mẫu báo giá.", 422); }
  }
  await quotes.updateOne({ _id: id, companyId: user.companyId }, {
    $set: { ...totals, ...customer, ...(updatedQuote.templateFillPlan ? { templateFillPlan: updatedQuote.templateFillPlan } : {}), informationConfirmed, status: nextStatus, updatedAt: new Date() },
    ...(updatedQuote.templateFillPlan ? {} : { $unset: { templateFillPlan: "" } }),
  });
  await writeAudit(db, user, "quote_recalculated", "quote", id.toHexString(), { total: totals.total });
  response.json({ quote: await quotes.findOne({ _id: id, companyId: user.companyId }) });
});

app.post("/api/quotes/:id/submit-review", requireRole("sales", "admin"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const quote = await quotes.findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "draft" || (quote.informationNeeded.length > 0 && !quote.informationConfirmed)) return fail(response, "Hãy xác nhận đầy đủ thông tin trước khi gửi duyệt.", 409);
  await quotes.updateOne({ _id: id, companyId: user.companyId }, { $set: { status: "pending_review", updatedAt: new Date() } });
  await writeAudit(db, user, "quote_submitted", "quote", id.toHexString());
  response.json({ quote: await quotes.findOne({ _id: id, companyId: user.companyId }) });
});

app.post("/api/quotes/:id/approve", requireRole("admin"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quotes = db.collection<Quote>("quotes");
  const result = await quotes.findOneAndUpdate(
    { _id: id, companyId: user.companyId, status: "pending_review" },
    { $set: { status: "approved", approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) return fail(response, "Chỉ có thể duyệt báo giá đang chờ duyệt.", 409);
  await writeAudit(db, user, "quote_approved", "quote", id.toHexString());
  response.json({ quote: result });
});

app.post("/api/quotes/:id/reject", requireRole("admin"), async (request, response) => {
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

app.get("/api/quotes/:id/export", async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const quote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: userOf(request).companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "approved") return fail(response, "Chỉ có thể xuất file sau khi báo giá được duyệt.", 409);
  try {
    const template = quote.template ? await savedTemplate(db, quote.companyId, quote.template) : null;
    const bytes = template ? await renderTemplate(template, quote) : await makePdfBuffer(quote);
    const extension = template?.extension ?? "pdf";
    if (request.query.preview === "1" && extension === "docx") {
      response.type("html").setHeader("Content-Disposition", "inline").send(previewDocxHtml(bytes, `${quote.quoteNumber}.docx`));
      return;
    }
    response.setHeader("Content-Type", templateFormats[extension]);
    response.setHeader("Content-Disposition", `${request.query.preview === "1" ? "inline" : "attachment"}; filename="${quote.quoteNumber}.${extension}"`);
    response.send(bytes);
  } catch (error) { return fail(response, error instanceof Error ? error.message : "Không xuất được báo giá theo mẫu.", 422); }
});

app.get("/api/quotes/:id/pdf", async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");
  const db = await connectDatabase();
  const user = userOf(request);
  const quote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "approved") return fail(response, "Chỉ có thể xuất PDF sau khi báo giá được duyệt.", 409);
  if (quote.template) return response.redirect(307, `/api/quotes/${quote._id}/export`);
  const pdf = makePdf(quote);
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename="${quote.quoteNumber}.pdf"`);
  pdf.pipe(response);
  pdf.end();
});

app.post("/api/quotes/:id/email", requireRole("sales", "admin"), async (request, response) => {
  const id = asId(request.params.id);
  if (!id) return fail(response, "Mã báo giá không hợp lệ.");

  const db = await connectDatabase();
  const user = userOf(request);
  const quote = await db.collection<Quote>("quotes").findOne({ _id: id, companyId: user.companyId });
  if (!quote) return fail(response, "Không tìm thấy báo giá.", 404);
  if (quote.status !== "approved") return fail(response, "Chỉ có thể gửi báo giá đã được duyệt.", 409);
  if (!validEmail(quote.customerEmail)) return fail(response, "Báo giá chưa có email khách hàng hợp lệ.", 422);

  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(user.companyId) });
  if (!company?.smtpSettings) return fail(response, "Doanh nghiệp chưa cấu hình SMTP trong phần Cài đặt.", 503);

  let transport: ReturnType<typeof createCompanySmtpTransport> | undefined;
  try {
    transport = createCompanySmtpTransport(company.smtpSettings);
    const template = quote.template ? await savedTemplate(db, user.companyId, quote.template) : null;
    const attachment = template ? await renderTemplate(template, quote) : await makePdfBuffer(quote);
    const extension = template?.extension ?? "pdf";
    await transport.sendMail({
      from: company.smtpSettings.from,
      to: quote.customerEmail,
      subject: `Báo giá ${quote.quoteNumber}`,
      text: `Kính gửi ${quote.customerName},\n\nChúng tôi gửi bạn báo giá ${quote.quoteNumber} trong tệp đính kèm.\n\nTrân trọng.`,
      attachments: [{ filename: `${quote.quoteNumber}.${extension}`, content: attachment, contentType: templateFormats[extension] }],
    });
  } catch {
    return fail(response, "Gửi email không thành công. Hãy kiểm tra cấu hình SMTP hoặc thử lại sau.", 502);
  } finally {
    transport?.close();
  }

  await writeAudit(db, user, "quote_emailed", "quote", id.toHexString(), { quoteNumber: quote.quoteNumber });
  response.json({ sent: true });
});

const server = createServer(app);
let closeWeb: () => Promise<void> = async () => {};
closeWeb = await attachWeb(app, server);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("Request failed:", error instanceof Error ? error.message : "unknown error");
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
    server.listen(config.port, "0.0.0.0", () => {
      console.log(`AI Bao Gia listening on http://0.0.0.0:${config.port}`);
    });
  })
  .catch((error: unknown) => {
    console.error("Unable to connect to MongoDB:", error instanceof Error ? error.message : error);
    void shutdown().finally(() => process.exit(1));
  });

async function shutdown() {
  await closeWeb();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
