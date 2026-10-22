import { readFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { config } from "./config.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(moduleDirectory, "../../web");

const legacyRoutes: Record<string, string> = {
  "/login": "/dang-nhap",
  "/app": "/tong-quan",
  "/admin": "/quan-tri",
  "/ung-dung": "/tong-quan",
  "/ung-dung/bao-gia": "/bao-gia",
  "/ung-dung/mau-bao-gia": "/mau-bao-gia",
  "/ung-dung/bang-gia": "/bang-gia",
  "/ung-dung/tai-khoan": "/tai-khoan",
};

const pageMetadata: Record<string, { title: string; description: string; robots: string }> = {
  "/": {
    title: "iGen Trợ lí báo giá — Tạo báo giá chuyên nghiệp bằng AI",
    description: "Tạo báo giá nhanh từ yêu cầu khách hàng và bảng giá doanh nghiệp. Quản lý mẫu, duyệt trước khi gửi và xuất Excel, PDF với iGen Trợ lí báo giá.",
    robots: "index,follow",
  },
  "/dang-nhap": {
    title: "Đăng nhập — iGen Trợ lí báo giá",
    description: "Đăng nhập vào không gian tạo và quản lý báo giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/dang-ky": {
    title: "Đăng ký doanh nghiệp — iGen Trợ lí báo giá",
    description: "Tạo tài khoản doanh nghiệp để quản lý bảng giá, mẫu và quy trình báo giá.",
    robots: "noindex,nofollow",
  },
  "/tong-quan": {
    title: "Không gian báo giá — iGen Trợ lí báo giá",
    description: "Không gian làm việc báo giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/bao-gia": {
    title: "Báo giá — iGen Trợ lí báo giá",
    description: "Quản lý báo giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/bao-gia-khach": {
    title: "Báo giá khách hàng — iGen Trợ lí báo giá",
    description: "Tạo và quản lý báo giá gửi khách hàng.",
    robots: "noindex,nofollow",
  },
  "/tu-van-ngan-sach": {
    title: "Tư vấn ngân sách — iGen Trợ lí báo giá",
    description: "Xem các phương án sản phẩm theo ngân sách và lịch sử đã lưu.",
    robots: "noindex,nofollow",
  },
  "/mau-bao-gia": {
    title: "Mẫu báo giá — iGen Trợ lí báo giá",
    description: "Quản lý mẫu báo giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/bang-gia": {
    title: "Bảng giá — iGen Trợ lí báo giá",
    description: "Quản lý bảng giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/tai-khoan": {
    title: "Trang cá nhân — iGen Trợ lí báo giá",
    description: "Quản lý tài khoản và cài đặt của doanh nghiệp.",
    robots: "noindex,nofollow",
  },
  "/quan-tri": {
    title: "Quản trị — iGen Trợ lí báo giá",
    description: "Khu vực quản trị hệ thống iGen Trợ lí báo giá.",
    robots: "noindex,nofollow",
  },
};

function siteOrigin(request: import("express").Request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL?.trim();
  try {
    if (configuredUrl) return new URL(configuredUrl).origin;
    const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const protocol = forwardedProtocol === "https" || request.protocol === "https" ? "https" : "http";
    return new URL(`${protocol}://${request.get("host") ?? "localhost"}`).origin;
  } catch {
    return "http://localhost";
  }
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceHeadTag(html: string, pattern: RegExp, replacement: string) {
  return pattern.test(html)
    ? html.replace(pattern, replacement)
    : html.replace("</head>", `    ${replacement}\n  </head>`);
}

function pagePath(request: import("express").Request) {
  return request.path.replace(/\/+$/, "") || "/";
}

function redirectOldOrTrailingPath(request: import("express").Request, response: import("express").Response) {
  const pathname = pagePath(request);
  const oldQuoteDetail = pathname.match(/^\/ung-dung\/bao-gia\/([a-f0-9]{24})$/i);
  let targetPath = oldQuoteDetail ? `/bao-gia/${oldQuoteDetail[1]}` : legacyRoutes[pathname] ?? pathname;
  const url = new URL(request.originalUrl, "http://local");
  if (pathname === "/login" && url.searchParams.get("mode") === "register") targetPath = "/dang-ky";
  if (targetPath === "/dang-nhap" || targetPath === "/dang-ky") url.searchParams.delete("mode");
  if (targetPath === pathname && request.path !== pathname) targetPath = pathname;
  const target = `${targetPath}${url.search}`;
  if (target !== request.originalUrl) {
    response.redirect(301, target);
    return true;
  }
  return false;
}

function renderPageMetadata(html: string, request: import("express").Request) {
  const pathname = pagePath(request);
  const quoteDetailPage = /^\/(bao-gia|bao-gia-khach)\/[a-f0-9]{24}$/i.test(pathname);
  const page = pageMetadata[pathname] ?? (quoteDetailPage ? {
    title: "Chi tiết báo giá — iGen Trợ lí báo giá",
    description: "Xem và chỉnh sửa báo giá của doanh nghiệp.",
    robots: "noindex,nofollow",
  } : {
    title: "Không tìm thấy trang — iGen Trợ lí báo giá",
    description: "Không tìm thấy trang bạn đang tìm.",
    robots: "noindex,follow",
  });
  const canonical = pathname === "/" ? new URL("/", siteOrigin(request)).href : "";
  const meta = (name: string, content: string) => `<meta name="${name}" content="${escapeAttribute(content)}" />`;
  const property = (name: string, content: string) => `<meta property="${name}" content="${escapeAttribute(content)}" />`;
  let result = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${page.title}</title>`);
  result = replaceHeadTag(result, /<meta\s+name=["']description["'][^>]*\/?\s*>/i, meta("description", page.description));
  result = replaceHeadTag(result, /<meta\s+name=["']robots["'][^>]*\/?\s*>/i, meta("robots", page.robots));
  result = replaceHeadTag(result, /<meta\s+property=["']og:title["'][^>]*\/?\s*>/i, property("og:title", page.title));
  result = replaceHeadTag(result, /<meta\s+property=["']og:description["'][^>]*\/?\s*>/i, property("og:description", page.description));
  result = replaceHeadTag(result, /<meta\s+name=["']twitter:title["'][^>]*\/?\s*>/i, meta("twitter:title", page.title));
  result = replaceHeadTag(result, /<meta\s+name=["']twitter:description["'][^>]*\/?\s*>/i, meta("twitter:description", page.description));
  result = result.replace(/\s*<link\s+rel=["']canonical["'][^>]*\/?\s*>/gi, "");
  result = result.replace(/\s*<meta\s+property=["']og:url["'][^>]*\/?\s*>/gi, "");
  result = result.replace(/\s*<script\s+id=["']application-structured-data["'][\s\S]*?<\/script>/gi, "");
  if (canonical) {
    const canonicalTag = `<link rel="canonical" href="${escapeAttribute(canonical)}" />`;
    result = result.replace("</head>", `    ${canonicalTag}\n    ${property("og:url", canonical)}\n  </head>`);
    const structuredData = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "iGen Trợ lí báo giá",
      description: page.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: canonical,
      offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
    };
    const json = JSON.stringify(structuredData).replace(/</g, "\\u003c");
    result = result.replace("</head>", `    <script id="application-structured-data" type="application/ld+json">${json}</script>\n  </head>`);
  }
  return { html: result, status: pageMetadata[pathname] || quoteDetailPage ? 200 : 404 };
}

function attachSeoEndpoints(app: Express) {
  app.get("/robots.txt", (request, response) => {
    const sitemap = new URL("/sitemap.xml", siteOrigin(request)).href;
    response.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${sitemap}\n`);
  });
  app.get("/sitemap.xml", (request, response) => {
    const location = new URL("/", siteOrigin(request)).href.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    response.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${location}</loc></url></urlset>`);
  });
}

function isHtmlNavigation(request: import("express").Request) {
  const accept = request.get("accept")?.toLowerCase() ?? "";
  return request.method === "GET" && request.path !== "/api" && !request.path.startsWith("/api/") && accept.includes("text/html");
}

export async function attachWeb(app: Express, httpServer: HttpServer): Promise<() => Promise<void>> {
  attachSeoEndpoints(app);
  app.use((request, response, next) => {
    if (!isHtmlNavigation(request)) return next();
    if (redirectOldOrTrailingPath(request, response)) return;
    next();
  });

  if (config.nodeEnv === "production") {
    const buildDirectory = path.join(webDirectory, "dist");
    app.use(express.static(buildDirectory, { index: false }));
    app.use(async (request, response, next) => {
      if (!isHtmlNavigation(request)) return next();
      try {
        const template = await readFile(path.join(buildDirectory, "index.html"), "utf8");
        const page = renderPageMetadata(template, request);
        response.status(page.status).type("html").send(page.html);
      } catch (error) {
        next(error);
      }
    });
    return async () => {};
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.join(webDirectory, "vite.config.ts"),
    configLoader: "runner",
    server: { middlewareMode: { server: httpServer } },
    appType: "custom",
  });
  app.use(async (request, response, next) => {
    if (!isHtmlNavigation(request)) return next();
    try {
      const template = await readFile(path.join(webDirectory, "index.html"), "utf8");
      const transformed = await vite.transformIndexHtml(request.originalUrl, template);
      const page = renderPageMetadata(transformed, request);
      response.status(page.status).type("html").send(page.html);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      next(error);
    }
  });
  app.use(vite.middlewares);
  return () => vite.close();
}
