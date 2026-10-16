import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Never log configuration values: they include production credentials.
const env = process.env;
const required = ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY", "VPS_KNOWN_HOSTS", "IMAGE", "GHCR_USER", "GHCR_TOKEN", "MONGODB_URI", "SESSION_SECRET"];
for (const name of required) {
  if (!env[name]?.trim()) throw new Error("Missing GitHub secret/configuration: " + name);
}
if (env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.VPS_HOST)) throw new Error("VPS_HOST must be a hostname or IPv4 address");
if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(env.VPS_USER)) throw new Error("Invalid VPS_USER");
for (const name of ["VPS_SSH_PORT", "VPS_APP_PORT"]) {
  if (!/^\d+$/.test(env[name] ?? "") || Number(env[name]) < 1 || Number(env[name]) > 65535) throw new Error("Invalid " + name);
}
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(env.VPS_CONTAINER_NAME ?? "")) throw new Error("Invalid VPS_CONTAINER_NAME");
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(env.VPS_BIND_ADDRESS ?? "") || env.VPS_BIND_ADDRESS.split(".").some((part) => Number(part) > 255)) throw new Error("VPS_BIND_ADDRESS must be IPv4");
if (!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(env.IMAGE)) throw new Error("Expected immutable GHCR image digest");

const names = ["MONGODB_URI", "MONGODB_USER", "MONGODB_PASSWORD", "MONGODB_AUTH_SOURCE", "SESSION_SECRET", "SESSION_COOKIE_SECURE", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "DEFAULT_TAX_RATE", "CURRENCY", "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_NAME", "SEED_ADMIN_COMPANY_NAME"];
const lines = ["NODE_ENV=production", "PORT=3013"];
for (const name of names) {
  const value = env[name] ?? "";
  if (/[\r\n\0]/.test(value)) throw new Error(name + " must be a single line");
  lines.push(name + "=" + value);
}
const directory = process.argv[2];
writeFileSync(join(directory, "app.env"), lines.join("\n") + "\n", { mode: 0o600 });
writeFileSync(join(directory, "ssh-key"), env.VPS_SSH_KEY.replace(/\r/g, "") + "\n", { mode: 0o600 });
writeFileSync(join(directory, "known_hosts"), env.VPS_KNOWN_HOSTS + "\n", { mode: 0o600 });
writeFileSync(join(directory, "ghcr.token"), env.GHCR_TOKEN, { mode: 0o600 });
