import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { connectDatabase } from "./db.js";
import { verifyPassword } from "./password.js";
import type { Company, SessionUser, UserAccount, UserRole } from "./types.js";

const COOKIE_NAME = "bao_gia_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

function sign(value: string) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function encodeSession(user: SessionUser, authVersion: number) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, authVersion, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token: string): { user: SessionUser; authVersion: number } | undefined {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionUser & {
      exp: number;
      authVersion?: number;
    };
    if (parsed.exp < Date.now() / 1000) return;
    if (!["sales", "admin"].includes(parsed.role)) return;
    if (typeof parsed.companyId !== "string" || !ObjectId.isValid(parsed.companyId)) return;
    if (parsed.platformAdmin !== undefined && typeof parsed.platformAdmin !== "boolean") return;
    const { exp: _exp, authVersion = 0, ...user } = parsed;
    return { user, authVersion };
  } catch {
    return;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export async function login(email: string, password: string, response: Response) {
  const normalizedEmail = email.trim().toLowerCase();
  const db = await connectDatabase();
  const user = await db.collection<UserAccount>("users").findOne({ email: normalizedEmail });
  if (!user || user.active === false || !verifyPassword(password, user.passwordHash)) return false;
  if (!ObjectId.isValid(user.companyId) || !["sales", "admin"].includes(user.role)) return false;
  const company = await db.collection<Company>("companies").findOne(
    { _id: new ObjectId(user.companyId) },
    { projection: { _id: 1 } },
  );
  if (!company) return false;
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
    ...(user.platformAdmin ? { platformAdmin: true } : {}),
  };
  response.cookie(COOKIE_NAME, encodeSession(sessionUser, user.authVersion ?? 0), cookieOptions());
  return sessionUser;
}

export function logout(response: Response) {
  response.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  const session = token ? decodeSession(decodeURIComponent(token)) : undefined;
  if (!session) {
    response.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    return;
  }
  const { user } = session;
  void connectDatabase()
    .then((db) => db.collection<UserAccount>("users").findOne(
      { id: user.id, companyId: user.companyId },
      { projection: { id: 1, email: 1, name: 1, role: 1, companyId: 1, active: 1, authVersion: 1, platformAdmin: 1 } },
    ))
    .then((account) => {
      if (!account || account.active === false || (account.authVersion ?? 0) !== session.authVersion || !["sales", "admin"].includes(account.role)) {
        response.status(401).json({ error: "Tài khoản không còn hoạt động. Vui lòng đăng nhập lại." });
        return;
      }
      request.user = {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        companyId: account.companyId,
        ...(account.platformAdmin ? { platformAdmin: true } : {}),
      };
      next();
    })
    .catch(next);
}

export function requireRole(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ error: "Bạn không có quyền thực hiện thao tác này." });
      return;
    }
    next();
  };
}

export function requirePlatformAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.user?.platformAdmin) {
    response.status(403).json({ error: "Bạn không có quyền quản lý tài khoản doanh nghiệp." });
    return;
  }
  next();
}
