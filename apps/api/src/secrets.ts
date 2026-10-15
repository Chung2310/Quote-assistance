import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { config } from "./config.js";

function encryptionKey(salt: string, info: string) {
  return Buffer.from(hkdfSync("sha256", config.sessionSecret, salt, info, 32));
}

export function encryptCompanySecret(value: string, salt: string, info: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(salt, info), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCompanySecret(encryptedValue: string, salt: string, info: string) {
  const [version, ivValue, tagValue, contentValue] = encryptedValue.split(".");
  if (version !== "v1" || !ivValue || !tagValue || contentValue === undefined) {
    throw new Error("Stored company credential has an unsupported format");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const content = Buffer.from(contentValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Stored company credential is invalid");

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(salt, info), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]).toString("utf8");
}
