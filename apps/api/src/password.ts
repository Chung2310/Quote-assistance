import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, passwordHash: unknown) {
  if (typeof passwordHash !== "string") return false;
  const [salt, expectedHex] = passwordHash.split(":");
  if (!salt || !/^[a-f0-9]{32}$/i.test(salt) || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(expected, actual);
}
