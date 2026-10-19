import { config as loadEnvironment } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./password.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
loadEnvironment({ path: process.env.ENV_FILE ?? path.resolve(moduleDirectory, "../../../.env") });

const defaultCompanyName = "Doanh nghiệp pilot";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readSeedAdmin() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() ?? "";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  const adminName = process.env.SEED_ADMIN_NAME?.trim() || "Quản trị hệ thống";
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set or both be empty");
  }
  if (!adminEmail) return undefined;
  if (adminPassword.length < 7 || adminPassword.length > 200) {
    throw new Error("SEED_ADMIN_PASSWORD must contain between 7 and 200 characters");
  }
  return {
    id: "seed-admin",
    email: adminEmail,
    name: adminName,
    role: "admin" as const,
    passwordHash: hashPassword(adminPassword),
  };
}

function databaseFromUri(uri: string): string | undefined {
  const path = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?#]*)/i)?.[1];
  const database = path?.split("/")[0];
  if (!database) return undefined;
  try {
    return decodeURIComponent(database);
  } catch {
    return database;
  }
}

const mongoUri = required("MONGODB_URI", "mongodb://localhost:27017/bao_gia_pilot");
const mongoUser = process.env.MONGODB_USER ?? "";
const mongoPassword = process.env.MONGODB_PASSWORD ?? "";
const port = Number(process.env.PORT ?? 3000);
const configuredSepayPaymentPrefix = (process.env.SEPAY_PAYMENT_PREFIX ?? "BG").trim().toUpperCase();
const sepayPaymentPrefix = configuredSepayPaymentPrefix === "GQ" ? "BG" : configuredSepayPaymentPrefix;
if (!/^[A-Z]{2,5}$/.test(sepayPaymentPrefix)) {
  throw new Error("SEPAY_PAYMENT_PREFIX must contain between 2 and 5 letters");
}

export const config = {
  port,
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongoUri,
  mongoDatabase: databaseFromUri(mongoUri) || process.env.MONGODB_DATABASE || "bao_gia_pilot",
  mongoUser,
  mongoPassword,
  mongoAuthSource: process.env.MONGODB_AUTH_SOURCE ?? "admin",
  defaultCompanyName,
  sessionSecret: required("SESSION_SECRET", "development-only-change-me-before-deploy"),
  secureCookie: process.env.SESSION_COOKIE_SECURE === "true",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash-0731",
  openRouterFileModel: process.env.OPENROUTER_FILE_MODEL ?? "openai/gpt-4o-mini",
  openRouterSiteUrl: "http://localhost:3000",
  openRouterAppName: "AI Bao Gia Pilot",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() ?? "",
  },
  cloudinaryConfigured: Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
    process.env.CLOUDINARY_API_KEY?.trim() &&
    process.env.CLOUDINARY_API_SECRET?.trim()
  ),
  sepay: {
    bankCode: process.env.SEPAY_BANK_CODE?.trim() ?? "",
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER?.trim() ?? "",
    accountName: process.env.SEPAY_ACCOUNT_NAME?.trim() ?? "",
    webhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY?.trim() ?? "",
    paymentPrefix: sepayPaymentPrefix,
  },
  sepayConfigured: Boolean(
    process.env.SEPAY_BANK_CODE?.trim() &&
    /^[A-Za-z0-9]{1,19}$/.test(process.env.SEPAY_ACCOUNT_NUMBER?.trim() ?? "") &&
    process.env.SEPAY_WEBHOOK_API_KEY?.trim()
  ),
  taxRate: Number(process.env.DEFAULT_TAX_RATE ?? 0),
  currency: process.env.CURRENCY ?? "VND",
  seedAdmin: readSeedAdmin(),
};

if (Boolean(config.mongoUser) !== Boolean(config.mongoPassword)) {
  throw new Error("MONGODB_USER and MONGODB_PASSWORD must both be set or both be empty");
}
if (!Number.isFinite(config.port) || config.port < 1) throw new Error("PORT must be a positive number");
if (!Number.isFinite(config.taxRate) || config.taxRate < 0 || config.taxRate > 1) {
  throw new Error("DEFAULT_TAX_RATE must be a decimal between 0 and 1");
}
if (config.nodeEnv === "production" && config.sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production");
}
