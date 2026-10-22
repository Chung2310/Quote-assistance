export type UserRole = "user" | "admin";
export type QuoteStatus = "draft" | "needs_info" | "pending_review" | "approved" | "rejected";
export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface SubscriptionPlanSummary {
  code: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  quoteLimit: number | null;
  aiLimit: number | null;
  templateLimit: number | null;
  active: boolean;
  featured: boolean;
  displayOrder: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  plan?: SubscriptionPlanSummary | null;
}

export interface CatalogItem {
  _id: string;
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
}

export interface AnalysisItem {
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
  priceFromCurrentCatalog?: boolean;
  priceUnavailable?: boolean;
  currency: string;
  catalogAttributes?: Record<string, string>;
  attributes: Record<string, string>;
  lineTotal: number;
}

export interface Quote {
  kind?: "estimate" | "customer";
  missingProducts?: string[];
  _id: string;
  template?: { id: string; name?: string; originalFilename: string };
  priceList?: { id: string; originalFilename: string };
  requestFile?: { id: string; originalFilename: string };
  quoteNumber: string;
  requestId: string;
  requestText?: string;
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
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface QuoteRequest {
  _id: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  requestText: string;
  status: MatchStatus;
  items: AnalysisItem[];
  missingFields: string[];
  suggestedProducts?: SuggestedProduct[];
  createdAt: string;
}

export interface Analysis {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  status: MatchStatus;
  items: AnalysisItem[];
  missingFields: string[];
  suggestedProducts?: SuggestedProduct[];
}
