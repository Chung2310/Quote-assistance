import nodemailer from "nodemailer";
import { decryptCompanySecret, encryptCompanySecret } from "./secrets.js";
import type { CompanySmtpSettings } from "./types.js";

export function encryptSmtpPassword(password: string) {
  return encryptCompanySecret(password, "bao-gia-smtp", "company-smtp-settings-v1");
}

export function createCompanySmtpTransport(settings: CompanySmtpSettings) {
  const password = settings.passwordEncrypted
    ? decryptCompanySecret(settings.passwordEncrypted, "bao-gia-smtp", "company-smtp-settings-v1")
    : "";
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.port === 587 && !settings.secure ? { requireTLS: true } : {}),
    ...(settings.user ? { auth: { user: settings.user, pass: password } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
