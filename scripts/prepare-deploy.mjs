import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

// Never log configuration values: ENV_FILE can contain production credentials.
const env = process.env;
for (const name of ["SSH_HOST", "SSH_USER", "SSH_KEY", "SSH_PORT", "ENV_FILE", "IMAGE", "IMAGE_TAG", "GHCR_USER", "GHCR_TOKEN"]) {
  if (!env[name]?.trim()) throw new Error("Missing GitHub secret/configuration: " + name);
}
if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.SSH_HOST)) throw new Error("SSH_HOST must be a hostname or IPv4 address");
if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(env.SSH_USER)) throw new Error("Invalid SSH_USER");
function validPort(value) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}
if (!validPort(env.SSH_PORT)) throw new Error("Invalid SSH_PORT");
if (!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(env.IMAGE)) throw new Error("Expected immutable GHCR image digest");
const imageRepository = env.IMAGE.slice(0, env.IMAGE.indexOf("@sha256:"));
const imageTagPrefix = imageRepository + ":";
if (!env.IMAGE_TAG.startsWith(imageTagPrefix) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(env.IMAGE_TAG.slice(imageTagPrefix.length))) {
  throw new Error("Expected IMAGE_TAG for the immutable GHCR image repository");
}
const containerName = imageRepository.slice(imageRepository.lastIndexOf("/") + 1).toLowerCase();
if (!/^[a-z0-9][a-z0-9_.-]*$/.test(containerName)) throw new Error("Could not derive a valid container name from the GitHub repository");
let app;
try { app = parseEnv(env.ENV_FILE.replace(/^\uFEFF/, "")); }
catch { throw new Error("ENV_FILE is not valid dotenv content"); }
if (!app.MONGODB_URI?.trim()) throw new Error("ENV_FILE must include MONGODB_URI");
if (!app.SESSION_SECRET || app.SESSION_SECRET.length < 32) throw new Error("ENV_FILE must include SESSION_SECRET with at least 32 characters");
app.NODE_ENV = "production";
app.PORT ||= "3013";
if (!validPort(app.PORT)) throw new Error("Invalid PORT in ENV_FILE");
const dockerNetwork = app.DOCKER_NETWORK?.trim() ?? "";
if (dockerNetwork && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(dockerNetwork)) throw new Error("Invalid DOCKER_NETWORK in ENV_FILE");
delete app.DOCKER_NETWORK;
const lines = [];
for (const [name, value] of Object.entries(app)) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || /[\r\n\0]/.test(value)) {
    throw new Error("ENV_FILE contains an invalid key or multiline value; Docker env values must be single-line");
  }
  lines.push(name + "=" + value);
}
const directory = process.argv[2];
writeFileSync(join(directory, "app.env"), lines.join("\n") + "\n", { mode: 0o600 });
writeFileSync(join(directory, "app-port"), app.PORT, { mode: 0o600 });
writeFileSync(join(directory, "docker-network"), dockerNetwork, { mode: 0o600 });
writeFileSync(join(directory, "image-tag"), env.IMAGE_TAG, { mode: 0o600 });
writeFileSync(join(directory, "container-name"), containerName, { mode: 0o600 });
writeFileSync(join(directory, "ssh-key"), env.SSH_KEY.replace(/\r/g, "") + "\n", { mode: 0o600 });
writeFileSync(join(directory, "ghcr.token"), env.GHCR_TOKEN, { mode: 0o600 });
