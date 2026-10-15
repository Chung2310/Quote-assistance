import type { ObjectId } from "mongodb";

export type UserRole = "sales" | "admin";
export type QuoteStatus = "draft" | "needs_info" | "pending_review" | "approved" | "rejected";
export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface CompanySmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passwordEncrypted?: string;
}

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
  name: string;
  normalizedName: string;
  legacyPartitionId?: string;
  smtpSettings?: CompanySmtpSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  companyId: string;
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
  platformAdmin?: boolean;
}

export interface CatalogItem {
  _id?: ObjectId;
  companyId: string;
  sku: string;
  name: string;
  description: string;
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

export interface QuoteRequest {
  _id?: ObjectId;
  companyId: string;
  idempotencyKey?: string;
  customerName: string;
  customerEmail: string;
  requestText: string;
  status: MatchStatus;
  items: AnalyzedItem[];
  missingFields: string[];
  createdBy: string;
  createdAt: Date;
  analyzedAt?: Date;
}

export interface QuoteLine {
  catalogItemId: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  attributes: Record<string, string>;
  lineTotal: number;
}

export interface Quote {
  _id?: ObjectId;
  companyId: string;
  idempotencyKey?: string;
  quoteNumber: string;
  requestId: string;
  customerName: string;
  customerEmail: string;
  lines: QuoteLine[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  informationNeeded: string[];
  informationConfirmed: boolean;
  status: QuoteStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}
