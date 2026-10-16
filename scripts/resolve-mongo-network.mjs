import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function resolveMongoNetwork(envText, containers, preferred = "") {
  const lines = envText.split("\n");
  const index = lines.findIndex((line) => line.startsWith("MONGODB_URI="));
  const uri = index < 0 ? "" : lines[index].slice("MONGODB_URI=".length);
  let url;
  try { url = new URL(uri); } catch { return { network: preferred, envText }; }
  if (url.protocol !== "mongodb:") return { network: preferred, envText };
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const port = url.port || "27017";
  const matches = [];
  for (const container of containers) {
    const networks = Object.entries(container.networks ?? {}).filter(([name]) => !preferred || name === preferred);
    if (loopback) {
      for (const [internal, bindings] of Object.entries(container.ports ?? {})) {
        if (internal.endsWith("/tcp") && bindings?.some((binding) => binding.HostPort === port)) {
          matches.push({ container, networks, port: internal.split("/")[0] });
        }
      }
    } else if (networks.some(([, details]) => [container.name?.replace(/^\//, ""), ...(details.Aliases ?? [])].includes(url.hostname))) {
      matches.push({ container, networks, port });
    }
  }
  if (!matches.length && !loopback) return { network: preferred, envText };
  if (matches.length !== 1) throw new Error("Cannot identify a unique MongoDB container from MONGODB_URI. Check its published port or set the container hostname and DOCKER_NETWORK in ENV_FILE.");
  const match = matches[0];
  const networks = match.networks.filter(([name, info]) => !["host", "none"].includes(name) && info.IPAddress);
  const selected = networks.find(([name]) => name !== "bridge") ?? networks[0];
  if (!selected) throw new Error("MongoDB container has no usable Docker network. Check DOCKER_NETWORK in ENV_FILE.");
  const [network, details] = selected;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network)) throw new Error("Unsupported Docker network name");
  // User-defined networks support container DNS; default bridge uses its IP.
  const hostname = network === "bridge" ? details.IPAddress : match.container.name.replace(/^\//, "");
  url.hostname = hostname;
  url.port = match.port;
  lines[index] = "MONGODB_URI=" + url.toString();
  return { network, envText: lines.join("\n") };
}

if (process.argv[1] === undefined || import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [envText, metadata = ""] = readFileSync(0, "utf8").split("\0");
    const containers = metadata.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const result = resolveMongoNetwork(envText, containers, process.env.DEPLOY_NETWORK || "");
    process.stdout.write(result.network + "\n" + result.envText);
  } catch (error) {
    // Errors only contain our fixed messages, never the env file or URI.
    console.error(error instanceof SyntaxError ? "Invalid Docker network metadata" : error.message);
    process.exitCode = 1;
  }
}
