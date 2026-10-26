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
  aiUsage?: { periodStart: string; used: number };
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
  aiLimit?: number | null;
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
  quantityUnknown?: boolean;
  unit: string;
  unitPrice: number;
  priceFromCurrentCatalog?: boolean;
  priceUnavailable?: boolean;
  currency: string;
  catalogAttributes?: Record<string, string>;
  attributes: Record<string, string>;
  lineTotal: number;
  lineTotalUnknown?: boolean;
}

export interface Quote {
  kind?: "estimate" | "customer" | "budget";
  sourceQuote?: { id: string; quoteNumber: string };
  sourceRequirements?: string;
  customerPricesCaptured?: boolean;
  missingProducts?: string[];
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
  subtotalUnknown?: boolean;
  taxRate: number;
  taxRateConfirmed?: boolean;
  taxAmount: number;
  shippingFee?: number | null;
  shippingFeeConfirmed?: boolean;
  validityDays?: number | null;
  completionDate?: string | null;
  total: number;
  totalUnknown?: boolean;
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

export interface Contract {
  _id?: ObjectId;
  companyId: string;
  quoteId: string;
  quoteNumber: string;
  contractNumber: string;
  template?: QuoteTemplateSnapshot;
  status: "draft" | "signed";
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  customerTaxId: string;
  customerRepresentative: string;
  companyName: string;
  companyAddress: string;
  companyTaxId: string;
  companyRepresentative: string;
  companyPhone: string;
  companyEmail: string;
  lines: QuoteLine[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  shippingFee: number;
  total: number;
  currency: string;
  scope: string;
  projectName: string;
  projectAddress: string;
  deliverables: string;
  depositAmount: number;
  bankDetails: string;
  otherTerms: string;
  paymentTerms: string;
  deliveryTerms: string;
  signingPlace: string;
  signedDate: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptanceRecord {
  _id?: ObjectId;
  companyId: string;
  contractId: string;
  contractNumber: string;
  acceptanceNumber: string;
  template?: QuoteTemplateSnapshot;
  status: "draft" | "completed";
  acceptedDate: string;
  startTime: string;
  endTime: string;
  location: string;
  result: string;
  handoverDetails: string;
  qualityAssessment: string;
  settlementAmount: number;
  amountPaid: number;
  paymentDueDays: number | null;
  notes: string;
  lines: Array<{ lineIndex: number; acceptedQuantity: number }>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateFillPlan {
  edits: Array<{ part: string; find: string; replace: string }>;
  pdfEdits: Array<{ page: number; x: number; y: number; width: number; height: number; fontSize: number; text: string; erase: boolean }>;
}

export interface XlsxTemplateFillPlan {
  tableHeaderRow?: number;
  tableEndRow?: number;
  tableProductRows?: number[];
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
