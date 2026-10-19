import type { ObjectId } from "mongodb";

export type UserRole = "user" | "admin";
export type QuoteStatus = "draft" | "needs_info" | "pending_review" | "approved" | "rejected";
export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface CompanyFile {
  _id?: ObjectId;
  companyId: string;
  uploadedBy: string;
  originalFilename: string;
  mimeType: string;
  bytes: number;
  publicId: string;
  assetId: string;
  resourceType: "image" | "raw";
  createdAt: Date;
}

export interface CompanyProfileDetails {
  taxId: string;
  address: string;
  phone: string;
  businessEmail: string;
  representativeName: string;
}

export interface Company extends Partial<CompanyProfileDetails> {
  _id?: ObjectId;
  code?: string;
  planCode?: string;
  subscriptionExpiresAt?: Date;
  billingPaymentCreatedAt?: Date;
  name: string;
  normalizedName: string;
  legacyPartitionId?: string;
  quoteTemplateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPlan {
  _id?: ObjectId;
  code: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  quoteLimit: number | null;
  templateLimit: number | null;
  active: boolean;
  featured: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ContactRequestStatus = "new" | "contacted" | "closed";

export interface PlanContactRequest {
  _id?: ObjectId;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  message: string;
  status: ContactRequestStatus;
  adminNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  companyId?: string;
  /** Legacy marker removed when user roles are migrated at startup. */
  platformAdmin?: boolean;
  active?: boolean;
  authVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
}

export interface CatalogItem {
  _id?: ObjectId;
  companyId: string;
  sku: string;
  name: string;
  description: string;
  attributes?: Record<string, string>;
  unit: string;
  price: number;
  currency: string;
  active: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyzedItem {
  catalogItemId: string;
  quantity: number;
  unit: string;
  attributes: Record<string, string>;
  evidence: string;
}

export interface SuggestedProduct {
  name: string;
  description: string;
  unit: string;
  quantity: number;
  informationField?: string;
}

export interface QuoteRequest {
  priceListId?: string;
  requestFile?: { id: string; originalFilename: string };
  candidates?: CatalogItem[];
  priceListFilename?: string;
  priceListFilenames?: string[];
  _id?: ObjectId;
  companyId: string;
  template?: QuoteTemplateSnapshot;
  idempotencyKey?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  requestText: string;
  status: MatchStatus;
  items: AnalyzedItem[];
  missingFields: string[];
  suggestedProducts?: SuggestedProduct[];
  createdBy: string;
  createdAt: Date;
  analyzedAt?: Date;
}

export interface QuoteLine {
  catalogItemId: string;
  source?: "catalog" | "supplemental";
  supplementalFor?: string;
  sku: string;
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  catalogAttributes?: Record<string, string>;
  attributes: Record<string, string>;
  lineTotal: number;
}

export interface Quote {
  priceList?: { id: string; originalFilename: string };
  requestFile?: { id: string; originalFilename: string };
  _id?: ObjectId;
  companyId: string;
  template?: QuoteTemplateSnapshot;
  templateFillPlan?: TemplateFillPlan;
  xlsxTemplateFillPlan?: XlsxTemplateFillPlan;
  idempotencyKey?: string;
  quoteNumber: string;
  requestId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  lines: QuoteLine[];
  subtotal: number;
  taxRate: number;
  taxRateConfirmed?: boolean;
  taxAmount: number;
  shippingFee?: number | null;
  shippingFeeConfirmed?: boolean;
  validityDays?: number | null;
  completionDate?: string | null;
  total: number;
  currency: string;
  informationNeeded: string[];
  additionalInformation?: Record<string, string>;
  suggestedProducts?: SuggestedProduct[];
  informationConfirmed: boolean;
  status: QuoteStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}

export interface TemplateFillPlan {
  edits: Array<{ part: string; find: string; replace: string }>;
  pdfEdits: Array<{ page: number; x: number; y: number; width: number; height: number; fontSize: number; text: string; erase: boolean }>;
}

export interface XlsxTemplateFillPlan {
  cells: Array<{ key: string; sheet: string; cell: string }>;
  lineRows: Array<{
    sheet: string;
    row: number;
    fields: Array<{ key: string; cell: string }>;
  }>;
}

export interface QuoteTemplateSnapshot {
  id: string;
  name?: string;
  originalFilename: string;
}
